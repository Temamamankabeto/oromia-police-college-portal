import { NextRequest, NextResponse } from "next/server";
import { query, getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

export async function GET() {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return fail("Administrator access required", 403);
  }

  try {
    const result = await query(
      `SELECT
         u.id::text AS id,
         u.full_name,
         u.email,
         r.role_code,
         r.role_name,
         u.is_active,
         u.last_login_at,
         u.created_at
       FROM app_users u
       JOIN app_roles r ON r.id = u.role_id
       WHERE u.deleted_at IS NULL
       ORDER BY u.created_at DESC, u.id DESC`
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("User listing failed:", error);
    return fail("Unable to load users", 500);
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return fail("Administrator access required", 403);
  }

  const origin = request.headers.get("origin");

  if (
    origin !== "https://opc.osdavc.com" &&
    !(
      process.env.NODE_ENV === "development" &&
      (origin === "http://127.0.0.1:3000" ||
        origin === "http://localhost:3000")
    )
  ) {
    return fail("Invalid request origin", 403);
  }

  if (
    !request.headers.get("content-type")
      ?.includes("application/json")
  ) {
    return fail("JSON content type required", 415);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return fail("Invalid JSON", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body", 400);
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).some(
      key =>
        ![
          "full_name",
          "email",
          "password",
          "role_code",
        ].includes(key)
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  const fullName =
    typeof input.full_name === "string"
      ? input.full_name.trim()
      : "";

  const email =
    typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";

  const password =
    typeof input.password === "string"
      ? input.password
      : "";

  const role =
    typeof input.role_code === "string"
      ? input.role_code
      : "";

  if (fullName.length < 2 || fullName.length > 150) {
    return fail("Name must contain 2–150 characters", 400);
  }

  if (
    email.length > 255 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return fail("Invalid email address", 400);
  }

  if (password.length < 12 || password.length > 128) {
    return fail("Password must contain 12–128 characters", 400);
  }

  if (!["ADMIN", "DEVELOPER", "REVIEWER", "APPROVER", "TESTER"].includes(role)) {
    return fail("Invalid user role", 400);
  }

  const passwordHash = await hashPassword(password);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const roleResult = await client.query(
      `SELECT id FROM app_roles WHERE role_code = $1`,
      [role]
    );

    if (!roleResult.rows.length) {
      await client.query("ROLLBACK");
      return fail("Role not found", 400);
    }

    const result = await client.query(
      `INSERT INTO app_users
         (full_name, email, password_hash, role_id, is_active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING
         id::text AS id,
         full_name,
         email,
         is_active,
         created_at`,
      [fullName, email, passwordHash, roleResult.rows[0].id]
    );

    const created = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, new_values)
       VALUES
         ($1, 'USER_CREATED', 'app_users', $2, $3::jsonb)`,
      [
        admin.id,
        created.id,
        JSON.stringify({
          full_name: fullName,
          email,
          role_code: role,
          is_active: true,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        message: "User created successfully",
        data: { ...created, role_code: role },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => {});

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      return fail("Email address already exists", 409);
    }

    console.error("User creation failed:", error);
    return fail("Unable to create user", 500);
  } finally {
    client.release();
  }
}
