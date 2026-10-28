import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base = "http://127.0.0.1:3000";
const dbUrl = process.env.DATABASE_URL;
const parsed = new URL(dbUrl ?? "");

if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to use non-local test database");
}

const pool = new pg.Pool({ connectionString: dbUrl });
const accounts = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const cookies = {};
let passed = 0;
let failed = 0;
let moduleId = null;
let activityId = null;
let commentId = null;

function check(name, condition, detail = "") {
  console.log(
    `${condition ? "PASS" : "FAIL"}: ${name}` +
    (condition ? "" : ` — ${detail}`)
  );
  if (condition) passed++;
  else failed++;
}

async function api(role, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      ...(cookies[role] ? { Cookie: cookies[role] } : {}),
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  return {
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

try {
  for (const account of accounts) {
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
      }),
    });

    const data = await response.json();
    const cookie = response.headers
      .get("set-cookie")
      ?.split(";")[0];

    if (response.status !== 200 || !data.success || !cookie) {
      throw new Error(`Authentication failed: ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  check("All three roles authenticated", true);

  const suffix = randomBytes(5).toString("hex").toUpperCase();

  const created = await api("ADMIN", "POST", "/api/modules", {
    module_code: `C${suffix}`,
    title: "Review Comments Test Proposal",
    is_active: true,
  });

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates test proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) throw new Error("Module creation failed");

  const activity = await api(
    "ADMIN",
    "POST",
    `/api/modules/${moduleId}/activities`,
    {
      activity_code: `A${suffix}`,
      title: "Review Test Activity",
    }
  );

  activityId = activity.data?.data?.id;

  check(
    "ADMIN creates test activity",
    activity.status === 201 && Boolean(activityId),
    `HTTP ${activity.status}: ${activity.data?.error ?? ""}`
  );

  const started = await api(
    "REVIEWER",
    "POST",
    `/api/reviews/${moduleId}/start`
  );

  check(
    "REVIEWER starts proposal review",
    started.status === 200,
    `HTTP ${started.status}`
  );

  const path = `/api/reviews/${moduleId}/comments`;

  const unauthorized = await api(null, "GET", path);

  check(
    "Unauthenticated comment listing rejected",
    unauthorized.status === 401,
    `HTTP ${unauthorized.status}`
  );

  const approverPost = await api(
    "APPROVER",
    "POST",
    path,
    { comment_text: "Not permitted" }
  );

  check(
    "APPROVER cannot add reviewer comments",
    approverPost.status === 403,
    `HTTP ${approverPost.status}`
  );

  const invalid = await api(
    "REVIEWER",
    "POST",
    path,
    { comment_text: "" }
  );

  check(
    "Empty comment rejected",
    invalid.status === 400,
    `HTTP ${invalid.status}`
  );

  const wrongActivity = await api(
    "REVIEWER",
    "POST",
    path,
    {
      comment_text: "Invalid activity reference",
      activity_id: "999999999",
    }
  );

  check(
    "Invalid activity reference rejected",
    wrongActivity.status === 400,
    `HTTP ${wrongActivity.status}`
  );

  const unexpected = await api(
    "REVIEWER",
    "POST",
    path,
    {
      comment_text: "Unexpected fields",
      resolution_status: "RESOLVED",
    }
  );

  check(
    "Unexpected fields rejected",
    unexpected.status === 400,
    `HTTP ${unexpected.status}`
  );

  const added = await api(
    "REVIEWER",
    "POST",
    path,
    {
      comment_text: "Please clarify the proposed activity.",
      activity_id: activityId,
    }
  );

  commentId = added.data?.data?.id;

  check(
    "REVIEWER adds activity-linked comment",
    added.status === 201 &&
      Boolean(commentId) &&
      added.data?.data?.resolution_status === "OPEN",
    `HTTP ${added.status}: ${added.data?.error ?? ""}`
  );

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const listing = await api(role, "GET", path);

    check(
      `${role} reads review comments`,
      listing.status === 200 &&
        listing.data?.data?.some(
          item =>
            item.id === commentId &&
            item.activity_id === activityId
        ),
      `HTTP ${listing.status}`
    );
  }

  const stored = await pool.query(
    `SELECT
       id::text AS id,
       module_id::text AS module_id,
       activity_id::text AS activity_id,
       resolution_status
     FROM module_comments
     WHERE id = $1`,
    [commentId]
  );

  check(
    "Comment saved correctly in PostgreSQL",
    stored.rows.length === 1 &&
      stored.rows[0].module_id === moduleId &&
      stored.rows[0].activity_id === activityId &&
      stored.rows[0].resolution_status === "OPEN"
  );

  const audit = await pool.query(
    `SELECT id
     FROM audit_logs
     WHERE action = 'REVIEW_COMMENT_ADDED'
       AND entity_type = 'module_comments'
       AND entity_id = $1`,
    [commentId]
  );

  check(
    "Comment creation recorded in audit history",
    audit.rows.length === 1
  );

  const reviews = await api("REVIEWER", "GET", "/api/reviews");

  check(
    "Review listing reports unresolved comment",
    reviews.status === 200 &&
      reviews.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.comment_count === 1 &&
          item.unresolved_comment_count === 1
      ),
    `HTTP ${reviews.status}`
  );
} catch (error) {
  console.log(`TEST ERROR: ${error.message}`);
  failed++;
} finally {
  if (moduleId) {
    try {
      await pool.query("BEGIN");

      await pool.query(
        `DELETE FROM audit_logs
         WHERE (
           entity_type = 'module_comments'
           AND entity_id IN (
             SELECT id FROM module_comments WHERE module_id = $1
           )
         ) OR (
           entity_type = 'module_reviews'
           AND entity_id IN (
             SELECT id FROM module_reviews WHERE module_id = $1
           )
         )`,
        [moduleId]
      );

      await pool.query(
        "DELETE FROM module_comments WHERE module_id = $1",
        [moduleId]
      );

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

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK").catch(() => {});
      console.log(`WARNING: Test cleanup failed: ${error.message}`);
    }
  }

  await pool.end();
}

console.log("\n========== REVIEW COMMENTS TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
