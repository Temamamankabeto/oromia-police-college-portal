import "server-only";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import {
  SESSION_COOKIE,
  verifySessionToken,
} from "@/lib/auth/session";

export type UserRole = "ADMIN" | "REVIEWER" | "APPROVER";

export type CurrentUser = {
  id: string;
  full_name: string;
  email: string;
  role_code: UserRole;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  const session = await verifySessionToken(token);

  if (
    !session ||
    !/^[1-9]\d*$/.test(session.userId)
  ) {
    return null;
  }

  const result = await query<CurrentUser>(
    `
    SELECT
      u.id::text AS id,
      u.full_name,
      u.email,
      r.role_code
    FROM app_users u
    INNER JOIN app_roles r ON r.id = u.role_id
    WHERE u.id = $1
      AND u.is_active = TRUE
      AND u.session_version = $2
      AND u.deleted_at IS NULL
      AND r.role_code IN ('ADMIN', 'REVIEWER', 'APPROVER')
    LIMIT 1
    `,
    [session.userId, session.sessionVersion]
  );

  return result.rows[0] ?? null;
}

export async function requireRole(
  allowedRoles: UserRole[]
): Promise<CurrentUser | null> {
  const user = await getCurrentUser();

  if (!user || !allowedRoles.includes(user.role_code)) {
    return null;
  }

  return user;
}
