import pg from "pg";
import { readFile } from "node:fs/promises";

const base = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const credentials = JSON.parse(
  await readFile(".opc-test-users.local.json", "utf8")
);

const accounts = Array.isArray(credentials)
  ? credentials
  : Object.values(credentials);

const admin = accounts.find(
  user => user.email === "admin.test@opc.example"
);

const reviewer = accounts.find(
  user => user.email === "reviewer.test@opc.example"
);

if (!admin || !reviewer) {
  throw new Error("Required local test accounts not found");
}

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

async function request(path, cookie = "", method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookie,
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
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    data: await response.json(),
  };
}

async function login(account, password = account.password) {
  return request("/api/auth/login", "", "POST", {
    email: account.email,
    password,
  });
}

const newPassword = "OPC-Test-Reset-2026-Strong!";
let reviewerId;
let originalHash;
let originalVersion;
let changed = false;

try {
  const record = await pool.query(
    `SELECT id, password_hash, session_version
     FROM app_users
     WHERE email = $1
       AND deleted_at IS NULL`,
    [reviewer.email]
  );

  if (record.rows.length !== 1) {
    throw new Error("Reviewer account missing");
  }

  reviewerId = record.rows[0].id;
  originalHash = record.rows[0].password_hash;
  originalVersion = record.rows[0].session_version;

  const adminLogin = await login(admin);
  const reviewerLogin = await login(reviewer);

  if (
    adminLogin.status !== 200 ||
    !adminLogin.cookie ||
    reviewerLogin.status !== 200 ||
    !reviewerLogin.cookie
  ) {
    throw new Error("Initial authentication failed");
  }

  check(true, "Administrator and reviewer authenticated");

  const oldCookie = reviewerLogin.cookie;

  const before = await request("/api/auth/me", oldCookie);

  check(
    before.status === 200,
    "Old reviewer session valid before password reset",
    `HTTP ${before.status}`
  );

  // Record that restoration may be needed before making the request.
  changed = true;

  const reset = await request(
    `/api/users/${reviewerId}`,
    adminLogin.cookie,
    "PATCH",
    { password: newPassword }
  );

  check(
    reset.status === 200,
    "Administrator resets reviewer password",
    `HTTP ${reset.status}`
  );

  if (reset.status !== 200) {
    throw new Error("Password reset failed");
  }

  const after = await request("/api/auth/me", oldCookie);

  check(
    after.status === 401,
    "Old reviewer session revoked",
    `HTTP ${after.status}`
  );

  const oldLogin = await login(reviewer);

  check(
    oldLogin.status === 401,
    "Old reviewer password rejected",
    `HTTP ${oldLogin.status}`
  );

  const newLogin = await login(reviewer, newPassword);

  check(
    newLogin.status === 200 && !!newLogin.cookie,
    "New reviewer password accepted",
    `HTTP ${newLogin.status}`
  );

  if (newLogin.cookie) {
    const newSession = await request(
      "/api/auth/me",
      newLogin.cookie
    );

    check(
      newSession.status === 200,
      "New reviewer session valid",
      `HTTP ${newSession.status}`
    );
  }

  const version = await pool.query(
    `SELECT session_version
     FROM app_users
     WHERE id = $1`,
    [reviewerId]
  );

  check(
    version.rows[0]?.session_version === originalVersion + 1,
    "Password reset increments session version"
  );

} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  if (changed && reviewerId) {
    try {
      await pool.query(
        `UPDATE app_users
         SET password_hash = $2,
             session_version = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [reviewerId, originalHash, originalVersion]
      );

      console.log("PASS: Original test credentials restored");
    } catch (error) {
      failed++;
      console.error("RESTORE ERROR:", error.message);
    }
  }

  await pool.end();
}

console.log("\n========== SESSION REVOCATION RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
