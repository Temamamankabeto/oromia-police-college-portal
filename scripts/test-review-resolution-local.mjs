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
  throw new Error("Refusing non-local test database");
}

const pool = new pg.Pool({ connectionString: dbUrl });
const accounts = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const cookies = {};
let passed = 0;
let failed = 0;
let moduleId = null;
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
      throw new Error(`Login failed: ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  check("All three roles authenticated", true);

  const suffix = randomBytes(5).toString("hex").toUpperCase();

  const created = await api("ADMIN", "POST", "/api/modules", {
    module_code: `S${suffix}`,
    title: "Comment Resolution Test Proposal",
    is_active: true,
  });

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates test proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) throw new Error("Module creation failed");

  const started = await api(
    "REVIEWER",
    "POST",
    `/api/reviews/${moduleId}/start`
  );

  check(
    "REVIEWER starts review",
    started.status === 200,
    `HTTP ${started.status}`
  );

  const added = await api(
    "REVIEWER",
    "POST",
    `/api/reviews/${moduleId}/comments`,
    { comment_text: "Please clarify the activity objectives." }
  );

  commentId = added.data?.data?.id;

  check(
    "REVIEWER creates OPEN comment",
    added.status === 201 &&
      Boolean(commentId) &&
      added.data?.data?.resolution_status === "OPEN",
    `HTTP ${added.status}`
  );

  if (!commentId) throw new Error("Comment creation failed");

  const path =
    `/api/reviews/${moduleId}/comments/${commentId}/resolve`;

  const unauth = await api(
    null, "PATCH", path,
    { resolution_status: "RESOLVED" }
  );

  check(
    "Unauthenticated resolution rejected",
    unauth.status === 403,
    `HTTP ${unauth.status}`
  );

  const approver = await api(
    "APPROVER", "PATCH", path,
    { resolution_status: "RESOLVED" }
  );

  check(
    "APPROVER cannot resolve reviewer comments",
    approver.status === 403,
    `HTTP ${approver.status}`
  );

  const invalid = await api(
    "REVIEWER", "PATCH", path,
    { resolution_status: "INVALID" }
  );

  check(
    "Invalid resolution status rejected",
    invalid.status === 400,
    `HTTP ${invalid.status}`
  );

  const unexpected = await api(
    "REVIEWER", "PATCH", path,
    {
      resolution_status: "RESOLVED",
      resolved_by: "1",
    }
  );

  check(
    "Unexpected fields rejected",
    unexpected.status === 400,
    `HTTP ${unexpected.status}`
  );

  const inProgress = await api(
    "REVIEWER", "PATCH", path,
    { resolution_status: "IN_PROGRESS" }
  );

  check(
    "OPEN transitions to IN_PROGRESS",
    inProgress.status === 200 &&
      inProgress.data?.data?.resolution_status === "IN_PROGRESS",
    `HTTP ${inProgress.status}`
  );

  const resolved = await api(
    "REVIEWER", "PATCH", path,
    { resolution_status: "RESOLVED" }
  );

  check(
    "IN_PROGRESS transitions to RESOLVED",
    resolved.status === 200 &&
      resolved.data?.data?.resolution_status === "RESOLVED" &&
      Boolean(resolved.data?.data?.resolved_by) &&
      Boolean(resolved.data?.data?.resolved_at),
    `HTTP ${resolved.status}`
  );

  const duplicate = await api(
    "REVIEWER", "PATCH", path,
    { resolution_status: "RESOLVED" }
  );

  check(
    "Duplicate RESOLVED transition rejected",
    duplicate.status === 409,
    `HTTP ${duplicate.status}`
  );

  const reopened = await api(
    "ADMIN", "PATCH", path,
    { resolution_status: "REOPENED" }
  );

  check(
    "ADMIN reopens resolved comment",
    reopened.status === 200 &&
      reopened.data?.data?.resolution_status === "REOPENED" &&
      reopened.data?.data?.resolved_by === null &&
      reopened.data?.data?.resolved_at === null,
    `HTTP ${reopened.status}`
  );

  const resolvedAgain = await api(
    "REVIEWER", "PATCH", path,
    { resolution_status: "RESOLVED" }
  );

  check(
    "REOPENED transitions to RESOLVED",
    resolvedAgain.status === 200 &&
      resolvedAgain.data?.data?.resolution_status === "RESOLVED",
    `HTTP ${resolvedAgain.status}`
  );

  const stored = await pool.query(
    `SELECT resolution_status, resolved_by, resolved_at
     FROM module_comments
     WHERE id = $1`,
    [commentId]
  );

  check(
    "Final resolution saved in PostgreSQL",
    stored.rows.length === 1 &&
      stored.rows[0].resolution_status === "RESOLVED" &&
      Boolean(stored.rows[0].resolved_by) &&
      Boolean(stored.rows[0].resolved_at)
  );

  const audit = await pool.query(
    `SELECT COUNT(*)::integer AS total
     FROM audit_logs
     WHERE action = 'REVIEW_COMMENT_STATUS_CHANGED'
       AND entity_type = 'module_comments'
       AND entity_id = $1`,
    [commentId]
  );

  check(
    "All four status changes recorded in audit history",
    audit.rows[0].total === 4,
    `Found ${audit.rows[0].total}`
  );

  const listing = await api(
    "REVIEWER", "GET", "/api/reviews"
  );

  check(
    "Resolved comment excluded from unresolved count",
    listing.status === 200 &&
      listing.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.comment_count === 1 &&
          item.unresolved_comment_count === 0
      ),
    `HTTP ${listing.status}`
  );
} catch (error) {
  console.log(`TEST ERROR: ${error.message}`);
  failed++;
} finally {
  if (moduleId) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(
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

      await client.query(
        "DELETE FROM module_comments WHERE module_id = $1",
        [moduleId]
      );

      await client.query(
        "DELETE FROM module_reviews WHERE module_id = $1",
        [moduleId]
      );

      await client.query(
        "DELETE FROM institutional_modules WHERE id = $1",
        [moduleId]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.log(`WARNING: Cleanup failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  await pool.end();
}

console.log("\n========== COMMENT RESOLUTION TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
