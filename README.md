# Tenant isolation with PostgreSQL Row Level Security

[![CI](https://github.com/deduar/crownForge_TI/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/deduar/crownForge_TI/actions/workflows/ci.yml)

Two companies share one database. A user of company A cannot see, modify, or even
detect anything from company B. **The database enforces it**, not the application code.

Stack: PostgreSQL 17 · Node.js 22 + TypeScript · Fastify · `pg` · Vitest · Docker · GitHub Actions.

## The brief → where to look

| Asked for | Answer |
|---|---|
| 1. A PostgreSQL migration: what it changes and why | [`db/migrations/0002_multi_tenant_rls.sql`](db/migrations/0002_multi_tenant_rls.sql) + [`docs/MIGRATION.md`](docs/MIGRATION.md) (changes, deploy order, locks, rollback) |
| 2. Two companies, isolation done in the database | RLS policies in `0002`, roles in [`db/bootstrap/00_roles.sql`](db/bootstrap/00_roles.sql), tenant context in [`src/db.ts`](src/db.ts) |
| 3. The test that proves the isolation | [`test/rls.db.test.ts`](test/rls.db.test.ts) (database level) · [`test/rls.guard.test.ts`](test/rls.guard.test.ts) (schema guard) · [`test/api.e2e.test.ts`](test/api.e2e.test.ts) (through the API) |

Design trade-offs: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Run it

Requires Docker (and Node 22 for the tests).

```bash
docker compose up -d --build --wait     # postgres → migrate job → api (healthy)
```

Try it, with tokens generated inside the API container:

```bash
ALICE=$(docker compose exec -T api node dist/cli/token.js alice)   # Acme Corp
BOB=$(docker compose exec -T api node dist/cli/token.js bob)       # Globex Inc

curl -s localhost:3000/projects -H "Authorization: Bearer $ALICE"     # only Acme's projects
curl -s localhost:3000/projects -H "Authorization: Bearer $BOB"       # only Globex's project
curl -si localhost:3000/projects/bbbbbbbb-0000-0000-0000-0000000000b1 \
     -H "Authorization: Bearer $ALICE" | head -1                      # 404: Globex's project does not exist for Alice
```

Run the tests:

```bash
npm ci
npm run db:up       # only postgres
npm test            # applies migrations + seed, then runs the suites
npm run db:down     # remove containers and volume
```

## How it works

```
request ─► verify JWT ─► company_id ─► withTenant(): BEGIN
                                                     set_config('app.company_id', id, true)   -- transaction-local
                                                     SELECT … FROM projects                    -- no WHERE company_id
                                                     COMMIT                                    -- context gone
Postgres (as app_user, NOBYPASSRLS):
  policy tenant_isolation: USING / WITH CHECK (company_id = app.current_company_id())
  no context → NULL → 0 rows (fails closed)
```

- **Application code never filters by tenant.** A forgotten `WHERE` cannot leak data.
- **`FORCE ROW LEVEL SECURITY`**: even the table owner is subject to the policies.
- **`WITH CHECK`**: blocks writing into another tenant, not just reading.
- **Composite FK** `(company_id, owner_id)`: FK checks bypass RLS, so cross-tenant references are prevented structurally.
- **Two roles**: `app_owner` runs migrations, `app_user` serves requests (DML only). The superuser is used only to create them.

## What the tests prove

| Scenario | Expected |
|---|---|
| Tenant A reads any table | only A's rows |
| A selects B's project by exact id | 0 rows / HTTP 404 |
| No tenant context set | 0 rows in every table |
| Pooled connection reused after a request | context does not leak |
| A inserts with `company_id = B`, or moves its row to B | rejected by policy |
| A updates/deletes B's rows | 0 rows affected |
| A creates a project owned by B's user | rejected by composite FK |
| Table owner without context | 0 rows (`FORCE`) |
| Any table in `public` without RLS + FORCE + policy | guard test fails |
| Runtime role is superuser / `BYPASSRLS` / owner | guard test fails |
| Missing, forged token; `company_id` in request body | 401 / 401 / 400 |

The suite was checked by breaking the system on purpose (dropping `FORCE`, disabling RLS,
granting `BYPASSRLS`, using a session-level `SET`, adding a table without RLS). Each break
turns at least one test red.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml): lint (Biome) → typecheck →
tests against Postgres from the same compose file → build the image and smoke-test the
full stack (`db → migrate → api`).

## Layout

```
db/bootstrap/00_roles.sql      cluster roles (superuser, once)
db/migrations/*.sql            versioned schema, forward-only
db/seed.sql                    demo data for two companies
src/db.ts                      withTenant(): the only path to tenant data
src/app.ts                     Fastify routes (no tenant filtering in SQL)
src/auth.ts                    JWT verification → principal
src/cli/                       migrate · seed · token
test/                          db-level, guard and e2e suites
```
