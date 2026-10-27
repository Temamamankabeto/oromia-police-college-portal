import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 10000,
});

try {
  const result = await pool.query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      current_setting('server_version') AS server_version
  `);

  console.table(result.rows);
  console.log("PostgreSQL connection successful.");
} catch (error) {
  console.error("PostgreSQL connection failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
