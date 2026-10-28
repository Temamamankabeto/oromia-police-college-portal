import pg from "pg";

const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

await client.connect();

try {
  await client.query("BEGIN");

  const before = await client.query(`
    SELECT id, session_version
    FROM app_users
    WHERE email = 'reviewer.test@opc.example'
      AND deleted_at IS NULL
    FOR UPDATE
  `);

  if (before.rows.length !== 1) {
    throw new Error("Reviewer test account not found");
  }

  const { id, session_version } = before.rows[0];

  console.log("Initial session version:", session_version);

  const updated = await client.query(
    `UPDATE app_users
     SET session_version = session_version + 1
     WHERE id = $1
     RETURNING session_version`,
    [id]
  );

  const nextVersion = updated.rows[0].session_version;

  if (nextVersion !== session_version + 1) {
    throw new Error("Session version did not increment");
  }

  console.log("Updated session version:", nextVersion);

  await client.query("ROLLBACK");

  console.log("PASS: Session version increments correctly");
  console.log("PASS: Test changes rolled back");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
