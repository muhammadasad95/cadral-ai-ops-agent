# Write-up: architecture, trade-offs, results, scale

## Architecture in one paragraph

Every message, from any channel, goes through one orchestrator: **store it, load shared memory, route, run a specialist, apply the review policy, deliver, learn.** Three specialists sit behind a router: a support agent that answers only from retrieved documents with citations, an orders agent that calls real database tools, and an escalation agent that hands over to people. Postgres is the single source of truth for shop data, conversations, the vector index, traces, feedback and the job queue. The dashboard reads the same tables and gets live updates over Server-Sent Events.

## Key decisions and trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **Policy in code, not in prompts** (refund window, ownership checks, £100 approval limit) | A model can be confused or prompt-injected; a function cannot. The eval suite includes injection and cross-customer cases. | Every new policy needs code, not just a prompt edit. |
| **Router = LLM + deterministic safety net** | The LLM handles nuance; regexes guarantee that fire, legal threats, fraud and "human please" always escalate. The net can only raise risk. | Keyword nets can over-escalate (e.g. "fire" in "fireplace"); acceptable because escalation is the safe failure. |
| **Hybrid search + RRF + cross-encoder** | Keyword search wins on exact terms (SKUs, "Klarna", "£"), vectors win on paraphrase ("money back"); RRF merges them without tuning weights; the reranker gives a calibrated relevance score that also drives "I don't know". | Reranking adds an extra model call on CPU for every question. |
| **"I don't know" in three places** | Low retrieval relevance, the model's own `I_DONT_KNOW`, and a post-check that rejects answers without valid citations. | Some answerable questions get a cautious reply; the review queue catches these. |
| **Postgres for everything** (pgvector, FTS, job queue with `SKIP LOCKED`) | One free managed database (Neon) instead of a vector DB + a queue service + Redis. Fewer moving parts, one backup. | At high scale the queue and vector index would move out (see below). |
| **PGlite for dev, tests and evals** | The same SQL and pgvector run in-process, so the app, the tests and 60 evals start with zero setup, and each eval case gets an isolated database copy. | Not for multi-instance production; production uses `DATABASE_URL`. |
| **Groq (OpenAI-compatible)** | Free tier, very low latency, tool calling. The client is provider- and model-agnostic (Gemini, OpenRouter, Ollama work by changing `LLM_BASE_URL`; models by `LLM_MODEL` / `LLM_FAST_MODEL`). | Free-tier limit of 8,000 tokens a minute on the large model; handled with retries that wait as long as the API asks. |
| **Local embeddings + reranker (transformers.js)** | Free, no API key, no data leaves the server. | The model files make the Docker image larger and the first start slower. |
| **Human review modes AUTO / SMART / REVIEW** | Lets the shop start in REVIEW and move to SMART as measured accuracy rises. | REVIEW mode adds latency for customers. |
| **Learning = retrieval of past corrections + distilled rules, not online fine-tuning** | Immediate effect, auditable, reversible (rules can be switched off), no training run per correction. The same feedback exports as a fine-tuning dataset for periodic retraining. | Rules can conflict if never pruned; the dashboard shows and toggles them. |

## Fine-tuning

**Task:** router classification (support / orders / escalation), the highest-volume LLM call in the system.
**Model:** Qwen2.5-1.5B-Instruct, LoRA (r=16 on q/k/v/o), 2 epochs, label-only loss, free Colab T4.
**Data:** 488 synthetic but varied training messages (typos, casing, emoji, slot-filled templates) and an 82-message test set built from **held-out templates plus hand-written hard cases**, so the test measures generalisation rather than memorisation.

| Model | Accuracy | Macro-F1 | Latency / message | Cost / 1k messages |
|---|---|---|---|---|
| Qwen2.5-1.5B base (zero-shot) | _fill from results.json_ | | | |
| Qwen2.5-1.5B + LoRA | _fill from results.json_ | | | |
| GPT-OSS 120B (Groq API) | _fill from results.json_ | | | |

**When to use which**
- **Fine-tuned small model:** narrow, high-volume, stable decisions (routing, tone, intent). Cheapest per call, lowest latency when self-hosted, data stays in-house, and accuracy can match a 120B model on a closed label set.
- **RAG:** anything that depends on facts that change — policies, prices, stock. Update a document, not the weights. Fine-tuning facts in would make them stale and unverifiable (no citations).
- **Large API model:** open-ended work — writing replies, multi-step tool use, summaries for humans — where quality matters more than cost per call.

In this system the router could switch to the fine-tuned model (it runs on a small CPU/GPU box), while replies and tool use stay on the large model and facts stay in RAG.

## Eval results

`npm run eval` — 60 cases, each in its own seeded database.

