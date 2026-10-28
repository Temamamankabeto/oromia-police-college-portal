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
      throw new Error(`Login failed: ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  check("All three roles authenticated", true);

  const suffix = randomBytes(5).toString("hex").toUpperCase();

  const created = await api("ADMIN", "POST", "/api/modules", {
    module_code: `R${suffix}`,
    title: "Original Proposal Title",
    description: "Original proposal description",
    is_active: true,
  });

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) throw new Error("Module creation failed");

  const activity = await api(
    "ADMIN",
    "POST",
    `/api/modules/${moduleId}/activities`,
    {
      activity_code: "ACT001",
      title: "Revised Activity",
      description: "Updated activity description",
      display_order: 1,
      is_active: true,
    }
  );

  check(
    "ADMIN creates proposal activity",
    activity.status === 201,
    `HTTP ${activity.status}`
  );

  const resubmitPath = `/api/reviews/${moduleId}/resubmit`;

  const premature = await api(
    "ADMIN", "POST", resubmitPath,
    { change_summary: "Premature resubmission" }
  );

  check(
    "Resubmission before revision request rejected",
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

  const requested = await api(
    "REVIEWER",
    "POST",
    `/api/reviews/${moduleId}/request-revision`,
    { remarks: "Please improve the proposal title and description." }
  );

  check(
    "REVIEWER requests revision",
    requested.status === 200 &&
      requested.data?.data?.review?.approval_status ===
        "REVISION_REQUESTED",
    `HTTP ${requested.status}`
  );

  const unauth = await api(
    null, "POST", resubmitPath,
    { change_summary: "Unauthorized" }
  );

  check(
    "Unauthenticated resubmission rejected",
    unauth.status === 403,
    `HTTP ${unauth.status}`
  );

  const reviewer = await api(
    "REVIEWER", "POST", resubmitPath,
    { change_summary: "Reviewer should not resubmit" }
  );

  check(
    "REVIEWER resubmission rejected",
    reviewer.status === 403,
    `HTTP ${reviewer.status}`
  );

  const approver = await api(
    "APPROVER", "POST", resubmitPath,
    { change_summary: "Approver should not resubmit" }
  );

  check(
    "APPROVER resubmission rejected",
    approver.status === 403,
    `HTTP ${approver.status}`
  );

  const empty = await api(
    "ADMIN", "POST", resubmitPath,
    { change_summary: "" }
  );

  check(
    "Empty change summary rejected",
    empty.status === 400,
    `HTTP ${empty.status}`
  );

  const unexpected = await api(
    "ADMIN", "POST", resubmitPath,
    {
      change_summary: "Updated proposal",
      current_revision: 99,
    }
  );

  check(
    "Unexpected fields rejected",
    unexpected.status === 400,
    `HTTP ${unexpected.status}`
  );

  const updated = await api(
    "ADMIN",
    "PATCH",
    `/api/modules/${moduleId}`,
    {
      title: "Corrected Proposal Title",
      description: "Corrected proposal description",
    }
  );

  check(
    "ADMIN updates proposal before resubmission",
    updated.status === 200,
    `HTTP ${updated.status}`
  );

  const resubmitted = await api(
    "ADMIN", "POST", resubmitPath,
    {
      change_summary:
        "Updated the title and description according to reviewer feedback.",
    }
  );

  const revision = resubmitted.data?.data?.revision;

  check(
    "ADMIN resubmits proposal successfully",
    resubmitted.status === 200 &&
      resubmitted.data?.data?.review?.approval_status ===
        "UNDER_REVIEW",
    `HTTP ${resubmitted.status}: ${resubmitted.data?.error ?? ""}`
  );

  check(
    "Revision number incremented to 2",
    resubmitted.data?.data?.review?.current_revision === 2 &&
      revision?.revision_number === 2
  );

  check(
    "Revision snapshot contains corrected proposal",
    revision?.title === "Corrected Proposal Title" &&
      revision?.description === "Corrected proposal description"
  );

  check(
    "Revision snapshot contains proposal activity",
    Array.isArray(revision?.activities_snapshot) &&
      revision.activities_snapshot.some(
        item => item.activity_code === "ACT001"
      )
  );

  const duplicate = await api(
    "ADMIN", "POST", resubmitPath,
    { change_summary: "Duplicate submission" }
  );

  check(
    "Duplicate resubmission rejected",
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
    "Updated review persisted in PostgreSQL",
    stored.rows.length === 1 &&
      stored.rows[0].approval_status === "UNDER_REVIEW" &&
      stored.rows[0].current_revision === 2
  );

  const revisions = await pool.query(
    `SELECT revision_number, title, activities_snapshot
     FROM module_revisions
     WHERE module_id = $1`,
    [moduleId]
  );

  check(
    "Exactly one revision snapshot saved",
    revisions.rows.length === 1 &&
      revisions.rows[0].revision_number === 2 &&
      revisions.rows[0].title === "Corrected Proposal Title"
  );

  const audit = await pool.query(
    `SELECT COUNT(*)::integer AS total
     FROM audit_logs
     WHERE action = 'PROPOSAL_RESUBMITTED'
       AND entity_type = 'module_reviews'
       AND entity_id IN (
         SELECT id FROM module_reviews WHERE module_id = $1
       )`,
    [moduleId]
  );

  check(
    "Resubmission recorded in audit history",
    audit.rows[0].total === 1
  );

  const listing = await api("REVIEWER", "GET", "/api/reviews");

  check(
    "Review listing reflects resubmitted proposal",
    listing.status === 200 &&
      listing.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.approval_status === "UNDER_REVIEW" &&
          item.current_revision === 2
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
         )
         OR (
           entity_type = 'module_revisions'
           AND entity_id IN (
             SELECT id FROM module_revisions WHERE module_id = $1
           )
         )`,
        [moduleId]
      );

      await client.query(
        "DELETE FROM module_revisions WHERE module_id = $1",
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
        "DELETE FROM module_activities WHERE module_id = $1",
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

console.log("\n========== RESUBMISSION TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
