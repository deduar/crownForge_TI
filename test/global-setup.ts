import { migrate } from "../src/cli/migrate.js";
import { seed } from "../src/cli/seed.js";

// Real Postgres (docker compose), real migrations, known data. No DB mocks:
// the database IS the thing under test.
export default async function setup() {
  await migrate();
  await seed();
}
