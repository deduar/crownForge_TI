# Design decisions

Short ADRs: context, decision, and what we give up.

## 1. Tenant isolation in the database (RLS), not only in the application

- **Options:** `WHERE company_id` in the app · RLS on shared tables · schema per tenant · database per tenant.
- **Decision:** shared tables + RLS.
- **Why:** isolation holds even when application code is wrong. One schema means one
  migration path and cheap tenants. Schema- or database-per-tenant gives stronger
  physical isolation, but migrations, connections and operations grow with the number of tenants.
- **Trade-off:** we rely on Postgres semantics that are easy to get subtly wrong
  (owner bypass, FK checks, views). Mitigated by the guard test and the pitfalls list in `MIGRATION.md`.
  For a tenant with regulatory needs for physical isolation, a dedicated database is still an option later.

## 2. Tenant context as a transaction-local setting

- **Options:** session `SET` · `SET LOCAL` / `set_config(…, true)` · one database role per tenant.
- **Decision:** `set_config('app.company_id', $1, true)` inside `withTenant()`, a transaction per request.
- **Why:** the value cannot outlive the transaction, so pooled connections never carry
  a tenant into another request (tested). It works with PgBouncer in transaction mode.
  Role-per-tenant does not scale and complicates pooling.
- **Trade-off:** every tenant query runs inside an explicit transaction. That is negligible for this workload.

## 3. Two database roles: owner and runtime

- `app_owner` owns the schema and runs migrations. `app_user` is what the API uses: DML only, `NOBYPASSRLS`, owns nothing.
- **Why:** owners and superusers bypass RLS. Even with `FORCE`, a runtime role that cannot run DDL limits the impact of SQL injection.
- The `postgres` superuser is used only for cluster bootstrap (creating the roles).

## 4. Plain SQL migrations with a tiny runner, no ORM

- **Why:** the core of this work is RLS, policies, constraints and locks, and ORMs either cannot express it or hide it behind raw-SQL escape hatches. About 60 lines give ordering, one transaction per file, an advisory lock against concurrent runs, and a checksum against edited history.
- **Trade-off:** no generated types or schema diffing. In a larger codebase I would add a typed query builder (e.g. Kysely) on top of the same SQL migrations. Prisma also works with RLS, but the tenant must be set inside an interactive transaction or through a client extension, and that is where teams usually get it wrong.

## 5. Cross-tenant access returns 404, not 403

- **Why:** a 403 confirms the resource exists. With RLS the row really is invisible, so "not found" is also the honest answer.

## 6. Tests against a real Postgres, plus a guard test

- No database mocks: the database is the component under test. Compose gives the same Postgres and role bootstrap locally and in CI.
- `rls.guard.test.ts` checks the catalog: every table in `public` must be tenant-scoped with RLS enabled, forced and a policy, and `app_user` must not be superuser, `BYPASSRLS` or an owner. It protects against the *next* table someone adds, not just today's.
- The suite was mutation-checked by hand: removing `FORCE`, disabling RLS, granting `BYPASSRLS`, switching to a session-level `SET`, and adding a table without RLS each make at least one test fail.

## Out of scope (deliberately)

- **Identity:** tokens come from a script. In production an IdP issues them, and the `company_id` claim, or a membership lookup, is the only input to the tenant context.
- **Users in several companies:** this would need a `memberships` table and a tenant chosen per request, validated against memberships. The RLS layer stays the same.
- **Cross-tenant admin and support tooling:** a separate audited role or service, never the runtime role.
- **Cloud deployment:** the image and the "migrate job before API" shape in compose map directly to a pre-deploy job in any orchestrator.
