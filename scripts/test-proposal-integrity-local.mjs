import pg from "pg";
import { readFile } from "node:fs/promises";

const { Pool } = pg;
const base = "http://127.0.0.1:3000";
const url = new URL(process.env.DATABASE_URL || "");

if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to test against a non-local database");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let passed = 0;
let failed = 0;
const created = [];

function check(condition, label, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS: ${label}`);
  } else {
    failed++;
    console.error(`FAIL: ${label} ${detail}`);
  }
}

async function api(path, cookie, method = "GET", body) {
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

  const data = await response.json();

  return {
    status: response.status,
    data,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

async function main() {
  const credentials = JSON.parse(
    await readFile(".opc-test-users.local.json", "utf8")
  );

  const accounts = Array.isArray(credentials)
    ? credentials
    : Object.values(credentials);

  const admin = accounts.find(
    user => user.email === "admin.test@opc.example"
  );

  if (!admin) throw new Error("Admin test credentials missing");

  const login = await api("/api/auth/login", "", "POST", {
    email: admin.email,
    password: admin.password,
  });

  if (login.status !== 200 || !login.cookie) {
    throw new Error("Admin authentication failed");
  }

  const cookie = login.cookie;
  check(true, "Administrator authenticated");

  const states = [
    "PENDING",
    "UNDER_REVIEW",
    "REVISION_REQUESTED",
    "READY_FOR_APPROVAL",
    "APPROVED",
    "REJECTED",
  ];

  for (let index = 0; index < states.length; index++) {
    const status = states[index];
    const editable = [
      "PENDING",
      "REVISION_REQUESTED",
    ].includes(status);

    const code = `ITG${Date.now().toString(36).toUpperCase().slice(-8)}${index}`;

    const createdModule = await api(
      "/api/modules",
      cookie,
      "POST",
      {
        module_code: code,
        title: `Integrity Test ${status}`,
        description: "Temporary local integrity test",
        display_order: 9000 + index,
        is_active: true,
      }
    );

    if (createdModule.status !== 201) {
      throw new Error(
        `Module creation failed: ${status} HTTP ${createdModule.status}`
      );
    }

    const moduleId = createdModule.data.data.id;
    created.push(moduleId);

    const initialActivity = await api(
      `/api/modules/${moduleId}/activities`,
      cookie,
      "POST",
      {
        activity_code: `TEST${index}`,
        title: "Initial Activity",
        display_order: 1,
        is_active: true,
      }
    );

    if (initialActivity.status !== 201) {
      throw new Error(`Initial activity creation failed for ${status}`);
    }

    const activityId = initialActivity.data.data.id;

    if (status !== "PENDING") {
      await pool.query(
        `INSERT INTO module_reviews
          (module_id, approval_status, current_revision)
         VALUES ($1, $2, 1)`,
        [moduleId, status]
      );
    }

    const moduleUpdate = await api(
      `/api/modules/${moduleId}`,
      cookie,
      "PATCH",
      { title: `Updated ${status}` }
    );

    check(
      moduleUpdate.status === (editable ? 200 : 409),
      `${status}: module update ${editable ? "allowed" : "blocked"}`,
      `HTTP ${moduleUpdate.status}`
    );

    const activityUpdate = await api(
      `/api/modules/${moduleId}/activities/${activityId}`,
      cookie,
      "PATCH",
      { title: `Updated activity ${status}` }
    );

    check(
      activityUpdate.status === (editable ? 200 : 409),
      `${status}: activity update ${editable ? "allowed" : "blocked"}`,
      `HTTP ${activityUpdate.status}`
    );

    const activityCreate = await api(
      `/api/modules/${moduleId}/activities`,
      cookie,
      "POST",
      {
        activity_code: `NEW${index}`,
        title: "Additional Activity",
      }
    );

    check(
      activityCreate.status === (editable ? 201 : 409),
      `${status}: activity creation ${editable ? "allowed" : "blocked"}`,
      `HTTP ${activityCreate.status}`
    );

    if (!editable) {
      const activityDelete = await api(
        `/api/modules/${moduleId}/activities/${activityId}`,
        cookie,
        "DELETE"
      );

      check(
        activityDelete.status === 409,
        `${status}: activity deletion blocked`,
        `HTTP ${activityDelete.status}`
      );

      const moduleDelete = await api(
        `/api/modules/${moduleId}`,
        cookie,
        "DELETE"
      );

      check(
        moduleDelete.status === 409,
        `${status}: module deletion blocked`,
        `HTTP ${moduleDelete.status}`
      );
    }
  }
}

async function cleanup() {
  for (const id of created.reverse()) {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Test cleanup is allowed only for this local database.
      await client.query(
        "DELETE FROM module_decisions WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM module_comments WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM module_revisions WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM module_reviews WHERE module_id = $1",
        [id]
      );

      await client.query(
        "DELETE FROM module_activities WHERE module_id = $1",
        [id]
      );

      await client.query(
        `DELETE FROM audit_logs WHERE entity_type IN
          ('institutional_modules', 'module_activities')
          AND entity_id = $1`,
        [id]
      );

      await client.query(
        "DELETE FROM institutional_modules WHERE id = $1",
        [id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`Cleanup failed for module ${id}:`, error.message);
      failed++;
    } finally {
      client.release();
    }
  }
}

try {
  await main();
} catch (error) {
  failed++;
  console.error("TEST ERROR:", error.message);
} finally {
  await cleanup();
  await pool.end();
}

console.log("\n========== PROPOSAL INTEGRITY RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed) process.exitCode = 1;
