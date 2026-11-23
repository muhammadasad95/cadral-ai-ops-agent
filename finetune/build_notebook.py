"""Builds finetune_router.ipynb (kept as a script so the notebook stays reviewable in git diffs)."""
import json, pathlib

cells = []
md = lambda s: cells.append({"cell_type": "markdown", "metadata": {}, "source": s.strip("\n").splitlines(keepends=True)})
code = lambda s: cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": s.strip("\n").splitlines(keepends=True)})

md("""
# Fine-tuning a small open-source model for message routing

**Task:** classify each incoming customer message as `support`, `orders` or `escalation` (the router's job).
**Model:** `Qwen/Qwen2.5-1.5B-Instruct` (1.5B parameters) with LoRA.
**Hardware:** free Google Colab T4 GPU (Runtime → Change runtime type → T4 GPU). Runs in about 10–15 minutes.

We compare three options on the same held-out test set (its templates never appear in training):
1. the **base** 1.5B model, zero-shot
2. the **fine-tuned** 1.5B model (LoRA)
3. a **large API model** (Llama 3.3 70B on Groq) — optional, needs a free `GROQ_API_KEY` in Colab secrets

Each model picks the label with the highest log-likelihood (no free-text parsing), so the comparison is fair.
""")

code("""
!pip -q install "transformers>=4.44" "peft>=0.12" "datasets>=2.20" accelerate scikit-learn openai
""")

code("""
# Get the dataset from the GitHub repo (or upload finetune/data/*.jsonl manually and skip the clone).
REPO = "https://github.com/muhammadasad95/cadral-ai-ops-agent"
import os, json, time, subprocess
if not os.path.exists("repo"):
    subprocess.run(["git", "clone", "--depth", "1", REPO, "repo"], check=False)
DATA = "repo/finetune/data" if os.path.exists("repo/finetune/data") else "."
load = lambda f: [json.loads(l) for l in open(f"{DATA}/{f}") if l.strip()]
train, test = load("train.jsonl"), load("test.jsonl")
LABELS = ["support", "orders", "escalation"]
print(len(train), "train /", len(test), "test")
""")

code("""
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
tok = AutoTokenizer.from_pretrained(MODEL)
tok.padding_side = "right"
model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=torch.float16, device_map="cuda")

INSTRUCTION = ("You route customer messages for a UK homeware shop. Labels: "
               "support = questions answered from policies or product info; "
               "orders = needs this customer's order data or an action on an order; "
               "escalation = angry, legal, safety, fraud, privacy complaint or asks for a human.")
def prompt(text):
    msgs = [{"role": "system", "content": INSTRUCTION}, {"role": "user", "content": f"Message: {text}\\nLabel:"}]
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)

@torch.no_grad()
def classify(m, text):
    # Score each label's log-likelihood after the prompt and take the best one.
    p = prompt(text)
    p_ids = tok(p, return_tensors="pt").input_ids.cuda()
    scores = []
    for lab in LABELS:
        l_ids = tok(lab, add_special_tokens=False, return_tensors="pt").input_ids.cuda()
        ids = torch.cat([p_ids, l_ids], dim=1)
        logits = m(ids).logits[0, p_ids.shape[1]-1:-1].float()
        lp = torch.log_softmax(logits, -1).gather(1, l_ids[0].unsqueeze(1)).sum().item()
        scores.append(lp)
    return LABELS[max(range(3), key=lambda i: scores[i])]

from sklearn.metrics import accuracy_score, f1_score, confusion_matrix
def evaluate(m, name):
    m.eval(); preds = []; t0 = time.time()
    for r in test: preds.append(classify(m, r["text"]))
    ms = 1000 * (time.time() - t0) / len(test)
    gold = [r["label"] for r in test]
    res = {"name": name, "accuracy": accuracy_score(gold, preds), "macro_f1": f1_score(gold, preds, average="macro"), "latency_ms": ms,
           # T4 GPU at ~$0.35/hour, one message at a time (worst case, no batching)
           "cost_per_1k_usd": ms / 1000 * 1000 / 3600 * 0.35,
           "confusion": confusion_matrix(gold, preds, labels=LABELS).tolist(),
           "errors": [{"text": r["text"], "gold": r["label"], "pred": p} for r, p in zip(test, preds) if p != r["label"]][:15]}
    print(f"{name}: accuracy {res['accuracy']:.3f}  macro-F1 {res['macro_f1']:.3f}  {ms:.0f} ms/msg")
    return res

base_res = evaluate(model, "Qwen2.5-1.5B base (zero-shot)")
""")

