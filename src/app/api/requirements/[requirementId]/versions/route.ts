import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ requirementId: string }> };
const validId = (value: string) => /^[1-9]\d*$/.test(value);
function fail(message: string, status: number) {
  return NextResponse.json({ success: false, message, data: null, meta: null }, { status });
}
function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://localhost:3000" || origin === "http://127.0.0.1:3000"));
}

export async function GET(_request: NextRequest, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail("Authentication required", 401);
  const { requirementId } = await context.params;
  if (!validId(requirementId)) return fail("Invalid requirement ID", 400);
  const client = await getPool().connect();
  try {
    const access = await client.query(
      `SELECT fr.id FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE fr.id = $1 AND fr.deleted_at IS NULL AND fr.is_active = TRUE
         AND m.deleted_at IS NULL AND m.is_active = TRUE AND p.deleted_at IS NULL
         AND ($2 = 'ADMIN' OR EXISTS (
           SELECT 1 FROM requirement_assignments ra
           WHERE ra.requirement_id = fr.id AND ra.user_id = $3
             AND ra.role_code = $2 AND ra.revoked_at IS NULL))`,
      [requirementId, user.role_code, user.id]
    );
    if (!access.rows[0]) return fail("Requirement not found or access denied", 404);
    const versions = await client.query(
      `SELECT v.id::text AS id, v.version_number, v.title, v.description,
              v.acceptance_criteria, v.consolidation_remarks,
              v.created_by::text AS created_by, u.full_name AS created_by_name,
              v.created_at,
              COALESCE(array_agg(vc.correction_id::text ORDER BY vc.correction_id)
                FILTER (WHERE vc.correction_id IS NOT NULL), ARRAY[]::text[]) AS correction_ids
       FROM requirement_versions v
       JOIN app_users u ON u.id = v.created_by
       LEFT JOIN requirement_version_corrections vc ON vc.version_id = v.id
       WHERE v.requirement_id = $1
       GROUP BY v.id, u.full_name ORDER BY v.version_number DESC`, [requirementId]
    );
    return NextResponse.json({ success: true, message: "Requirement versions loaded", data: versions.rows, meta: { total: versions.rowCount } });
  } catch (error) {
    console.error("Failed to load requirement versions:", error);
    return fail("Unable to load requirement versions", 500);
  } finally { client.release(); }
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getCurrentUser();
  if (!user) return fail("Authentication required", 401);
  if (user.role_code !== "REVIEWER") return fail("Reviewer access required", 403);
  if (!validOrigin(request)) return fail("Invalid request origin", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) return fail("JSON content type required", 415);
  const { requirementId } = await context.params;
  if (!validId(requirementId)) return fail("Invalid requirement ID", 400);
  let body: unknown;
  try { body = await request.json(); } catch { return fail("Invalid JSON", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid request body", 400);
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["title", "description", "acceptance_criteria", "consolidation_remarks", "correction_ids"].includes(key))) {
    return fail("Unexpected consolidation fields", 400);
  }
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const criteria = input.acceptance_criteria === null ? null :
    typeof input.acceptance_criteria === "string" ? input.acceptance_criteria.trim() || null : undefined;
  const remarks = typeof input.consolidation_remarks === "string" ? input.consolidation_remarks.trim() : "";
  const ids = input.correction_ids;
  if (!title || title.length > 255 || !description || description.length > 20000 ||
      criteria === undefined || (criteria && criteria.length > 20000) ||
      remarks.length < 10 || remarks.length > 5000 ||
      !Array.isArray(ids) || ids.length === 0 || ids.length > 100 ||
      ids.some(id => typeof id !== "string" || !validId(id)) || new Set(ids).size !== ids.length) {
    return fail("Invalid consolidated content, remarks, or correction IDs", 400);
  }
  const correctionIds = ids as string[];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const requirement = await client.query(
      `SELECT fr.id, fr.title, fr.description, fr.acceptance_criteria, fr.status, rl.lifecycle_status
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       JOIN requirement_lifecycle rl ON rl.requirement_id = fr.id
       WHERE fr.id = $1 AND fr.deleted_at IS NULL AND fr.is_active = TRUE
         AND m.deleted_at IS NULL AND m.is_active = TRUE AND p.deleted_at IS NULL
       FOR UPDATE OF fr, rl`, [requirementId]
    );
    const current = requirement.rows[0];
    if (!current) { await client.query("ROLLBACK"); return fail("Active requirement not found", 404); }
    const assignment = await client.query(
      `SELECT id FROM requirement_assignments WHERE requirement_id = $1 AND user_id = $2
       AND role_code = 'REVIEWER' AND is_lead = TRUE AND revoked_at IS NULL`,
      [requirementId, user.id]
    );
    if (!assignment.rows[0]) { await client.query("ROLLBACK"); return fail("Only the assigned Lead Reviewer can apply consolidated requirements", 403); }
    if (current.status !== "UNDER_REVIEW" || current.lifecycle_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK"); return fail("Requirement is not under review", 409);
    }
    // Lock all corrections in stable order while the requirement row serializes concurrent workflows.
    const corrections = await client.query(
      `SELECT c.id::text AS id, c.status,
              (vc.id IS NOT NULL) AS applied
       FROM requirement_corrections c
       LEFT JOIN requirement_version_corrections vc ON vc.correction_id = c.id
       WHERE c.requirement_id = $1 ORDER BY c.id FOR UPDATE OF c`, [requirementId]
    );
    const pending = corrections.rows.filter(row => row.status === "DRAFT" || row.status === "SUBMITTED");
    if (pending.length) { await client.query("ROLLBACK"); return fail("Review all pending correction drafts/submissions before consolidation", 409); }
    const unapplied = corrections.rows.filter(row => row.status === "ACCEPTED" && !row.applied).map(row => row.id as string);
    if (unapplied.length !== correctionIds.length || unapplied.some(id => !correctionIds.includes(id))) {
      await client.query("ROLLBACK"); return fail("Select every accepted, unapplied correction exactly once", 409);
    }
    const existing = await client.query(
      `SELECT version_number, title, description, acceptance_criteria
       FROM requirement_versions WHERE requirement_id = $1 ORDER BY version_number DESC LIMIT 1`, [requirementId]
    );
    const latest = existing.rows[0];
    if (latest && (latest.title !== current.title || latest.description !== current.description || latest.acceptance_criteria !== current.acceptance_criteria)) {
      await client.query("ROLLBACK"); return fail("Requirement changed outside version history; consolidation blocked", 409);
    }
    if (!latest) {
      await client.query(
        `INSERT INTO requirement_versions (requirement_id, version_number, title, description,
          acceptance_criteria, created_by, consolidation_remarks)
         VALUES ($1, 1, $2, $3, $4, $5, $6)`,
        [requirementId, current.title, current.description, current.acceptance_criteria, user.id,
          "Original requirement snapshot before approved correction consolidation"]
      );
    }
    const nextVersion = latest ? latest.version_number + 1 : 2;
    const created = await client.query(
      `INSERT INTO requirement_versions (requirement_id, version_number, title, description,
         acceptance_criteria, created_by, consolidation_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id::text AS id, version_number, title, description, acceptance_criteria, created_at`,
      [requirementId, nextVersion, title, description, criteria, user.id, remarks]
    );
    const version = created.rows[0];
    for (const id of correctionIds) {
      await client.query(
        `INSERT INTO requirement_version_corrections (requirement_id, version_id, correction_id)
         VALUES ($1, $2, $3)`, [requirementId, version.id, id]
      );
    }
    await client.query(
      `UPDATE activity_functional_requirements SET title = $2, description = $3,
        acceptance_criteria = $4, updated_at = NOW() WHERE id = $1`,
      [requirementId, title, description, criteria]
    );
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
       VALUES ($1, 'REQUIREMENT_VERSION_APPLIED', 'activity_functional_requirements', $2, $3::jsonb, $4::jsonb)`,
      [user.id, requirementId,
        JSON.stringify({ title: current.title, description: current.description, acceptance_criteria: current.acceptance_criteria }),
        JSON.stringify({ version_id: version.id, version_number: nextVersion, title, description,
          acceptance_criteria: criteria, correction_ids: correctionIds, consolidation_remarks: remarks,
          lead_reviewer_assignment_id: String(assignment.rows[0].id) })]
    );
    await client.query("COMMIT");
    return NextResponse.json({ success: true, message: "Consolidated requirement applied and versioned", data: version, meta: { correction_ids: correctionIds } }, { status: 201 });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to consolidate requirement:", error);
    return fail("Unable to consolidate requirement", 500);
  } finally { client.release(); }
}
