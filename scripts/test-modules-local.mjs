import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { randomBytes } from "node:crypto";

const base = "http://127.0.0.1:3000";
const accounts = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const dbUrl = new URL(process.env.DATABASE_URL ?? "");

if (
  dbUrl.hostname !== "127.0.0.1" ||
  dbUrl.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const cookies = {};
let passed = 0;
let failed = 0;
let moduleId = null;

function check(label, condition, details = "") {
  if (condition) {
    console.log(`PASS: ${label}`);
    passed++;
  } else {
    console.log(`FAIL: ${label} ${details}`);
    failed++;
  }
}

async function api(role, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Cookie: cookies[role],
      Origin: base,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return { status: response.status, data };
}

try {
  for (const account of accounts) {
    const response = await fetch(`${base}/api/auth/login`, {
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

    if (
      response.status !== 200 ||
      !data.success ||
      !cookie
    ) {
      throw new Error(`Login failed for ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  console.log("PASS: All three roles authenticated");
  passed++;

  const code = `T${randomBytes(5).toString("hex").toUpperCase()}`;

  const created = await api("ADMIN", "POST", "/api/modules", {
    module_code: code,
    title: "Automated Test Module",
    description: "Temporary CRUD test",
    display_order: 10,
    is_active: true,
  });

  moduleId = created.data?.data?.id ?? null;

  check(
    "ADMIN creates module",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}: ${created.data?.error ?? ""}`
  );

  if (!moduleId) {
    throw new Error("Cannot continue without module ID");
  }

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const result = await api(role, "GET", "/api/modules");

    check(
      `${role} reads module`,
      result.status === 200 &&
        Array.isArray(result.data?.data) &&
        result.data.data.some(m => m.id === moduleId),
      `HTTP ${result.status}`
    );
  }

  const duplicate = await api("ADMIN", "POST", "/api/modules", {
    module_code: code,
    title: "Duplicate Test",
  });

  check("Duplicate code rejected", duplicate.status === 409);

  const invalid = await api("ADMIN", "POST", "/api/modules", {
    module_code: "INVALID CODE!",
    title: "Invalid Test",
  });

  check("Invalid module rejected", invalid.status === 400);

  for (const role of ["REVIEWER", "APPROVER"]) {
    const create = await api(role, "POST", "/api/modules", {
      module_code: `X${randomBytes(4).toString("hex").toUpperCase()}`,
      title: "Unauthorized Test",
    });

    check(`${role} cannot create`, create.status === 403);

    const update = await api(
      role,
      "PATCH",
      `/api/modules/${moduleId}`,
      { title: "Unauthorized Update" }
    );

    check(`${role} cannot update`, update.status === 403);

    const remove = await api(
      role,
      "DELETE",
      `/api/modules/${moduleId}`
    );

    check(`${role} cannot delete`, remove.status === 403);
  }

  const updated = await api(
    "ADMIN",
    "PATCH",
    `/api/modules/${moduleId}`,
    {
      title: "Updated Automated Test Module",
      display_order: 20,
      is_active: false,
    }
  );

  check(
    "ADMIN updates module",
    updated.status === 200 &&
      updated.data?.data?.title === "Updated Automated Test Module" &&
      updated.data?.data?.display_order === 20 &&
      updated.data?.data?.is_active === false,
    `HTTP ${updated.status}: ${updated.data?.error ?? ""}`
  );

  const removed = await api(
    "ADMIN",
    "DELETE",
    `/api/modules/${moduleId}`
  );

  check(
    "ADMIN soft-deletes module",
    removed.status === 200,
    `HTTP ${removed.status}: ${removed.data?.error ?? ""}`
  );

  const afterDelete = await api("ADMIN", "GET", "/api/modules");

  check(
    "Deleted module hidden from list",
    afterDelete.status === 200 &&
      !afterDelete.data?.data?.some(m => m.id === moduleId)
  );

  const db = await pool.query(
    "SELECT deleted_at FROM institutional_modules WHERE id = $1",
    [moduleId]
  );

  check(
    "Soft deletion confirmed in PostgreSQL",
    db.rows.length === 1 &&
      db.rows[0].deleted_at !== null
  );
} catch (error) {
  console.log(`TEST ERROR: ${error.message}`);
  failed++;
} finally {
  await pool.end();
}

console.log("\n========== MODULE CRUD TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
