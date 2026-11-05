// Guard rails: catch the *next* mistake, not just today's.
// If someone adds a table and forgets RLS, or the runtime role gains superpowers, CI fails.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";

// Tables allowed to exist without tenant isolation. Adding to this list is a reviewed decision.
const NON_TENANT_TABLES = ["schema_migrations"];

const owner = new pg.Pool({ connectionString: config.migrationDatabaseUrl });
afterAll(() => owner.end());

describe("schema guard", () => {
  it("every table in public is tenant-scoped with RLS enabled, forced and a policy", async () => {
    const { rows } = await owner.query(
      `SELECT c.relname AS table,
              c.relrowsecurity AS rls,
              c.relforcerowsecurity AS forced,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
              (c.relname = 'companies' OR EXISTS (
                 SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped)) AS tenant_scoped
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> ALL($1)
        ORDER BY 1`,
      [NON_TENANT_TABLES],
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const t of rows) {
      expect(t, t.table).toMatchObject({
        rls: true,
        forced: true,
        tenant_scoped: true,
      });
      expect(t.policies, `${t.table} has no policy`).toBeGreaterThan(0);
    }
  });

  it("the runtime role cannot bypass RLS and owns nothing", async () => {
    const { rows } = await owner.query(
      `SELECT rolsuper, rolbypassrls,
              (SELECT count(*)::int FROM pg_class WHERE relowner = r.oid) AS owned
         FROM pg_roles r WHERE rolname = 'app_user'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: 0 });
  });
});
