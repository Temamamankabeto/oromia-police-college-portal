import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const base = "http://127.0.0.1:3000";
const origin = base;

const databaseUrl = new URL(process.env.DATABASE_URL || "");

if (
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let passed = 0;
let failed = 0;
const moduleIds = [];

function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function login(email, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ email, password }),
  });

  const cookie = response.headers
    .get("set-cookie")
    ?.split(";")[0];

  if (!response.ok || !cookie) {
    throw new Error(`Login failed for ${email}`);
  }

  return cookie;
}

async function api(path, cookie, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await response.json();

  return { status: response.status, data };
}

async function cleanup() {
  if (!moduleIds.length) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const id of moduleIds) {
      await client.query(
        `DELETE FROM audit_logs
         WHERE entity_type = 'module_reviews'
           AND entity_id IN (
             SELECT id FROM module_reviews WHERE module_id = $1
           )`,
        [id]
      );

      await client.query(
        "DELETE FROM module_decisions WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM module_reviews WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM institutional_modules WHERE id = $1",
        [id]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const credentials = JSON.parse(
    await readFile(".opc-test-users.local.json", "utf8")
  );

  const users = Array.isArray(credentials)
    ? credentials
    : Object.values(credentials);

  function findUser(role) {
    return users.find(
      user =>
        user.role === role ||
        user.role_code === role ||
        user.email?.startsWith(role.toLowerCase() + ".")
    );
  }

  const admin = findUser("ADMIN");
  const reviewer = findUser("REVIEWER");
  const approver = findUser("APPROVER");

  if (!admin || !reviewer || !approver) {
    throw new Error("Test user credentials not found");
  }

  const adminCookie = await login(admin.email, admin.password);
  const reviewerCookie = await login(
    reviewer.email,
    reviewer.password
  );
  const approverCookie = await login(
    approver.email,
    approver.password
  );

  check(
    Boolean(adminCookie && reviewerCookie && approverCookie),
    "All roles authenticated"
  );

  for (const decision of [
    "APPROVED",
    "REVISION_REQUESTED",
    "REJECTED",
  ]) {
    const code = `AP${Date.now().toString().slice(-8)}${moduleIds.length}`;

    const created = await api(
      "/api/modules",
      adminCookie,
      "POST",
      {
        module_code: code,
        title: `Approval Test ${decision}`,
        description: "Temporary automated test proposal",
        display_order: 1,
        is_active: true,
      }
    );

    const id = created.data?.data?.id;

    check(created.status === 201 && Boolean(id),
      `${decision}: proposal created`);

    if (!id) continue;

    moduleIds.push(id);

    const start = await api(
      `/api/reviews/${id}/start`,
      reviewerCookie,
      "POST"
    );

    check(start.status === 200,
      `${decision}: review started`);

    const handoff = await api(
      `/api/reviews/${id}/submit-for-approval`,
      reviewerCookie,
      "POST"
    );

    check(handoff.status === 200,
      `${decision}: submitted for approval`);

    const denied = await api(
      `/api/approvals/${id}/decide`,
      reviewerCookie,
      "POST",
      { decision, remarks: "Test decision" }
    );

    check(denied.status === 403,
      `${decision}: reviewer permission denied`);

    const decided = await api(
      `/api/approvals/${id}/decide`,
      approverCookie,
      "POST",
      { decision, remarks: "Automated approval test" }
    );

    check(decided.status === 200,
      `${decision}: approver decision accepted`);

    const duplicate = await api(
      `/api/approvals/${id}/decide`,
      approverCookie,
      "POST",
      { decision, remarks: "Duplicate test" }
    );

    check(duplicate.status === 409,
      `${decision}: duplicate decision rejected`);

    const history = await api(
      `/api/approvals/${id}/history`,
      adminCookie
    );

    check(
      history.status === 200 &&
      history.data.data.some(item => item.decision === decision),
      `${decision}: decision history available`
    );

    const database = await pool.query(
      `SELECT approval_status FROM module_reviews
       WHERE module_id = $1`,
      [id]
    );

    check(
      database.rows[0]?.approval_status === decision,
      `${decision}: PostgreSQL status verified`
    );
  }
}

try {
  await main();
} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  try {
    await cleanup();
  } catch (error) {
    failed++;
    console.error("CLEANUP ERROR:", error.message);
  }

  await pool.end();
}

console.log("\n========== APPROVAL TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
