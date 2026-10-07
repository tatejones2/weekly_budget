CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- One row per user; its existence IS the onboarding gate (replaces today's id:'main').
CREATE TABLE settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_week_start DATE NOT NULL,
  opening_carryover_cents BIGINT NOT NULL,
  time_zone TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  last_backup_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ids stay TEXT (not UUID), supplied by the caller, so client-side newId()
-- (crypto.randomUUID()) and literal starter-category ids ('cat-dining' etc.)
-- both keep working unchanged. Primary keys are composite (user_id, id) —
-- NOT a bare `id` — because the starter-category ids are the same literal
-- strings for every user; a global PK on `id` alone would let the first
-- user's "cat-dining" permanently block every other user from ever getting
-- one. Every FK that points at one of these tables is a composite FK
-- (user_id, x_id) for the same reason, which also means a row can never
-- accidentally reference another user's category/template.
CREATE TABLE categories (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name_key)
);
CREATE INDEX categories_user_sort_idx ON categories(user_id, sort_order);

CREATE TABLE budget_changes (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effective_week_start DATE NOT NULL,
  base_allowance_cents BIGINT NOT NULL CHECK (base_allowance_cents >= 0),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, effective_week_start)
);

CREATE TABLE templates (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL,
  merchant_name_key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed', 'variable')),
  amount_cents BIGINT CHECK (amount_cents IS NULL OR amount_cents > 0),
  category_id TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'fixed' AND amount_cents IS NOT NULL) OR (kind = 'variable' AND amount_cents IS NULL))
);
CREATE INDEX templates_user_merchant_key_idx ON templates(user_id, merchant_name_key);
CREATE INDEX templates_user_category_idx ON templates(user_id, category_id);

CREATE TABLE expenses (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL,
  merchant_name_key TEXT NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'refund')),
  category_id TEXT NOT NULL,
  date DATE NOT NULL,
  note TEXT,
  -- deleteTemplate's "null out the back-reference, keep the expense" contract
  -- is enforced by this FK itself.
  template_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, category_id) REFERENCES categories(user_id, id) ON DELETE RESTRICT,
  -- Composite FK: ON DELETE SET NULL must name only `template_id` (PG15+
  -- syntax) — without the explicit column list, Postgres would null out
  -- `user_id` too and violate its NOT NULL constraint.
  FOREIGN KEY (user_id, template_id) REFERENCES templates(user_id, id) ON DELETE SET NULL (template_id)
);
CREATE INDEX expenses_user_date_idx ON expenses(user_id, date);
CREATE INDEX expenses_user_category_idx ON expenses(user_id, category_id);
CREATE INDEX expenses_user_merchant_key_idx ON expenses(user_id, merchant_name_key);
CREATE INDEX expenses_user_template_idx ON expenses(user_id, template_id);
