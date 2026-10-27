import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import {
  rateLimitIdentifier,
  isLoginBlocked,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
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
  const origin = request.headers.get("origin");

  if (!origin || origin !== "https://opc.osdavc.com") {
    return NextResponse.json(
      { success: false, error: "Invalid request origin" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    return NextResponse.json(
      { success: false, error: "JSON content type required" },
      { status: 415 }
    );
  }

  const contentLength = request.headers.get("content-length");

  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) || Number(contentLength) > 4096)
  ) {
    return NextResponse.json(
      { success: false, error: "Request body too large" },
      { status: 413 }
    );
  }

  try {
    const rawBody = await request.text();

    if (Buffer.byteLength(rawBody, "utf8") > 4096) {
      return NextResponse.json(
        { success: false, error: "Request body too large" },
        { status: 413 }
      );
    }

    let body: unknown;

    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid login request" },
        { status: 400 }
      );
    }

    const credentials = body as Record<string, unknown>;

    if (
      !body ||
      typeof credentials.email !== "string" ||
      typeof credentials.password !== "string"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid login request" },
        { status: 400 }
      );
    }

    const email = (credentials.email as string).trim().toLowerCase();
    const password = credentials.password as string;

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

    const accountKey = rateLimitIdentifier("account", email);

    if (await isLoginBlocked(accountKey, 5)) {
      return NextResponse.json(
        { success: false, error: "Too many login attempts. Try again later." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": "900",
          },
        }
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
      const blocked = await recordLoginAttempt(accountKey, 5);

      if (blocked) {
        return NextResponse.json(
          {
            success: false,
            error: "Too many login attempts. Try again later.",
          },
          {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": "900",
            },
          }
        );
      }

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
