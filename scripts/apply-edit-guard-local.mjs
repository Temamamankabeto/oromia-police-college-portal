import pg from "pg";
import { readFile } from "node:fs/promises";

const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to modify a non-local database");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();

try {
  await client.query("BEGIN");

  await client.query(
    await readFile(
      "database/migrations/008_proposal_edit_guard.sql",
      "utf8"
    )
  );

  await client.query("COMMIT");
  console.log("PASS: Corrected proposal guards installed");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
