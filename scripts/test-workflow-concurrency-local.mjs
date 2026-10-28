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

const code = `CONC${Date.now().toString(36).toUpperCase()}`;

try {
  const moduleResult = await pool.query(
    `INSERT INTO institutional_modules
       (module_code, title, description, display_order, is_active)
     VALUES ($1, 'Concurrency Test', 'Temporary test', 9999, TRUE)
     RETURNING id`,
    [code]
  );

  moduleId = moduleResult.rows[0].id;

  const activityResult = await pool.query(
    `INSERT INTO module_activities
       (module_id, activity_code, title, display_order, is_active)
     VALUES ($1, 'CONC01', 'Original Activity', 1, TRUE)
     RETURNING id`,
    [moduleId]
  );

  activityId = activityResult.rows[0].id;

  check(true, "Temporary local proposal created");

  const transition = await pool.connect();
  const editor = await pool.connect();

  try {
    await transition.query("BEGIN");

    await transition.query(
      `SELECT id FROM institutional_modules
       WHERE id = $1 FOR UPDATE`,
      [moduleId]
    );

    await transition.query(
      `INSERT INTO module_reviews
         (module_id, approval_status, current_revision)
       VALUES ($1, 'UNDER_REVIEW', 1)`,
      [moduleId]
    );

    check(true, "Review transition holds parent module lock");

    // Start the activity edit on a separate connection.
    // The trigger should wait for the parent row lock.
    const editPromise = editor.query(
      `UPDATE module_activities
       SET title = 'Concurrent Unauthorized Edit'
       WHERE id = $1`,
      [activityId]
    ).then(
      result => ({ ok: true, result }),
      error => ({ ok: false, error })
    );

    // Commit the transition before observing the edit result.
    await transition.query("COMMIT");

    const editResult = await editPromise;

    check(
      !editResult.ok && editResult.error?.code === "23514",
      "Concurrent activity edit rejected after review transition",
      editResult.ok
        ? "Unexpectedly allowed"
        : `SQLSTATE ${editResult.error?.code}`
    );

    const saved = await pool.query(
      `SELECT a.title, r.approval_status
       FROM module_activities a
       JOIN module_reviews r ON r.module_id = a.module_id
       WHERE a.id = $1`,
      [activityId]
    );

    check(
      saved.rows[0]?.title === "Original Activity",
      "Activity content remained unchanged"
    );

    check(
      saved.rows[0]?.approval_status === "UNDER_REVIEW",
      "Review transition committed successfully"
    );

  } finally {
    await transition.query("ROLLBACK").catch(() => {});
    transition.release();
    editor.release();
  }

} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
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

      console.log("PASS: Temporary concurrency records cleaned up");
    } catch (error) {
      failed++;
      console.error("CLEANUP ERROR:", error.message);
    }
  }

  await pool.end();
}

console.log("\n========== CONCURRENCY RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
