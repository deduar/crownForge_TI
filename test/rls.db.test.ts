// Tenant isolation enforced by Postgres itself, exercised as the runtime role
// (app_user) through the same withTenant() helper the API uses.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { withTenant } from "../src/db.js";
import { SEED } from "../src/seed-ids.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const asAcme = <T>(fn: (db: pg.PoolClient) => Promise<T>) =>
  withTenant(pool, SEED.acme, fn);

afterAll(() => pool.end());

describe("reads", () => {
  it("a tenant sees only its own rows in every table", async () => {
    await asAcme(async (db) => {
      const companies = await db.query("SELECT id FROM companies");
      const users = await db.query("SELECT company_id FROM users");
      const projects = await db.query("SELECT company_id FROM projects");

      expect(companies.rows).toEqual([{ id: SEED.acme }]);
      expect(users.rows.length).toBeGreaterThan(0);
      expect(projects.rows.length).toBeGreaterThan(0);
      for (const r of [...users.rows, ...projects.rows])
        expect(r.company_id).toBe(SEED.acme);
    });
  });

  it("another tenant's row is invisible even when queried by its exact id", async () => {
    const { rowCount } = await asAcme((db) =>
      db.query("SELECT 1 FROM projects WHERE id = $1", [SEED.globexProject]),
    );
    expect(rowCount).toBe(0);
  });

  it("fails closed: without tenant context nothing is visible", async () => {
    for (const table of ["companies", "users", "projects"]) {
      const { rowCount } = await pool.query(`SELECT 1 FROM ${table}`);
      expect(rowCount, table).toBe(0);
    }
  });

  it("tenant context does not leak to the next use of a pooled connection", async () => {
    const single = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 1,
    });
    try {
      await withTenant(single, SEED.acme, (db) => db.query("SELECT 1"));
      const { rowCount } = await single.query("SELECT 1 FROM projects"); // same physical connection
      expect(rowCount).toBe(0);
    } finally {
      await single.end();
    }
  });
});

describe("writes", () => {
  it("cannot INSERT a row into another tenant", async () => {
    await expect(
      asAcme((db) =>
        db.query(
          "INSERT INTO projects (company_id, owner_id, name) VALUES ($1, $2, 'x')",
          [SEED.globex, SEED.bob.userId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot UPDATE or DELETE another tenant's rows (0 rows affected)", async () => {
    await asAcme(async (db) => {
      const upd = await db.query(
        "UPDATE projects SET name = 'pwned' WHERE id = $1",
        [SEED.globexProject],
      );
      const del = await db.query("DELETE FROM projects WHERE id = $1", [
        SEED.globexProject,
      ]);
      expect(upd.rowCount).toBe(0);
      expect(del.rowCount).toBe(0);
    });
  });

  it("cannot move an own row into another tenant", async () => {
    await expect(
      asAcme((db) =>
        db.query("UPDATE projects SET company_id = $1 WHERE id = $2", [
          SEED.globex,
          SEED.acmeProjects[0],
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot reference another tenant's user (composite FK)", async () => {
    await expect(
      asAcme((db) =>
        db.query("INSERT INTO projects (owner_id, name) VALUES ($1, 'x')", [
          SEED.bob.userId,
        ]),
      ),
    ).rejects.toThrow(/projects_owner_same_company_fkey/);
  });

  it("company_id is filled from the tenant context", async () => {
    // Written inside a rolled-back transaction to keep the seed intact.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.company_id', $1, true)", [
        SEED.acme,
      ]);
      const { rows } = await client.query(
        "INSERT INTO projects (owner_id, name) VALUES ($1, 'ctx') RETURNING company_id",
        [SEED.alice.userId],
      );
      expect(rows[0].company_id).toBe(SEED.acme);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("table owner", () => {
  it("is subject to RLS too (FORCE ROW LEVEL SECURITY)", async () => {
    const owner = new pg.Client({
      connectionString: config.migrationDatabaseUrl,
    });
    await owner.connect();
    try {
      const { rowCount } = await owner.query("SELECT 1 FROM projects");
      expect(rowCount).toBe(0);
    } finally {
      await owner.end();
    }
  });
});
