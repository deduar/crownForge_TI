import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { config } from "../config.js";

export async function seed(
  connectionString = config.migrationDatabaseUrl,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      await readFile(join(process.cwd(), "db/seed.sql"), "utf8"),
    );
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seed();
  console.log("seeded");
}
