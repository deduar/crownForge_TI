# Migration `0002_multi_tenant_rls.sql` — what changes and why

## Starting point (`0001_init.sql`)

Every tenant table already carries `company_id`, but isolation is a **convention**:
each query must remember `WHERE company_id = $1`. One forgotten filter — in an
endpoint, a report, a background job, an ad-hoc script — is a cross-tenant data leak,
and nothing in the system would notice.

## Goal

Move the guarantee from "every developer, every query, forever" to **one place the
database enforces**: if the tenant is not established, nothing is visible; if it is,
only that tenant's rows are visible *and writable*.

## Real-world precedent

In a production Supabase SaaS I wrote the migration that enabled RLS on every `public`
table with **no policies**: the browser's public key (`anon`/`authenticated`) became fully
blocked, and only the backend, using `service_role`, could read or write. That closed direct
access through the public API, but authorization still lived in application code, because
`service_role` bypasses RLS. This demo is the next step: the database enforces tenant
isolation even for the application's own role.

## What changes

| # | Change | Why |
|---|---|---|
| 1 | `app.current_company_id()` reads `current_setting('app.company_id', true)` | Single source of truth for the tenant. `missing_ok` + `NULLIF(…, '')` turn "never set" and "set by a finished transaction" into `NULL`, which matches no row → **fails closed**. |
| 2 | `ENABLE` + **`FORCE`** `ROW LEVEL SECURITY` on `companies`, `users`, `projects` | `ENABLE` alone does not apply to the table **owner**. `FORCE` closes that gap, so even `app_owner` (migrations, scripts) must declare a tenant. |
| 3 | Policies with **`USING` and `WITH CHECK`** | `USING` filters what is read/updated/deleted. `WITH CHECK` filters what is written: without it, tenant A could `INSERT` rows for B or `UPDATE … SET company_id = B`. |
| 4 | `company_id DEFAULT app.current_company_id()` | The application never sends `company_id`; it cannot send the wrong one. |
| 5 | Composite FK `projects (company_id, owner_id) → users (company_id, id)` | **Foreign-key checks bypass RLS.** With a plain FK on `owner_id`, A could attach a project to B's user, and the FK error/success becomes an oracle for "does this id exist". The composite FK makes cross-tenant references structurally impossible. |
| 6 | Index `projects (company_id, owner_id)` | Serves the policy predicate (leading `company_id`) and the composite FK. |
| 7 | `UNIQUE (email)` → `UNIQUE (company_id, email)` | A global unique constraint leaks across tenants ("email already taken" reveals that the email exists in another company). Uniqueness becomes a per-tenant business rule. |

Grants are untouched: `app_user` (runtime) keeps DML only and is `NOBYPASSRLS`;
`app_owner` owns the schema and runs migrations. The `postgres` superuser is only used
to bootstrap the cluster (`db/bootstrap/00_roles.sql`), because superusers always bypass RLS.

## Deploy order (the part that breaks production if done wrong)

Once RLS is on, **any code path that does not set the tenant sees zero rows**. It does
not crash; it silently returns empty results. That gives a strict order:

1. **Expand (app):** deploy code that runs every tenant query through `withTenant()`.
   This is harmless before the migration (`set_config` with no policies has no effect),
   and the existing `WHERE company_id` filters still act as protection.
2. **Migrate:** apply `0002`. The database now enforces isolation.
3. **Contract (app):** the explicit filters become redundant. They can stay as
   defence in depth or be removed.

Background jobs, cron jobs and admin scripts are the usual stragglers in step 1. The
guard test (`test/rls.guard.test.ts`) and staging with production-like data are what catch them.

## Locks — how this would run on a large, live table

In the demo everything runs in one transaction because the tables are empty. On a busy
production database I would split it, since several statements take
`ACCESS EXCLUSIVE` or scan the whole table:

| Statement | Lock / cost | Production approach |
|---|---|---|
| `ENABLE/FORCE RLS`, `CREATE POLICY`, `SET DEFAULT` | `ACCESS EXCLUSIVE`, metadata only (fast) | Fine, but set `lock_timeout = '3s'` so it fails fast instead of queueing behind a long transaction and blocking everyone behind it. Retry. |
| `ADD CONSTRAINT … UNIQUE (company_id, id)` / `(company_id, email)` | `ACCESS EXCLUSIVE` for the whole index build: blocks reads **and** writes | `CREATE UNIQUE INDEX CONCURRENTLY` first, then `ADD CONSTRAINT … UNIQUE USING INDEX` (instant). |
| `ADD FOREIGN KEY (company_id, owner_id)` | Validates every row while holding a lock that blocks writes | `ADD CONSTRAINT … NOT VALID` (instant, enforced for new rows), then `VALIDATE CONSTRAINT` in a later step (`SHARE UPDATE EXCLUSIVE`, does not block reads or writes). |
| `CREATE INDEX` | `SHARE`: blocks writes for the whole build | `CREATE INDEX CONCURRENTLY`. It cannot run inside a transaction, so it goes in its own migration file. |

The resulting split: `0002a` concurrent indexes (non-transactional) → `0002b` RLS,
policies, defaults and constraints `NOT VALID` (transactional, with `lock_timeout`) →
`0002c` `VALIDATE CONSTRAINT`.

## Rollback

The runner is **forward-only** on purpose: a rollback is a new, reviewed migration.
It also refuses to run if an already-applied file was edited (checksum check). The
inverse of `0002`, should it be needed:

```sql
DROP POLICY tenant_isolation ON projects;
DROP POLICY tenant_isolation ON users;
DROP POLICY tenant_isolation ON companies;
ALTER TABLE projects  NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
ALTER TABLE users     NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
ALTER TABLE companies NO FORCE ROW LEVEL SECURITY, DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE users    ALTER COLUMN company_id DROP DEFAULT;
ALTER TABLE users DROP CONSTRAINT users_company_id_email_key;
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);  -- fails if per-tenant duplicates now exist
ALTER TABLE projects DROP CONSTRAINT projects_owner_same_company_fkey;
ALTER TABLE projects ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id);
DROP INDEX projects_company_id_owner_id_idx;
ALTER TABLE users DROP CONSTRAINT users_company_id_id_key;
DROP SCHEMA app CASCADE;
```

The rollback is not fully symmetric: once two companies hold the same email, the global
unique constraint cannot be restored without a data decision. That one-way door is worth
calling out in the PR review.

## RLS pitfalls this design avoids

- **Superuser / `BYPASSRLS` / table owner** bypass policies → separate runtime role, `FORCE`, and a guard test that asserts it.
- **Session-level `SET` with a connection pool** leaks the tenant to the next request → `set_config(…, true)` (transaction-local). This is also compatible with PgBouncer in transaction mode, where session state is unsafe by design.
- **Views** run with the owner's privileges and skip RLS unless created `WITH (security_invoker = true)` (PG15+). The same applies to `SECURITY DEFINER` functions. Neither exists here; both should be flagged in code review.
- **FK checks and unique constraints** ignore RLS → composite FK and per-tenant uniqueness.
- **Performance:** the predicate is a `STABLE` function compared to an indexed column, so the planner can use the index. On very large tables, wrapping it as `(SELECT app.current_company_id())` makes Postgres evaluate it once per statement (initplan) rather than per row.
