import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requirementId: string }> };
const fail = (message: string, status: number) => NextResponse.json({ success: false, message, data: null, meta: null }, { status });
function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === "https://opc.osdavc.com" || (process.env.NODE_ENV === "development" && (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"));
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.role_code !== "DEVELOPER") return fail("Developer access required", 403);
  if (!validOrigin(request)) return fail("Invalid request origin", 403);
  const { requirementId } = await context.params;
  if (!/^[1-9]\d*$/.test(requirementId)) return fail("Invalid requirement ID", 400);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT fr.id, fr.status, fr.requirement_code, rl.lifecycle_status, ra.id AS assignment_id
      FROM activity_functional_requirements fr
      JOIN requirement_lifecycle rl ON rl.requirement_id = fr.id
      JOIN requirement_assignments ra ON ra.requirement_id = fr.id
        AND ra.user_id = $2 AND ra.role_code = 'DEVELOPER' AND ra.revoked_at IS NULL
      JOIN institutional_modules m ON m.id = fr.module_id
      JOIN projects p ON p.id = m.project_id
      WHERE fr.id = $1 AND fr.deleted_at IS NULL AND fr.is_active = TRUE
        AND m.deleted_at IS NULL AND m.is_active = TRUE AND p.deleted_at IS NULL
      FOR UPDATE OF fr, rl`, [requirementId, user.id]);
    const row = result.rows[0];
    if (!row) { await client.query("ROLLBACK"); return fail("Assigned active requirement not found", 404); }
    if (row.status !== "APPROVED" || row.lifecycle_status !== "APPROVED") {
      await client.query("ROLLBACK"); return fail("Only approved requirements can start development", 409);
    }
    await client.query(`UPDATE requirement_lifecycle SET lifecycle_status = 'UNDER_DEVELOPING', updated_by = $2, updated_at = NOW() WHERE requirement_id = $1`, [requirementId, user.id]);
    const event = await client.query(`INSERT INTO requirement_workflow_events (requirement_id, from_status, to_status, actor_id, remarks, metadata) VALUES ($1, 'APPROVED', 'UNDER_DEVELOPING', $2, 'Development started', $3::jsonb) RETURNING id::text AS id`, [requirementId, user.id, JSON.stringify({ assignment_id: String(row.assignment_id) })]);
    await client.query(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values) VALUES ($1, 'REQUIREMENT_DEVELOPMENT_STARTED', 'activity_functional_requirements', $2, $3::jsonb, $4::jsonb)`, [user.id, requirementId, JSON.stringify({ lifecycle_status: "APPROVED" }), JSON.stringify({ lifecycle_status: "UNDER_DEVELOPING", workflow_event_id: event.rows[0].id })]);
    await client.query("COMMIT");
    return NextResponse.json({ success: true, message: "Development started successfully", data: { requirement_id: requirementId, lifecycle_status: "UNDER_DEVELOPING" }, meta: null });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Start development failed:", error);
    return fail("Unable to start development", 500);
  } finally { client.release(); }
}