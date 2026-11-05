// Minimal forward-only migration runner: ordered .sql files, one transaction each,
// advisory lock against concurrent runs, checksum to detect edits to applied files.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { config } from "../config.js";

const DIR = join(process.cwd(), "db/migrations");
const LOCK_ID = 727_001;

export async function migrate(
  connectionString = config.migrationDatabaseUrl,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));

    for (const file of (await readdir(DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(join(DIR, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const known = applied.get(file);
      if (known === checksum) continue;
      if (known)
        throw new Error(
          `${file} was modified after being applied — write a new migration instead`,
        );

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
          [file, checksum],
        );
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [LOCK_ID])
      .catch(() => {});
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate();
}
