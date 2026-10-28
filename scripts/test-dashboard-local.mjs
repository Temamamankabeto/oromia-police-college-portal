import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const base = "http://127.0.0.1:3000";

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

function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function request(path, cookie, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function main() {
  const credentials = JSON.parse(
    await readFile(".opc-test-users.local.json", "utf8")
  );

  const users = Array.isArray(credentials)
    ? credentials
    : Object.values(credentials);

  const anonymous = await request("/api/dashboard/stats", null);

  check(
    anonymous.status === 401,
    "Anonymous dashboard access rejected"
  );

  const expectedFields = [
    "total_modules",
    "total_activities",
    "pending_reviews",
    "under_review",
    "pending_approvals",
    "approved",
    "revision_requested",
    "rejected",
    "active_users",
  ];

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const account = users.find(
      user => user.email === `${role.toLowerCase()}.test@opc.example`
    );

    if (!account) {
      throw new Error(`Missing ${role} test account`);
    }

    const login = await request("/api/auth/login", null, "POST", {
      email: account.email,
      password: account.password,
    });

    check(
      login.status === 200 && Boolean(login.cookie),
      `${role}: authenticated`
    );

    if (!login.cookie) continue;

    const stats = await request(
      "/api/dashboard/stats",
      login.cookie
    );

    check(
      stats.status === 200 && stats.data.success === true,
      `${role}: statistics accessible`
    );

    if (stats.status !== 200) continue;

    check(
      expectedFields.every(
        field =>
          Number.isInteger(stats.data.data?.[field]) &&
          stats.data.data[field] >= 0
      ),
      `${role}: all statistics are valid nonnegative integers`
    );

    const data = stats.data.data;

    check(
      data.pending_reviews +
        data.under_review +
        data.pending_approvals +
        data.approved +
        data.revision_requested +
        data.rejected === data.total_modules,
      `${role}: proposal status totals reconcile`
    );

    const db = await pool.query(
      `SELECT
         (SELECT COUNT(*)::integer
          FROM institutional_modules
          WHERE deleted_at IS NULL) AS modules,
         (SELECT COUNT(*)::integer
          FROM app_users
          WHERE is_active = TRUE
            AND deleted_at IS NULL) AS users`
    );

    check(
      data.total_modules === db.rows[0].modules &&
        data.active_users === db.rows[0].users,
      `${role}: statistics match PostgreSQL`
    );
  }
}

try {
  await main();
} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  await pool.end();
}

console.log("\n========== DASHBOARD TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
