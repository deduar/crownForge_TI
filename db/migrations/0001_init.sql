-- 0001 — Initial schema.
-- Multi-tenant by convention only: every row carries company_id, but isolation
-- depends on the application remembering `WHERE company_id = $1` in every query.
-- 0002 moves that guarantee into the database.

CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id),
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies (id),
  owner_id   uuid NOT NULL REFERENCES users (id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT ON companies, users TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO app_user;