code("""
# LoRA fine-tuning: train only on the label tokens (the prompt is masked out of the loss).
from peft import LoraConfig, get_peft_model
from torch.utils.data import DataLoader
import random
model.gradient_checkpointing_enable()
model.enable_input_require_grads()
lora = LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules=["q_proj", "k_proj", "v_proj", "o_proj"], task_type="CAUSAL_LM")
pm = get_peft_model(model, lora)
for p in pm.parameters():
    if p.requires_grad: p.data = p.data.float()   # LoRA weights in fp32 so mixed-precision training is stable
pm.print_trainable_parameters()

def encode(r):
    p = tok(prompt(r["text"]), add_special_tokens=False).input_ids
    l = tok(r["label"] + tok.eos_token, add_special_tokens=False).input_ids
    return {"input_ids": p + l, "labels": [-100] * len(p) + l}
enc = [encode(r) for r in train]
def collate(b):
    n = max(len(x["input_ids"]) for x in b)
    ids = torch.full((len(b), n), tok.pad_token_id); lab = torch.full((len(b), n), -100); att = torch.zeros((len(b), n), dtype=torch.long)
    for i, x in enumerate(b):
        k = len(x["input_ids"]); ids[i, :k] = torch.tensor(x["input_ids"]); lab[i, :k] = torch.tensor(x["labels"]); att[i, :k] = 1
    return ids.cuda(), att.cuda(), lab.cuda()

opt = torch.optim.AdamW([p for p in pm.parameters() if p.requires_grad], lr=2e-4)
scaler = torch.cuda.amp.GradScaler()
EPOCHS = 2
pm.train()
for ep in range(EPOCHS):
    random.seed(ep); random.shuffle(enc); tot = 0
    for i, (ids, att, lab) in enumerate(DataLoader(enc, batch_size=8, collate_fn=collate)):
        with torch.autocast("cuda", dtype=torch.float16):
            loss = pm(input_ids=ids, attention_mask=att, labels=lab).loss
        scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); opt.zero_grad(); tot += loss.item()
    print(f"epoch {ep+1}: loss {tot/(i+1):.4f}")
pm.eval()
ft_res = evaluate(pm, "Qwen2.5-1.5B + LoRA (fine-tuned)")
pm.save_pretrained("router-lora")
""")

code("""
# Optional: the large API model the app uses by default (Llama 3.3 70B on Groq). Add GROQ_API_KEY in Colab secrets (key icon).
api_res = None
try:
    from google.colab import userdata
    key = userdata.get("GROQ_API_KEY")
except Exception:
    key = os.environ.get("GROQ_API_KEY")
if key:
    from openai import OpenAI
    cli = OpenAI(api_key=key, base_url="https://api.groq.com/openai/v1")
    preds, pin, pout, t0 = [], 0, 0, time.time()
    for r in test:
        out = None
        for attempt in range(5):
            try:
                out = cli.chat.completions.create(model="llama-3.3-70b-versatile", temperature=0, max_tokens=5, messages=[
                    {"role": "system", "content": INSTRUCTION + " Reply with the label only."}, {"role": "user", "content": f"Message: {r['text']}\\nLabel:"}])
                break
            except Exception as e:
                time.sleep(2 * (attempt + 1))
        if out is None: preds.append("support"); continue
        txt = out.choices[0].message.content.strip().lower()
        preds.append(next((l for l in LABELS if l in txt), "support"))
        pin += out.usage.prompt_tokens; pout += out.usage.completion_tokens
    ms = 1000 * (time.time() - t0) / len(test)
    gold = [r["label"] for r in test]
    api_res = {"name": "Llama 3.3 70B via Groq API", "accuracy": accuracy_score(gold, preds), "macro_f1": f1_score(gold, preds, average="macro"), "latency_ms": ms,
               "cost_per_1k_usd": (pin * 0.59 + pout * 0.79) / 1e6 / len(test) * 1000}
    print(api_res)
else:
    print("No GROQ_API_KEY — skipping the large-model baseline.")
""")

code("""
rows = [base_res, ft_res] + ([api_res] if api_res else [])
results = {
  "model": MODEL, "task": "router classification (support / orders / escalation)", "method": "LoRA r=16 on q,k,v,o; 2 epochs; lr 2e-4; label-only loss",
  "train_size": len(train), "test_size": len(test), "labels": LABELS,
  "rows": [{k: v for k, v in r.items() if k in ("name", "accuracy", "macro_f1", "latency_ms", "cost_per_1k_usd")} for r in rows],
  "confusion_finetuned": ft_res["confusion"], "errors_finetuned": ft_res["errors"],
  "notes": "Latency measured one message at a time on a free Colab T4. GPU cost assumes about $0.35 per hour; API cost uses Groq list prices.",
}
json.dump(results, open("results.json", "w"), indent=2)
print(json.dumps(results["rows"], indent=2))
# Download results.json and commit it to finetune/results.json — the dashboard's "Evals & fine-tuning" page shows it.
try:
    from google.colab import files; files.download("results.json")
except Exception: pass
""")

md("""
## When to use which

* **Fine-tuned small model** — high-volume, narrow, stable tasks like routing or tone classification: cheap, fast, runs on our own hardware, and data never leaves our infrastructure.
* **RAG** — anything that depends on facts that change (policies, prices, stock): update a document, not the model.
* **Large API model** — open-ended reasoning, tool use and writing replies, where quality matters more than cost per call.
""")

nb = {"cells": cells, "metadata": {"accelerator": "GPU", "colab": {"provenance": []}, "kernelspec": {"display_name": "Python 3", "name": "python3"}, "language_info": {"name": "python"}}, "nbformat": 4, "nbformat_minor": 0}
pathlib.Path(__file__).with_name("finetune_router.ipynb").write_text(json.dumps(nb, indent=1))
print("wrote finetune_router.ipynb")
