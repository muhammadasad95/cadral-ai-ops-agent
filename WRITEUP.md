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
| **Groq (OpenAI-compatible)** | Free tier, very low latency, tool calling. The client is provider-agnostic (Gemini, OpenRouter, Ollama work by changing `LLM_BASE_URL`). | Free-tier rate limits; handled with retries and backoff. |
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
| Offline pipeline check | mock LLM / hash embeddings | 78.3% | 14/20 | 5/6 | 4/8 | 6/8 | 5/5 | 4/4 | 6/6 | 3/3 |
| Production config | GPT-OSS 120B + 20B / MiniLM + cross-encoder | _fill after run_ | | | | | | | | |

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
