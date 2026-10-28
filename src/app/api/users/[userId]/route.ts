import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";
import { hashPassword } from "@/lib/auth/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ userId: string }>;
};

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return fail("Administrator access required", 403);
  }

  const origin = request.headers.get("origin");

  if (
    origin !== "https://opc.osdavc.com" &&
    !(
      process.env.NODE_ENV === "development" &&
      origin === "http://127.0.0.1:3000"
    )
  ) {
    return fail("Invalid request origin", 403);
  }

  const { userId } = await context.params;

  if (!/^[1-9]\d*$/.test(userId)) {
    return fail("Invalid user ID", 400);
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
  const allowed = [
    "full_name",
    "email",
    "role_code",
    "is_active",
    "password",
  ];

  const keys = Object.keys(input);

  if (
    keys.length === 0 ||
    keys.some(key => !allowed.includes(key))
  ) {
    return fail("Invalid update fields", 400);
  }

  if (
    input.full_name !== undefined &&
    (typeof input.full_name !== "string" ||
      input.full_name.trim().length < 2 ||
      input.full_name.trim().length > 150)
  ) {
    return fail("Invalid full name", 400);
  }

  if (
    input.email !== undefined &&
    (typeof input.email !== "string" ||
      input.email.trim().length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        input.email.trim()
      ))
  ) {
    return fail("Invalid email address", 400);
  }

  if (
    input.role_code !== undefined &&
    !["ADMIN", "REVIEWER", "APPROVER"].includes(
      String(input.role_code)
    )
  ) {
    return fail("Invalid user role", 400);
  }

  if (
    input.is_active !== undefined &&
    typeof input.is_active !== "boolean"
  ) {
    return fail("Invalid active status", 400);
  }

  if (
    input.password !== undefined &&
    (typeof input.password !== "string" ||
      input.password.length < 12 ||
      input.password.length > 128)
  ) {
    return fail("Password must contain 12–128 characters", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.is_active,
         r.role_code
       FROM app_users u
       JOIN app_roles r ON r.id = u.role_id
       WHERE u.id = $1
         AND u.deleted_at IS NULL
       FOR UPDATE OF u`,
      [userId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return fail("User not found", 404);
    }

    const roleCode =
      typeof input.role_code === "string"
        ? input.role_code
        : existing.role_code;

    const isActive =
      typeof input.is_active === "boolean"
        ? input.is_active
        : existing.is_active;

    if (
      userId === admin.id &&
      (!isActive || roleCode !== "ADMIN")
    ) {
      await client.query("ROLLBACK");
      return fail(
        "Cannot deactivate or remove your own administrator role",
        409
      );
    }

    const roleResult = await client.query(
      `SELECT id FROM app_roles WHERE role_code = $1`,
      [roleCode]
    );

    if (!roleResult.rows.length) {
      await client.query("ROLLBACK");
      return fail("Role not found", 400);
    }

    const fullName =
      typeof input.full_name === "string"
        ? input.full_name.trim()
        : existing.full_name;

    const email =
      typeof input.email === "string"
        ? input.email.trim().toLowerCase()
        : existing.email;

    const passwordHash =
      typeof input.password === "string"
        ? await hashPassword(input.password)
        : null;

    const updated = await client.query(
      `UPDATE app_users
       SET
         full_name = $2,
         email = $3,
         role_id = $4,
         is_active = $5,
         password_hash = COALESCE($6::text, password_hash),
         session_version = CASE
           WHEN $6::text IS NOT NULL
           THEN session_version + 1
           ELSE session_version
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING
         id::text AS id,
         full_name,
         email,
         is_active,
         updated_at`,
      [
        userId,
        fullName,
        email,
        roleResult.rows[0].id,
        isActive,
        passwordHash,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
         (
           actor_id,
           action,
           entity_type,
           entity_id,
           old_values,
           new_values
         )
       VALUES
         ($1, 'USER_UPDATED', 'app_users', $2, $3::jsonb, $4::jsonb)`,
      [
        admin.id,
        userId,
        JSON.stringify({
          full_name: existing.full_name,
          email: existing.email,
          role_code: existing.role_code,
          is_active: existing.is_active,
        }),
        JSON.stringify({
          full_name: fullName,
          email,
          role_code: roleCode,
          is_active: isActive,
          password_changed:
            typeof input.password === "string",
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "User updated successfully",
      data: {
        ...updated.rows[0],
        role_code: roleCode,
      },
    });
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

    console.error("User update failed:", error);
    return fail("Unable to update user", 500);
  } finally {
    client.release();
  }
}
