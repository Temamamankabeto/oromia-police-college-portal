import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 10000,
});

const directory = join(process.cwd(), "database", "migrations");

async function main() {
  const client = await pool.connect();

  try {
    const files = (await readdir(directory))
      .filter((file) => /^\d+_.*\.sql$/.test(file))
      .sort();

    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");

    const { rows } = await client.query(
      "SELECT version FROM schema_migrations"
    );

    const applied = new Set(rows.map((row) => row.version));

    for (const file of files) {
      const sql = await readFile(join(directory, file), "utf8");

      if (applied.has(file)) {
        console.log(`SKIP ${file}`);
        continue;
      }

      const checksum = createHash("sha256")
        .update(sql)
        .digest("hex");

      console.log(`APPLY ${file} (${checksum.slice(0, 12)})`);

      await client.query(sql);

      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [file]
      );
    }

    await client.query("COMMIT");
    console.log("All migrations completed successfully.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    client.release();
  }
}

try {
  await main();
} finally {
  await pool.end();
}
