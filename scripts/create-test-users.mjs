import { Pool } from "pg";
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing");
}

const parsed = new URL(process.env.DATABASE_URL);

if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/opc_test_db"
) {
  throw new Error("Refusing to modify a non-test database");
}

const outputFile = ".opc-test-users.local.json";

if (existsSync(outputFile)) {
  throw new Error("Test credentials file already exists");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const users = [
  {
    name: "OPC Test Administrator",
    email: "admin.test@opc.example",
    role: "ADMIN",
  },
  {
    name: "OPC Test Reviewer",
    email: "reviewer.test@opc.example",
    role: "REVIEWER",
  },
  {
    name: "OPC Test Approver",
    email: "approver.test@opc.example",
    role: "APPROVER",
  },
];

const credentials = [];

try {
  for (const user of users) {
    const password = randomBytes(24).toString("base64url");
    const passwordHash = await argon2.hash(password);

    const result = await pool.query(
      `
      INSERT INTO app_users
        (full_name, email, password_hash, role_id, is_active)
      SELECT $1, $2, $3, id, TRUE
      FROM app_roles
      WHERE role_code = $4
      RETURNING id
      `,
      [user.name, user.email, passwordHash, user.role]
    );

    if (result.rowCount !== 1) {
      throw new Error(`Role missing: ${user.role}`);
    }

    credentials.push({
      email: user.email,
      password,
      role: user.role,
    });

    console.log(
      `CREATED: ${user.role} (${user.email})`
    );
  }

  writeFileSync(
    outputFile,
    JSON.stringify(credentials, null, 2),
    { mode: 0o600, flag: "wx" }
  );

  console.log("TEST USERS: CREATED");
  console.log("Credentials saved locally (not displayed).");
} finally {
  await pool.end();
}
