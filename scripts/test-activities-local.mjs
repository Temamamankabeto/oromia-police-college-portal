import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base = "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
const db = new URL(databaseUrl ?? "");

if (
  db.hostname !== "127.0.0.1" ||
  db.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to use a non-local test database");
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const accounts = JSON.parse(
  readFileSync(".opc-test-users.local.json", "utf8")
);

const cookies = {};
let passed = 0;
let failed = 0;
let moduleId = null;
let activityId = null;

function check(name, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}: ${name}${condition ? "" : ` — ${detail}`}`);
  if (condition) passed++;
  else failed++;
}

async function request(role, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Cookie: cookies[role] ?? "",
      Origin: base,
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
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
      throw new Error(`Login failed for ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  check("All three roles authenticated", true);

  const suffix = randomBytes(5).toString("hex").toUpperCase();

  const module = await request("ADMIN", "POST", "/api/modules", {
    module_code: `M${suffix}`,
    title: "Activity Integration Test Module",
  });

  moduleId = module.data?.data?.id;

  check(
    "ADMIN creates parent module",
    module.status === 201 && Boolean(moduleId),
    `HTTP ${module.status}: ${module.data?.error ?? ""}`
  );

  if (!moduleId) throw new Error("Parent module creation failed");

  const path = `/api/modules/${moduleId}/activities`;

  const unauthenticated = await fetch(base + path);

  check(
    "Unauthenticated activity access rejected",
    unauthenticated.status === 401,
    `HTTP ${unauthenticated.status}`
  );

  const created = await request("ADMIN", "POST", path, {
    activity_code: `A${suffix}`,
    title: "Initial Test Activity",
    description: "Temporary test record",
    display_order: 1,
    is_active: true,
  });

  activityId = created.data?.data?.id;

  check(
    "ADMIN creates activity",
    created.status === 201 &&
      Boolean(activityId) &&
      created.data?.data?.module_id === moduleId,
    `HTTP ${created.status}: ${created.data?.error ?? ""}`
  );

  if (!activityId) throw new Error("Activity creation failed");

  for (const role of ["ADMIN", "REVIEWER", "APPROVER"]) {
    const result = await request(role, "GET", path);

    check(
      `${role} reads activity`,
      result.status === 200 &&
        result.data?.data?.some(a => a.id === activityId),
      `HTTP ${result.status}`
    );
  }

  const duplicate = await request("ADMIN", "POST", path, {
    activity_code: `A${suffix}`,
    title: "Duplicate Activity",
  });

  check("Duplicate activity code rejected", duplicate.status === 409);

  const invalid = await request("ADMIN", "POST", path, {
    activity_code: "INVALID CODE!",
    title: "Invalid Activity",
  });

  check("Invalid activity code rejected", invalid.status === 400);

  for (const role of ["REVIEWER", "APPROVER"]) {
    const create = await request(role, "POST", path, {
      title: "Unauthorized Activity",
    });

    check(`${role} cannot create`, create.status === 403);

    const update = await request(
      role,
      "PATCH",
      `${path}/${activityId}`,
      { title: "Unauthorized Update" }
    );

    check(`${role} cannot update`, update.status === 403);

    const remove = await request(
      role,
      "DELETE",
      `${path}/${activityId}`
    );

    check(`${role} cannot delete`, remove.status === 403);
  }

  const updated = await request(
    "ADMIN",
    "PATCH",
    `${path}/${activityId}`,
    {
      title: "Updated Test Activity",
      display_order: 5,
      is_active: false,
    }
  );

  check(
    "ADMIN updates activity",
    updated.status === 200 &&
      updated.data?.data?.title === "Updated Test Activity" &&
      updated.data?.data?.display_order === 5 &&
      updated.data?.data?.is_active === false,
    `HTTP ${updated.status}: ${updated.data?.error ?? ""}`
  );

  const removed = await request(
    "ADMIN",
    "DELETE",
    `${path}/${activityId}`
  );

  check(
    "ADMIN soft-deletes activity",
    removed.status === 200,
    `HTTP ${removed.status}: ${removed.data?.error ?? ""}`
  );

  const afterDelete = await request("ADMIN", "GET", path);

  check(
    "Deleted activity hidden from API",
    afterDelete.status === 200 &&
      !afterDelete.data?.data?.some(a => a.id === activityId)
  );

  const dbResult = await pool.query(
    `SELECT module_id::text AS module_id, deleted_at
     FROM module_activities WHERE id = $1`,
    [activityId]
  );

  check(
    "Database relationship and soft deletion verified",
    dbResult.rows.length === 1 &&
      dbResult.rows[0].module_id === moduleId &&
      dbResult.rows[0].deleted_at !== null
  );
} catch (error) {
  console.log(`TEST ERROR: ${error.message}`);
  failed++;
} finally {
  if (moduleId) {
    try {
      await pool.query(
        `UPDATE institutional_modules
         SET deleted_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL`,
        [moduleId]
      );
    } catch {
      console.log("WARNING: Test parent module cleanup failed");
    }
  }

  await pool.end();
}

console.log("\n========== ACTIVITY CRUD TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
