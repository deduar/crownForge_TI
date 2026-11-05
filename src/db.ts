import pg from "pg";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

/**
 * The ONLY way the application touches tenant data.
 *
 * Opens a transaction and sets the tenant with set_config(..., is_local = true),
 * the equivalent of SET LOCAL: the value dies with the transaction, so a pooled
 * connection can never carry tenant A's context into tenant B's request.
 * A session-level SET here would be a cross-tenant leak waiting to happen.
 */
export async function withTenant<T>(
  pool: pg.Pool,
  companyId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [
      companyId,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
