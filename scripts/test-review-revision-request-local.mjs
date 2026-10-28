import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base = "http://127.0.0.1:3000";
const dbUrl = process.env.DATABASE_URL;
const db = new URL(dbUrl ?? "");

if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/opc_test_db"
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
    module_code: `V${suffix}`,
    title: "Revision Request Test Proposal",
    is_active: true,
  });

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates test proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) throw new Error("Module creation failed");

  const path = `/api/reviews/${moduleId}/request-revision`;

  const premature = await api(
    "REVIEWER", "POST", path,
    { remarks: "Corrections required." }
  );

  check(
    "Revision request before review rejected",
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

  const unauthenticated = await api(
    null, "POST", path,
    { remarks: "Unauthorized request" }
  );

  check(
    "Unauthenticated request rejected",
    unauthenticated.status === 403,
    `HTTP ${unauthenticated.status}`
  );

  const approver = await api(
    "APPROVER", "POST", path,
    { remarks: "Approver cannot request reviewer revision" }
  );

  check(
    "APPROVER cannot request reviewer revision",
    approver.status === 403,
    `HTTP ${approver.status}`
  );

  const empty = await api(
    "REVIEWER", "POST", path,
    { remarks: "" }
  );

  check(
    "Empty remarks rejected",
    empty.status === 400,
    `HTTP ${empty.status}`
  );

  const unexpected = await api(
    "REVIEWER", "POST", path,
    {
      remarks: "Correction required",
      approval_status: "APPROVED",
    }
  );

  check(
    "Unexpected fields rejected",
    unexpected.status === 400,
    `HTTP ${unexpected.status}`
  );

  const requested = await api(
    "REVIEWER", "POST", path,
    {
      remarks:
        "Revise the objectives and clarify the activity deliverables.",
    }
  );

  const decisionId = requested.data?.data?.decision?.id;

  check(
    "REVIEWER requests proposal revision",
    requested.status === 200 &&
      requested.data?.data?.review?.approval_status ===
        "REVISION_REQUESTED" &&
      Boolean(decisionId),
    `HTTP ${requested.status}: ${requested.data?.error ?? ""}`
  );

  const duplicate = await api(
    "REVIEWER", "POST", path,
    { remarks: "Duplicate revision request" }
  );

  check(
    "Duplicate revision request rejected",
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
    "Revision status persisted in PostgreSQL",
    stored.rows.length === 1 &&
      stored.rows[0].approval_status === "REVISION_REQUESTED" &&
      stored.rows[0].current_revision === 1
  );

  const decisions = await pool.query(
    `SELECT
       id::text AS id,
       decision,
       remarks,
       revision_number
     FROM module_decisions
     WHERE module_id = $1`,
    [moduleId]
  );

  check(
    "Revision decision recorded once",
    decisions.rows.length === 1 &&
      decisions.rows[0].id === decisionId &&
      decisions.rows[0].decision === "REVISION_REQUESTED" &&
      decisions.rows[0].revision_number === 1
  );

  const audit = await pool.query(
    `SELECT COUNT(*)::integer AS total
     FROM audit_logs
     WHERE action = 'REVIEW_REVISION_REQUESTED'
       AND entity_type = 'module_reviews'
       AND entity_id IN (
         SELECT id FROM module_reviews WHERE module_id = $1
       )`,
    [moduleId]
  );

  check(
    "Revision request recorded in audit history",
    audit.rows[0].total === 1
  );

  const listing = await api("REVIEWER", "GET", "/api/reviews");

  check(
    "Review listing displays REVISION_REQUESTED",
    listing.status === 200 &&
      listing.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.approval_status === "REVISION_REQUESTED"
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
         WHERE entity_type = 'module_reviews'
           AND entity_id IN (
             SELECT id FROM module_reviews WHERE module_id = $1
           )`,
        [moduleId]
      );

      await client.query(
        "DELETE FROM module_decisions WHERE module_id = $1",
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

console.log("\n========== REVISION REQUEST TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
