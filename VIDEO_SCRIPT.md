# Demo video script (3:30)

Record at 1080p with the dashboard on the left half and the customer chat (or Telegram) on the right. Speak calmly; cut pauses in editing. Background music low.

| Time | Screen | What you say |
|---|---|---|
| 0:00–0:15 | Title card: "Brightbasket AI Ops — an AI that runs customer operations" | "This is an AI system that runs customer operations for a UK online shop on its own: it answers customers, takes real actions, learns from corrections and reports to management." |
| 0:15–0:35 | Architecture diagram from the README | "Every message, from web chat, Telegram or email, is stored first, then a router sends it to one of three agents: support, orders or escalation. They share one memory of the conversation and the customer." |
| 0:35–1:05 | Customer chat as **Emma**: "How long do refunds take to show on my card?" — answer streams in with citation chips | "Support answers only from our 24 documents using hybrid search — keyword plus vector, reranked. Every sentence has a citation." Then ask "What's the capital of Peru?" → "And when it doesn't know, it says so instead of guessing." |
| 1:05–1:40 | Chat: "The pillowcases in BB-10401 arrived damaged, please refund them." → dashboard: open the conversation, click the reply, show the **agent trace** | "This is a real action. The orders agent called get_order, then issue_refund — you can see each tool call and why it made it. The refund is now in the database. The rules — 30-day window, own orders only, big refunds need approval — are enforced in code, so the model can't break them." |
| 1:40–2:05 | Telegram on your phone (screen mirror): "My kettle caught fire!" → Slack alert appears → dashboard Escalations | "Angry, legal or safety messages go straight to escalation. The customer gets told a human is coming, and the team gets a Slack alert with a summary, so nobody has to repeat themselves." |
| 2:05–2:35 | Dashboard: a held reply → **Edit** and send → Learning page shows the feedback and a learned rule | "Humans can approve, edit or reject any reply. Every correction is saved, similar corrections are shown to the AI next time, and repeated ones become rules — this is how it improves." |
| 2:35–2:55 | Analytics page; Ops page → "Send report now" → email arrives | "Management sees auto-resolution, response time, cost per conversation and accuracy over time, and gets a daily report by email and Slack." |
| 2:55–3:15 | Terminal: `npm run eval` scrolling, final SCORE line; then Evals page with fine-tuning table | "Sixty automated test cases run with one command. I also fine-tuned a 1.5-billion-parameter model for routing and compared it with the base model and a 120B model on accuracy, latency and cost." |
| 3:15–3:30 | README top + live URL | "It's Dockerised, deployed on free tiers, with secrets in environment variables. The repo has the architecture, trade-offs and what I'd change at scale. Thanks for watching." |

## Before recording
1. Reset demo data: dashboard → Operations → **Reset demo data** (admin).
2. Set review mode to **SMART** so one reply is held for the edit demo (e.g. ask a borderline question).
3. Have Slack, Telegram and the report inbox open in tabs.
