import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const base = "http://127.0.0.1:3000";

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
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
  });

  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function login(email, password) {
  const result = await api("/api/auth/login", null, "POST", {
    email,
    password,
  });

  if (result.status !== 200 || !result.cookie) {
    throw new Error(`Login failed: ${email}, HTTP ${result.status}`);
  }

  return result.cookie;
}

async function main() {
  const credentials = JSON.parse(
    await readFile(".opc-test-users.local.json", "utf8")
  );

  const users = Array.isArray(credentials)
    ? credentials
    : Object.values(credentials);

  const cookies = {};

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const account = users.find(
      user => user.email === `${role.toLowerCase()}.test@opc.example`
    );

    if (!account) {
      throw new Error(`Missing ${role} test credentials`);
    }

    cookies[role] = await login(account.email, account.password);
    check(Boolean(cookies[role]), `${role} authenticated`);
  }

  const anonymousReports = await api("/api/reports", null);
  check(anonymousReports.status === 401, "Anonymous reports rejected");

  const anonymousAudit = await api("/api/audit", null);
  check(
    [401, 403].includes(anonymousAudit.status),
    "Anonymous audit access rejected"
  );

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const result = await api("/api/reports", cookies[role]);

    check(
      result.status === 200 &&
        result.data.success === true &&
        Array.isArray(result.data.data),
      `${role} can access reports`
    );

    if (result.status === 200) {
      check(
        Number.isInteger(result.data.total) &&
          result.data.total >= 0 &&
          result.data.page === 1 &&
          result.data.limit === 20,
        `${role} receives valid report pagination`
      );
    }
  }

  for (const role of ["REVIEWER", "APPROVER"]) {
    const result = await api("/api/audit", cookies[role]);

    check(
      result.status === 403,
      `${role} cannot access administrator audit history`
    );
  }

  const audit = await api("/api/audit", cookies.ADMIN);

  check(
    audit.status === 200 &&
      audit.data.success === true &&
      Array.isArray(audit.data.data),
    "Administrator can access audit history"
  );

  const reportDb = await pool.query(
    `SELECT COUNT(*)::integer AS total
     FROM institutional_modules
     WHERE deleted_at IS NULL`
  );

  const report = await api("/api/reports", cookies.ADMIN);

  check(
    report.status === 200 &&
      report.data.total === reportDb.rows[0].total,
    "Report total matches PostgreSQL"
  );

  const auditDb = await pool.query(
    `SELECT COUNT(*)::integer AS total FROM audit_logs`
  );

  check(
    audit.status === 200 &&
      audit.data.total === auditDb.rows[0].total,
    "Audit total matches PostgreSQL"
  );

  const validStatuses = new Set([
    "PENDING",
    "UNDER_REVIEW",
    "READY_FOR_APPROVAL",
    "APPROVED",
    "REVISION_REQUESTED",
    "REJECTED",
  ]);

  check(
    report.data.data.every(
      row =>
        typeof row.module_id === "string" &&
        validStatuses.has(row.approval_status) &&
        Number.isInteger(row.activity_count) &&
        Number.isInteger(row.comment_count)
    ),
    "Report records have valid structure"
  );

  check(
    audit.data.data.every(
      row =>
        typeof row.id === "string" &&
        typeof row.action === "string" &&
        typeof row.entity_type === "string" &&
        typeof row.actor_name === "string"
    ),
    "Audit records have valid structure"
  );

  const filtered = await api(
    "/api/reports?status=APPROVED&limit=5&page=1",
    cookies.ADMIN
  );

  check(
    filtered.status === 200 &&
      filtered.data.data.length <= 5 &&
      filtered.data.data.every(
        row => row.approval_status === "APPROVED"
      ),
    "Reports status filter works"
  );

  const searched = await api(
    "/api/reports?search=__nonexistent_opc_987654321__",
    cookies.ADMIN
  );

  check(
    searched.status === 200 &&
      searched.data.total === 0,
    "Reports search filter works"
  );

  const invalidStatus = await api(
    "/api/reports?status=INVALID",
    cookies.ADMIN
  );

  check(
    invalidStatus.status === 400,
    "Invalid report status rejected"
  );

  const invalidPage = await api(
    "/api/reports?page=-1",
    cookies.ADMIN
  );

  check(
    invalidPage.status === 400,
    "Invalid report pagination rejected"
  );

  const invalidAuditLimit = await api(
    "/api/audit?limit=1000",
    cookies.ADMIN
  );

  check(
    invalidAuditLimit.status === 400,
    "Excessive audit page size rejected"
  );

  const auditSearch = await api(
    "/api/audit?search=__nonexistent_opc_987654321__",
    cookies.ADMIN
  );

  check(
    auditSearch.status === 200 &&
      auditSearch.data.total === 0,
    "Audit search filter works"
  );

  const entityFilter = await api(
    "/api/audit?entity_type=app_users",
    cookies.ADMIN
  );

  check(
    entityFilter.status === 200 &&
      entityFilter.data.data.every(
        row => row.entity_type === "app_users"
      ),
    "Audit entity filter works"
  );

  const auditPage = await api(
    "/api/audit?page=1&limit=5",
    cookies.ADMIN
  );

  check(
    auditPage.status === 200 &&
      auditPage.data.data.length <= 5 &&
      auditPage.data.limit === 5,
    "Audit pagination works"
  );
}

try {
  await main();
} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  await pool.end();
}

console.log("\n========== REPORTS AND AUDIT TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
