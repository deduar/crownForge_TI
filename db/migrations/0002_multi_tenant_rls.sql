-- 0002 — Enforce tenant isolation in the database with Row Level Security.
--
-- What changes and why (full rationale and production notes: docs/MIGRATION.md):
--   1. app.current_company_id(): single source of truth for "who is the tenant".
--   2. RLS ENABLE + FORCE on every tenant table, with USING + WITH CHECK policies.
--   3. company_id defaults to the current tenant: the app never sends it.
--   4. Composite FK (company_id, owner_id): a project cannot point to another
--      tenant's user (FK checks bypass RLS, so this must be a constraint).
--   5. Email uniqueness becomes per-tenant: a global UNIQUE is a cross-tenant
--      existence oracle ("this email is already taken").

-- 1. Tenant context ---------------------------------------------------------
CREATE SCHEMA app;
GRANT USAGE ON SCHEMA app TO app_user;

-- Reads the transaction-local setting written by the API with
-- set_config('app.company_id', <id>, true).
--  * missing_ok = true  -> NULL when never set.
--  * NULLIF(.., '')     -> after a SET LOCAL ends, Postgres leaves '' (not NULL)
--                          on that pooled connection. Both cases mean "no tenant".
-- NULL never equals anything, so with no context every policy matches 0 rows: fail closed.
CREATE FUNCTION app.current_company_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;

-- 2. Row Level Security -----------------------------------------------------
-- FORCE: without it the table owner (app_owner) silently bypasses every policy.
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies FORCE  ROW LEVEL SECURITY;
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE users     FORCE  ROW LEVEL SECURITY;
ALTER TABLE projects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects  FORCE  ROW LEVEL SECURITY;

-- USING      -> which existing rows are visible / updatable / deletable.
-- WITH CHECK -> which rows may be written (blocks INSERT into, or UPDATE to, another tenant).
CREATE POLICY tenant_isolation ON companies
  USING      (id = app.current_company_id())
  WITH CHECK (id = app.current_company_id());

CREATE POLICY tenant_isolation ON users
  USING      (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

CREATE POLICY tenant_isolation ON projects
  USING      (company_id = app.current_company_id())
  WITH CHECK (company_id = app.current_company_id());

-- 3. Tenant comes from context, not from the request body -------------------
ALTER TABLE users    ALTER COLUMN company_id SET DEFAULT app.current_company_id();
ALTER TABLE projects ALTER COLUMN company_id SET DEFAULT app.current_company_id();

-- 4. Same-tenant referential integrity --------------------------------------
ALTER TABLE users ADD CONSTRAINT users_company_id_id_key UNIQUE (company_id, id);

ALTER TABLE projects DROP CONSTRAINT projects_owner_id_fkey;
ALTER TABLE projects ADD CONSTRAINT projects_owner_same_company_fkey
  FOREIGN KEY (company_id, owner_id) REFERENCES users (company_id, id);

-- Leading company_id: serves the RLS predicate and the composite FK.
CREATE INDEX projects_company_id_owner_id_idx ON projects (company_id, owner_id);

-- 5. Uniqueness scoped to the tenant ----------------------------------------
ALTER TABLE users DROP CONSTRAINT users_email_key;
ALTER TABLE users ADD CONSTRAINT users_company_id_email_key UNIQUE (company_id, email);