| Run | Model / embeddings | Score | FAQ | IDK | Orders | Actions | Policy | Security | Escalation | Routing |
|---|---|---|---|---|---|---|---|---|---|---|
| Offline pipeline check | mock LLM / hash embeddings | 80.0% (48/60) | 14/20 | 5/6 | 4/8 | 7/8 | 5/5 | 4/4 | 6/6 | 3/3 |
| Live deployment, real model (25 Nov 2026) | GPT-OSS 120B + 20B (Groq) / MiniLM + cross-encoder | **90.0% (54/60)** | 19/20 | 4/6 | 8/8 | 8/8 | 3/5 | 3/4 | 6/6 | 3/3 |

The live run sent all 60 cases through the public chat API of the deployed app (each case a new chat session, about 12 seconds apart to stay inside Groq's free-tier limit of 8,000 tokens a minute). It is stricter than the offline harness on wording but cannot run the SQL side-effect checks, so actions and policy were also verified in the dashboard (refunds, cancellations, approvals). Response time: median 1.9 s, mean 2.1 s, p95 4.3 s end to end; 81% of conversations resolved without a human; no dead jobs.

What the 6 misses were, and what changed:
- 3 correct answers were held for human review instead of sent (two borderline-confidence retrievals, and an "I don't know" where the router was unsure). Safe, but slower for the customer. Fixed: a handover-style "I don't know" is no longer held, and the borderline window is narrower.
- 1 reply failed on the first attempt because GPT-OSS emitted a tool call where none was allowed; the job queue retried it and the customer got the answer a few seconds later. Fixed: the LLM client now retries that specific error with an explicit instruction.
- 2 replies did the right thing in different words ("I don't see an order BB-10401 on your account"; a £500 refund capped at the £299 order total and sent for approval). The check phrases were widened.

Re-test of the six misses on the redeployed app: five now give the correct reply first time (including "BB-10418 was fully refunded on 19 October, so there's no remaining balance to refund again"). The France question is still held for staff review because its retrieval is borderline; that is the intended safe behaviour.

Model change during the build: Groq moved Llama 3.3 70B and 3.1 8B to Enterprise-only, so the free key returned "model does not exist". The app switched to GPT-OSS 120B (replies, tools) and GPT-OSS 20B (routing) through two environment variables, with no code change, which is the reason the LLM client is provider- and model-agnostic. Two fixes came out of the real-model run: rate-limit-aware retries (wait exactly as long as the API asks) and accepting GPT-OSS's 【1】 citation style; the relevance gate now also accepts a strong embedding match because the cross-encoder under-scores short paraphrased questions (e.g. "Can I ship an order to France?" scored 0.04 against the correct EU section).

The offline run uses a keyword-matching mock model and hash embeddings so CI can run without keys; it proves the plumbing (tools, side effects, policy and security checks pass 100%), not answer quality. Policy, security and escalation are 100% even offline because those rules are enforced in code.

## What breaks at scale, and how I would fix it

| At scale… | What breaks | Fix |
|---|---|---|
| 10k+ messages/day | LLM rate limits and cost | Route with the fine-tuned small model; cache answers to frequent questions (semantic cache keyed on the query embedding + document versions); batch the 20B calls; move to provisioned throughput. |
| Many app instances | Telegram long polling and the cron run on every instance | Telegram webhook behind a load balancer; leader election (Postgres advisory lock) for cron and pollers. |
| Large knowledge base | Exact vector scan, re-embedding everything on reindex | HNSW index in pgvector; incremental ingestion by document hash; move to a dedicated vector store only past ~10M chunks. |
| High job volume | Postgres-as-queue contention | Keep the outbox pattern but move workers to a real queue (SQS / Cloud Tasks / BullMQ); idempotency keys on every outbound send. |
| More tools / more agents | Router confusion, prompt bloat | Per-agent tool registries, structured planner, tool-use evals per tool, and contract tests on tool schemas. |
| Prompt injection via email/documents | Model follows instructions inside content | Already: policy in code and ownership checks. Add: content tagging (data vs instructions), allow-listed tool arguments, and an injection classifier on inbound text. |
| Quality drift after model or prompt changes | Silent regressions | Run the eval suite in CI on every change with a real model, fail the build under a threshold, and sample 1–2% of production conversations for human review (feeds accuracy-over-time). |
| Learned rules pile up | Contradictory guidance | Rule versioning, A/B test new rules against the eval set before enabling, expiry for unused rules. |
| Data protection | PII in logs and prompts | PII redaction before logging, retention policies per table, regional hosting (UK/EU), and per-tenant encryption keys. |
| Multi-brand / multi-tenant | One shop hard-wired | Tenant id on every table with row-level security, per-tenant knowledge bases and prompts. |
