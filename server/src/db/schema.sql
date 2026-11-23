-- Idempotent schema. Runs on every start.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','agent'))
);

-- ---------- the shop ----------
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  telegram_chat_id TEXT UNIQUE,
  web_session TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'standard',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price_gbp NUMERIC(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,                       -- e.g. BB-10421
  customer_id INT NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL CHECK (status IN ('processing','shipped','delivered','cancelled','refunded','partially_refunded')),
  items JSONB NOT NULL,
  total_gbp NUMERIC(10,2) NOT NULL,
  refunded_gbp NUMERIC(10,2) NOT NULL DEFAULT 0,
  shipping_address TEXT NOT NULL,
  carrier TEXT,
  tracking_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount_gbp NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('issued','pending_approval','rejected')),
  conversation_id INT,
  decided_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- conversations & shared memory ----------
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL CHECK (channel IN ('web','telegram','email')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','escalated','resolved')),
  subject TEXT,
  handled_by_human BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('customer','assistant','human','system')),
  content TEXT NOT NULL,
  agent TEXT,                                 -- router / support / orders / escalation
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('received','sent','pending_review','rejected','failed')),
  review_reason TEXT,
  citations JSONB NOT NULL DEFAULT '[]',
  reply_to INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id, id);

-- Agent trace: which agent ran, what it decided, which tools it called and why.
CREATE TABLE IF NOT EXISTS traces (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL,
  message_id INT,
  agent TEXT NOT NULL,
  step TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS traces_msg_idx ON traces(message_id);

-- Every LLM call: tokens, cost and latency.
CREATE TABLE IF NOT EXISTS llm_calls (
  id SERIAL PRIMARY KEY,
  conversation_id INT,
  message_id INT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  latency_ms INT NOT NULL DEFAULT 0,
  ok BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escalations (
  id SERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id),
  reason TEXT NOT NULL,
  risk_score NUMERIC(4,2) NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- knowledge base (RAG) ----------
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  source TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL,                    -- pdf / html / csv / md
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
  id SERIAL PRIMARY KEY,
  document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  heading TEXT,
  content TEXT NOT NULL,
  embedding vector(384) NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(heading,'') || ' ' || content)) STORED
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING GIN (tsv);

-- ---------- learning from humans ----------
CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES messages(id),
  action TEXT NOT NULL CHECK (action IN ('approved','edited','rejected')),
  customer_text TEXT NOT NULL,
  original_reply TEXT NOT NULL,
  corrected_reply TEXT,
  note TEXT,
  agent TEXT,
  embedding vector(384),
  user_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Learned rules distilled from repeated corrections (injected into prompts).
CREATE TABLE IF NOT EXISTS learned_rules (
  id SERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  rule TEXT NOT NULL,
  source_feedback_ids INT[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- reliability: durable job queue with retries ----------
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','dead')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 6,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due_idx ON jobs(status, run_at);

CREATE TABLE IF NOT EXISTS eval_runs (
  id SERIAL PRIMARY KEY,
  score NUMERIC(5,2) NOT NULL,
  total INT NOT NULL,
  passed INT NOT NULL,
  model TEXT NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL);
