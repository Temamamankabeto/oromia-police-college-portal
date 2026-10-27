import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";

export const runtime = "nodejs";

type LoginUser = {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  role_code: "ADMIN" | "REVIEWER" | "APPROVER";
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (
      !body ||
      typeof body.email !== "string" ||
      typeof body.password !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid login request" },
        { status: 400 }
      );
    }

    const email = body.email.trim().toLowerCase();
    const password = body.password;

    if (
      email.length === 0 ||
      email.length > 255 ||
      password.length === 0 ||
      Buffer.byteLength(password, "utf8") > 1024
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid login request" },
        { status: 400 }
      );
    }

    const result = await query<LoginUser>(
      `
      SELECT
        u.id::text AS id,
        u.full_name,
        u.email,
        u.password_hash,
        r.role_code
      FROM app_users u
      INNER JOIN app_roles r ON r.id = u.role_id
      WHERE LOWER(u.email) = $1
        AND u.is_active = TRUE
        AND u.deleted_at IS NULL
        AND r.role_code IN ('ADMIN', 'REVIEWER', 'APPROVER')
      LIMIT 1
      `,
      [email]
    );

    const user = result.rows[0];

    if (
      !user ||
      !(await verifyPassword(user.password_hash, password))
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await createSessionToken(user.id);

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role_code: user.role_code,
      },
    });

    response.cookies.set(
      SESSION_COOKIE,
      token,
      sessionCookieOptions
    );

    return response;
  } catch (error) {
    console.error("Login failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to process login" },
      { status: 500 }
    );
  }
}
