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
let reviewId = null;

function check(name, condition, detail = "") {
  console.log(
    `${condition ? "PASS" : "FAIL"}: ${name}` +
    (condition ? "" : ` — ${detail}`)
  );
  if (condition) passed++;
  else failed++;
}

async function request(role, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: base,
      Cookie: cookies[role] ?? "",
      ...(body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body) }),
  });

  const data = await response.json().catch(() => ({}));

  return {
    status: response.status,
    data,
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

    if (
      response.status !== 200 ||
      !data.success ||
      !cookie
    ) {
      throw new Error(`Login failed for ${account.role}`);
    }

    cookies[account.role] = cookie;
  }

  check("All three roles authenticated", true);

  const suffix = randomBytes(5)
    .toString("hex")
    .toUpperCase();

  const created = await request(
    "ADMIN",
    "POST",
    "/api/modules",
    {
      module_code: `R${suffix}`,
      title: "Proposal Review Start Test",
      is_active: true,
    }
  );

  moduleId = created.data?.data?.id;

  check(
    "ADMIN creates test proposal",
    created.status === 201 && Boolean(moduleId),
    `HTTP ${created.status}`
  );

  if (!moduleId) {
    throw new Error("Test proposal creation failed");
  }

  const path = `/api/reviews/${moduleId}/start`;

  const unauthenticated = await fetch(base + path, {
    method: "POST",
    headers: { Origin: base },
  });

  check(
    "Unauthenticated request rejected",
    unauthenticated.status === 403,
    `HTTP ${unauthenticated.status}`
  );

  const approver = await request(
    "APPROVER",
    "POST",
    path
  );

  check(
    "APPROVER cannot start review",
    approver.status === 403,
    `HTTP ${approver.status}`
  );

  const reviewer = await request(
    "REVIEWER",
    "POST",
    path
  );

  reviewId = reviewer.data?.data?.id;

  check(
    "REVIEWER starts review",
    reviewer.status === 200 &&
      reviewer.data?.data?.approval_status ===
        "UNDER_REVIEW",
    `HTTP ${reviewer.status}: ${reviewer.data?.error ?? ""}`
  );

  const duplicate = await request(
    "REVIEWER",
    "POST",
    path
  );

  check(
    "Duplicate start rejected",
    duplicate.status === 409,
    `HTTP ${duplicate.status}`
  );

  const review = await pool.query(
    `SELECT id::text AS id, approval_status
     FROM module_reviews
     WHERE module_id = $1`,
    [moduleId]
  );

  check(
    "Review status saved in PostgreSQL",
    review.rows.length === 1 &&
      review.rows[0].approval_status === "UNDER_REVIEW"
  );

  const audit = await pool.query(
    `SELECT action, entity_type, entity_id::text AS entity_id
     FROM audit_logs
     WHERE entity_type = 'module_reviews'
       AND entity_id = $1
       AND action = 'REVIEW_STARTED'`,
    [reviewId]
  );

  check(
    "Review start recorded in audit history",
    audit.rows.length === 1
  );

  const listing = await request(
    "REVIEWER",
    "GET",
    "/api/reviews"
  );

  check(
    "Review listing shows UNDER_REVIEW",
    listing.status === 200 &&
      listing.data?.data?.some(
        item =>
          item.module_id === moduleId &&
          item.approval_status === "UNDER_REVIEW"
      ),
    `HTTP ${listing.status}`
  );
} catch (error) {
  console.log(`TEST ERROR: ${error.message}`);
  failed++;
} finally {
  if (moduleId) {
    try {
      await pool.query(
        `DELETE FROM module_reviews WHERE module_id = $1`,
        [moduleId]
      );

      await pool.query(
        `UPDATE institutional_modules
         SET deleted_at = NOW()
         WHERE id = $1`,
        [moduleId]
      );
    } catch {
      console.log("WARNING: Test module cleanup failed");
    }
  }

  await pool.end();
}

console.log("\n========== REVIEW START TEST RESULTS ==========");
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);

if (failed > 0) process.exitCode = 1;
