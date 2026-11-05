import { buildApp } from "./app.js";
import { config } from "./config.js";
import { createPool } from "./db.js";

const pool = createPool(config.databaseUrl);
const app = buildApp({ pool, jwtSecret: config.jwtSecret, logger: true });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ host: "0.0.0.0", port: config.port });
