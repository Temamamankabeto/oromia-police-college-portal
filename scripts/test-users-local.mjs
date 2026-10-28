import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const base = "http://127.0.0.1:3000";
const origin = base;

const dbUrl = new URL(process.env.DATABASE_URL || "");

if (
  dbUrl.hostname !== "127.0.0.1" ||
  dbUrl.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let passed = 0;
let failed = 0;
let testUserId = null;

function check(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function api(path, cookie, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
  });

  const data = await response.json();

  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function login(email, password) {
  const result = await api("/api/auth/login", null, "POST", {
    email,
    password,
  });

  if (result.status !== 200 || !result.cookie) {
    throw new Error(`Login failed for ${email}: HTTP ${result.status}`);
  }

  return result.cookie;
}

async function cleanup() {
  if (!testUserId) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM audit_logs
       WHERE entity_type = 'app_users'
         AND entity_id = $1`,
      [testUserId]
    );

    await client.query(
      `DELETE FROM app_users WHERE id = $1`,
      [testUserId]
    );

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

  const admin = users.find(
    user => user.email === "admin.test@opc.example"
  );

  const reviewer = users.find(
    user => user.email === "reviewer.test@opc.example"
  );

  if (!admin || !reviewer) {
    throw new Error("Required test credentials not found");
  }

  const adminCookie = await login(admin.email, admin.password);
  const reviewerCookie = await login(
    reviewer.email,
    reviewer.password
  );

  const denied = await api("/api/users", reviewerCookie);

  check(
    denied.status === 403,
    "Reviewer cannot list staff accounts"
  );

  const list = await api("/api/users", adminCookie);

  check(
    list.status === 200 && Array.isArray(list.data.data),
    "Administrator can list staff accounts"
  );

  const unique = Date.now().toString(36);
  const email = `opc-user-${unique}@example.test`;
  const password = `Temporary!${unique}#2026`;

  const created = await api(
    "/api/users",
    adminCookie,
    "POST",
    {
      full_name: "Temporary OPC Staff",
      email,
      password,
      role_code: "REVIEWER",
    }
  );

  testUserId = created.data?.data?.id || null;

  check(
    created.status === 201 && Boolean(testUserId),
    "Administrator creates a staff account",
    `HTTP ${created.status}: ${created.data?.error || ""}`
  );

  if (!testUserId) return;

  const duplicate = await api(
    "/api/users",
    adminCookie,
    "POST",
    {
      full_name: "Duplicate Staff",
      email,
      password,
      role_code: "REVIEWER",
    }
  );

  check(
    duplicate.status === 409,
    "Duplicate email rejected"
  );

  const staffCookie = await login(email, password);

  check(
    Boolean(staffCookie),
    "New staff member can log in"
  );

  const roleChange = await api(
    `/api/users/${testUserId}`,
    adminCookie,
    "PATCH",
    {
      full_name: "Updated OPC Staff",
      role_code: "APPROVER",
    }
  );

  check(
    roleChange.status === 200 &&
      roleChange.data.data?.role_code === "APPROVER",
    "Administrator updates staff name and role",
    `HTTP ${roleChange.status}: ${roleChange.data?.error || ""}`
  );

  const reviewerUpdate = await api(
    `/api/users/${testUserId}`,
    reviewerCookie,
    "PATCH",
    { full_name: "Unauthorized Change" }
  );

  check(
    reviewerUpdate.status === 403,
    "Reviewer cannot edit staff accounts"
  );

  const newPassword = `Changed!${unique}#2026`;

  const passwordReset = await api(
    `/api/users/${testUserId}`,
    adminCookie,
    "PATCH",
    { password: newPassword }
  );

  check(
    passwordReset.status === 200,
    "Administrator resets staff password"
  );

  const newLogin = await api(
    "/api/auth/login",
    null,
    "POST",
    { email, password: newPassword }
  );

  check(
    newLogin.status === 200,
    "Staff can log in with new password"
  );

  const deactivate = await api(
    `/api/users/${testUserId}`,
    adminCookie,
    "PATCH",
    { is_active: false }
  );

  check(
    deactivate.status === 200 &&
      deactivate.data.data?.is_active === false,
    "Administrator deactivates staff account"
  );

  const blockedLogin = await api(
    "/api/auth/login",
    null,
    "POST",
    { email, password: newPassword }
  );

  check(
    blockedLogin.status === 401,
    "Deactivated staff cannot log in"
  );

  const blockedSession = await api(
    "/api/auth/me",
    staffCookie
  );

  check(
    blockedSession.status === 401,
    "Deactivated staff session is rejected"
  );

  const reactivate = await api(
    `/api/users/${testUserId}`,
    adminCookie,
    "PATCH",
    { is_active: true }
  );

  check(
    reactivate.status === 200 &&
      reactivate.data.data?.is_active === true,
    "Administrator reactivates staff account"
  );

  const audit = await pool.query(
    `SELECT action
     FROM audit_logs
     WHERE entity_type = 'app_users'
       AND entity_id = $1`,
    [testUserId]
  );

  check(
    audit.rows.some(row => row.action === "USER_CREATED") &&
      audit.rows.some(row => row.action === "USER_UPDATED"),
    "User management audit records saved"
  );
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

console.log("\n========== USER MANAGEMENT RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
