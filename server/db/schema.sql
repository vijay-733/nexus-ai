-- ════════════════════════════════════════════════════════════════
--  Nexus AI Agent OS — PostgreSQL Schema
--  Run via: psql $POSTGRES_URL -f schema.sql
--  Or auto-applied on startup via server/db/migrate.ts
-- ════════════════════════════════════════════════════════════════

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  plan          TEXT        NOT NULL DEFAULT 'free',
  credits       INT         NOT NULL DEFAULT 100,
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── API Keys ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash     TEXT        NOT NULL UNIQUE,
  name         TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL DEFAULT '{}',
  revoked      BOOLEAN     NOT NULL DEFAULT FALSE,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ── Plan Subscriptions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_subscriptions (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                    TEXT        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'active',
  stripe_subscription_id  TEXT,
  stripe_customer_id      TEXT,
  current_period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end      TIMESTAMPTZ,
  cancelled_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_user ON plan_subscriptions(user_id);

-- ── Credit Transactions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id),
  amount       INT         NOT NULL,
  balance_after INT        NOT NULL,
  action       TEXT        NOT NULL,
  provider     TEXT,
  task_id      UUID,
  agent_id     TEXT,
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credits_created ON credit_transactions(created_at);

-- ── Workflows ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflows (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'pending',
  input        JSONB,
  output       JSONB,
  error        TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_workflows_user   ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- ── Workflow Nodes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name         TEXT        NOT NULL,
  type         TEXT        NOT NULL,
  agent_name   TEXT,
  tool_name    TEXT,
  input        JSONB,
  output       JSONB,
  status       TEXT        NOT NULL DEFAULT 'pending',
  dependencies TEXT[]      NOT NULL DEFAULT '{}',
  retries      INT         NOT NULL DEFAULT 0,
  max_retries  INT         NOT NULL DEFAULT 3,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_nodes_workflow ON workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_nodes_status   ON workflow_nodes(status);

-- ── Tasks ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  workflow_id  UUID        REFERENCES workflows(id) ON DELETE SET NULL,
  type         TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending',
  priority     TEXT        NOT NULL DEFAULT 'normal',
  input        JSONB       NOT NULL,
  output       JSONB,
  plan         JSONB,
  step_results JSONB,
  error        TEXT,
  duration_ms  INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tasks_user    ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);

-- ── Memory Records ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memory_records (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace  TEXT        NOT NULL,
  key        TEXT        NOT NULL,
  value      JSONB       NOT NULL,
  user_id    UUID        REFERENCES users(id) ON DELETE CASCADE,
  task_id    UUID,
  agent_id   TEXT,
  session_id TEXT,
  tags       TEXT[]      NOT NULL DEFAULT '{}',
  ttl        TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(namespace, key)
);

CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_records(namespace);
CREATE INDEX IF NOT EXISTS idx_memory_user      ON memory_records(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_tags      ON memory_records USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_memory_session   ON memory_records(session_id);

-- ── Usage Records ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usage_records (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id),
  action        TEXT        NOT NULL,
  provider      TEXT        NOT NULL DEFAULT 'unknown',
  status        TEXT        NOT NULL,
  duration_ms   INT         NOT NULL DEFAULT 0,
  credits_used  INT         NOT NULL DEFAULT 0,
  tokens_used   INT         NOT NULL DEFAULT 0,
  prompt_preview TEXT,
  task_id       UUID,
  workflow_id   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_user    ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_action  ON usage_records(action);

-- ── Audit Log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  resource    TEXT        NOT NULL,
  resource_id TEXT,
  result      TEXT        NOT NULL DEFAULT 'success',
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);

-- ── Checkpoints ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checkpoints (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    TEXT        NOT NULL,
  step       INT         NOT NULL,
  state      JSONB       NOT NULL,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(task_id, step)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_task ON checkpoints(task_id);

-- ── Jobs (Durable Queue) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT        NOT NULL,
  payload      JSONB       NOT NULL,
  priority     TEXT        NOT NULL DEFAULT 'normal',
  status       TEXT        NOT NULL DEFAULT 'pending',
  attempts     INT         NOT NULL DEFAULT 0,
  max_attempts INT         NOT NULL DEFAULT 3,
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL,
  task_id      UUID,
  timeout_ms   INT,
  result       JSONB,
  error        TEXT,
  queue_name   TEXT        NOT NULL DEFAULT 'default',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type      ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_user      ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_queue     ON jobs(queue_name, status, scheduled_at);

-- ── Dead Letter Queue ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  original_job JSONB       NOT NULL,
  failure_reason TEXT      NOT NULL,
  attempts     INT         NOT NULL,
  failed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Agent Sessions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        REFERENCES users(id) ON DELETE CASCADE,
  task_id      UUID,
  agent_name   TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'running',
  step_count   INT         NOT NULL DEFAULT 0,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  metadata     JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON agent_sessions(user_id);

-- ── Updated-at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'users_updated_at'
  ) THEN
    CREATE TRIGGER users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'memory_updated_at'
  ) THEN
    CREATE TRIGGER memory_updated_at
      BEFORE UPDATE ON memory_records
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
