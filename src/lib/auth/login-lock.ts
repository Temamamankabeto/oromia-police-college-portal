import "server-only";
import { getPool } from "@/lib/db";
import type { PoolClient } from "pg";

export async function withLoginLock<T>(
  accountKey: string,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [accountKey]
    );

    const result = await operation(client);

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("Login transaction rollback failed:", rollbackError);
    }

    throw error;
  } finally {
    client.release();
  }
}
