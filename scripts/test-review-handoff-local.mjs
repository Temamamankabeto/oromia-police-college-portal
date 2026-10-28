import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL ?? "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing non-local test database");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const accounts = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const cookies = {};
let passed = 0;
let failed = 0;
let moduleId = null;

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
    module_code: `H${suffix}`,
    title: "Review Handoff Test Proposal",
    is_active: true,
  });

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) throw new Error("Module creation failed");

  const path = `/api/reviews/${moduleId}/submit-for-approval`;

  const premature = await api("REVIEWER", "POST", path);

  check(
    "Submission before review rejected",
    premature.status === 409,
    `HTTP ${premature.status}`
  );

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
    { comment_text: "Clarify the proposal objectives." }
  );

  const commentId = added.data?.data?.id;

  check(
    "REVIEWER creates unresolved comment",
    added.status === 201 && Boolean(commentId),
    `HTTP ${added.status}`
  );

  if (!commentId) throw new Error("Comment creation failed");

  const unauth = await api(null, "POST", path);

  check(
    "Unauthenticated submission rejected",
    unauth.status === 403,
    `HTTP ${unauth.status}`
  );

  const approver = await api("APPROVER", "POST", path);

  check(
    "APPROVER cannot submit review",
    approver.status === 403,
    `HTTP ${approver.status}`
  );

  const blocked = await api("REVIEWER", "POST", path);

  check(
    "Unresolved comment blocks submission",
    blocked.status === 409 &&
      blocked.data?.error?.includes("unresolved"),
    `HTTP ${blocked.status}`
  );

  const resolved = await api(
    "REVIEWER",
    "PATCH",
    `/api/reviews/${moduleId}/comments/${commentId}/resolve`,
    { resolution_status: "RESOLVED" }
  );

  check(
    "REVIEWER resolves comment",
    resolved.status === 200,
    `HTTP ${resolved.status}`
  );

  const submitted = await api("REVIEWER", "POST", path);

  check(
    "REVIEWER submits proposal for approval",
    submitted.status === 200 &&
      submitted.data?.data?.approval_status ===
        "READY_FOR_APPROVAL",
    `HTTP ${submitted.status}: ${submitted.data?.error ?? ""}`
  );

  const duplicate = await api("REVIEWER", "POST", path);

  check(
    "Duplicate handoff rejected",
    duplicate.status === 409,
    `HTTP ${duplicate.status}`
  );

  const stored = await pool.query(
    `SELECT approval_status, current_revision
     FROM module_reviews
     WHERE module_id = $1`,
    [moduleId]
  );

  check(
    "READY_FOR_APPROVAL persisted in PostgreSQL",
    stored.rows.length === 1 &&
      stored.rows[0].approval_status === "READY_FOR_APPROVAL" &&
      stored.rows[0].current_revision === 1
  );

  const audit = await pool.query(
    `SELECT COUNT(*)::integer AS total
     FROM audit_logs
     WHERE action = 'REVIEW_SUBMITTED_FOR_APPROVAL'
       AND entity_type = 'module_reviews'
       AND entity_id IN (
         SELECT id FROM module_reviews WHERE module_id = $1
       )`,
    [moduleId]
  );

  check(
    "Handoff recorded in audit history",
    audit.rows[0].total === 1
  );

  const listing = await api("APPROVER", "GET", "/api/reviews");

  check(
    "APPROVER sees proposal awaiting approval",
    listing.status === 200 &&
      listing.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.approval_status === "READY_FOR_APPROVAL"
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
           entity_type = 'module_reviews'
           AND entity_id IN (
             SELECT id FROM module_reviews WHERE module_id = $1
           )
         ) OR (
           entity_type = 'module_comments'
           AND entity_id IN (
             SELECT id FROM module_comments WHERE module_id = $1
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

console.log("\n========== REVIEW HANDOFF TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
