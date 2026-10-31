import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ success: false, message: "Authentication required", data: null, meta: null }, { status: 401 });
  if (user.role_code !== "DEVELOPER") return NextResponse.json({ success: false, message: "Developer access required", data: null, meta: null }, { status: 403 });
  try {
    const result = await query(`
      SELECT fr.id::text AS requirement_id, fr.requirement_code, fr.title,
             fr.description, fr.acceptance_criteria, fr.priority,
             fr.status AS requirement_status, rl.lifecycle_status,
             rl.updated_at AS lifecycle_updated_at,
             m.module_code, m.title AS module_name
      FROM requirement_assignments ra
      JOIN activity_functional_requirements fr ON fr.id = ra.requirement_id
      JOIN requirement_lifecycle rl ON rl.requirement_id = fr.id
      JOIN institutional_modules m ON m.id = fr.module_id
      JOIN projects p ON p.id = m.project_id
      WHERE ra.user_id = $1 AND ra.role_code = 'DEVELOPER'
        AND ra.revoked_at IS NULL AND fr.deleted_at IS NULL AND fr.is_active = TRUE
        AND m.deleted_at IS NULL AND m.is_active = TRUE AND p.deleted_at IS NULL
        AND rl.lifecycle_status IN ('APPROVED', 'UNDER_DEVELOPING', 'DEVELOPED')
      ORDER BY fr.requirement_code, fr.id`, [user.id]);
    return NextResponse.json({ success: true, message: "Developer requirements loaded", data: result.rows, meta: { total: result.rows.length } });
  } catch (error) {
    console.error("Developer requirements load failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load developer requirements", data: null, meta: null }, { status: 500 });
  }
}