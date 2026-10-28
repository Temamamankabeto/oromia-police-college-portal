import pg from "pg";

const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});

let moduleId;
let activityId;
let passed = 0;
let failed = 0;

function check(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label} ${detail}`);
  }
}

const code = `REVCONC${Date.now().toString(36).toUpperCase()}`;

let editor;
let reviewer;

try {
  const created = await pool.query(
    `INSERT INTO institutional_modules
       (module_code, title, description, display_order, is_active)
     VALUES ($1, 'Reverse Concurrency Test',
       'Temporary local test', 9998, TRUE)
     RETURNING id`,
    [code]
  );

  moduleId = created.rows[0].id;

  const activity = await pool.query(
    `INSERT INTO module_activities
       (module_id, activity_code, title, display_order, is_active)
     VALUES ($1, 'REVC01', 'Original Activity', 1, TRUE)
     RETURNING id`,
    [moduleId]
  );

  activityId = activity.rows[0].id;

  check(true, "Temporary proposal and activity created");

  editor = await pool.connect();
  reviewer = await pool.connect();

  await editor.query("BEGIN");

  await editor.query(
    `UPDATE module_activities
     SET title = 'Edited Before Review'
     WHERE id = $1`,
    [activityId]
  );

  check(true, "Activity edit holds transaction open");

  await reviewer.query("BEGIN");

  // A short lock timeout proves that the reviewer cannot
  // acquire the parent module lock while editing is active.
  await reviewer.query("SET LOCAL lock_timeout = '500ms'");

  let blocked = false;

  try {
    await reviewer.query(
      `SELECT id
       FROM institutional_modules
       WHERE id = $1
       FOR UPDATE`,
      [moduleId]
    );
  } catch (error) {
    blocked = error.code === "55P03";
  }

  check(
    blocked,
    "Review transition waits for active activity edit"
  );

  // A lock timeout aborts the reviewer transaction.
  await reviewer.query("ROLLBACK");

  await editor.query("COMMIT");

  check(true, "Activity edit committed");

  await reviewer.query("BEGIN");

  await reviewer.query(
    `SELECT id
     FROM institutional_modules
     WHERE id = $1
     FOR UPDATE`,
    [moduleId]
  );

  await reviewer.query(
    `INSERT INTO module_reviews
       (module_id, approval_status, current_revision)
     VALUES ($1, 'UNDER_REVIEW', 1)`,
    [moduleId]
  );

  await reviewer.query("COMMIT");

  check(true, "Review transition succeeds after edit commits");

  const result = await pool.query(
    `SELECT
       a.title,
       r.approval_status
     FROM module_activities a
     JOIN module_reviews r
       ON r.module_id = a.module_id
     WHERE a.id = $1`,
    [activityId]
  );

  check(
    result.rows[0]?.title === "Edited Before Review",
    "Committed activity edit preserved"
  );

  check(
    result.rows[0]?.approval_status === "UNDER_REVIEW",
    "Review status persisted correctly"
  );

} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  if (editor) {
    await editor.query("ROLLBACK").catch(() => {});
    editor.release();
  }

  if (reviewer) {
    await reviewer.query("ROLLBACK").catch(() => {});
    reviewer.release();
  }

  if (moduleId) {
    try {
      await pool.query(
        "DELETE FROM module_reviews WHERE module_id = $1",
        [moduleId]
      );

      await pool.query(
        "DELETE FROM module_activities WHERE module_id = $1",
        [moduleId]
      );

      await pool.query(
        "DELETE FROM institutional_modules WHERE id = $1",
        [moduleId]
      );

      console.log("PASS: Temporary records cleaned up");
    } catch (error) {
      failed++;
      console.error("CLEANUP ERROR:", error.message);
    }
  }

  await pool.end();
}

console.log("\n========== REVERSE CONCURRENCY RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
