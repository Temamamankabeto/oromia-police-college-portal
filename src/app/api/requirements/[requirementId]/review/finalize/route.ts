import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ requirementId: string }>;
};

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, message, data: null, meta: null },
    { status }
  );
}

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  return (
    origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://localhost:3000" ||
        origin === "http://127.0.0.1:3000"))
  );
}

export async function POST(request: NextRequest, context: Context) {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  if (user.role_code !== "REVIEWER") {
    return fail("Reviewer access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { requirementId } = await context.params;

  if (!/^[1-9]\d*$/.test(requirementId)) {
    return fail("Invalid requirement ID", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirement = await client.query(
      `SELECT fr.id, fr.status
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       FOR UPDATE OF fr`,
      [requirementId]
    );

    if (!requirement.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Active requirement not found", 404);
    }

    const assignment = await client.query(
      `SELECT id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND user_id = $2
         AND role_code = 'REVIEWER'
         AND is_lead = TRUE
         AND revoked_at IS NULL`,
      [requirementId, user.id]
    );

    if (!assignment.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Only the assigned Lead Reviewer can finalize this review", 403);
    }

    const lifecycle = await client.query(
      `SELECT lifecycle_status
       FROM requirement_lifecycle
       WHERE requirement_id = $1
       FOR UPDATE`,
      [requirementId]
    );

    if (lifecycle.rows[0]?.lifecycle_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");
      return fail("Requirement must be under review before finalization", 409);
    }

    if (requirement.rows[0].status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");
      return fail("Requirement status does not permit finalization", 409);
    }

    const unresolved = await client.query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total
       FROM requirement_review_comments
       WHERE requirement_id = $1
         AND resolution_status <> 'RESOLVED'`,
      [requirementId]
    );

    const unresolvedCount = unresolved.rows[0]?.total ?? 0;

    if (unresolvedCount > 0) {
      await client.query("ROLLBACK");
      return fail(
        `Cannot finalize review: ${unresolvedCount} unresolved comment(s) remain`,
        409
      );
    }

    const outstanding = await client.query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total
       FROM requirement_corrections c
       LEFT JOIN requirement_version_corrections vc ON vc.correction_id = c.id
       WHERE c.requirement_id = $1
         AND (c.status IN ('DRAFT', 'SUBMITTED')
              OR (c.status = 'ACCEPTED' AND vc.id IS NULL))`,
      [requirementId]
    );
    if ((outstanding.rows[0]?.total ?? 0) > 0) {
      await client.query("ROLLBACK");
      return fail("Cannot finalize: pending or unapplied accepted corrections remain", 409);
    }

    const updated = await client.query(
      `UPDATE requirement_lifecycle
       SET lifecycle_status = 'REVIEWED',
           updated_by = $2,
           updated_at = NOW()
       WHERE requirement_id = $1
         AND lifecycle_status = 'UNDER_REVIEW'
       RETURNING
         requirement_id::text AS requirement_id,
         lifecycle_status,
         updated_by::text AS updated_by,
         updated_at`,
      [requirementId, user.id]
    );

    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Requirement review state changed concurrently", 409);
    }

    await client.query(
      `INSERT INTO requirement_workflow_events
         (requirement_id, from_status, to_status,
          actor_id, remarks, metadata)
       VALUES
         ($1, 'UNDER_REVIEW', 'REVIEWED',
          $2, 'Lead Reviewer finalized requirement review',
          $3::jsonb)`,
      [
        requirementId,
        user.id,
        JSON.stringify({
          assignment_id: String(assignment.rows[0].id),
          unresolved_comments: 0,
        }),
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id,
          old_values, new_values)
       VALUES
         ($1, 'REQUIREMENT_REVIEW_FINALIZED',
          'activity_functional_requirements', $2,
          $3::jsonb, $4::jsonb)`,
      [
        user.id,
        requirementId,
        JSON.stringify({
          lifecycle_status: "UNDER_REVIEW",
          status: "UNDER_REVIEW",
        }),
        JSON.stringify({
          lifecycle_status: "REVIEWED",
          status: "UNDER_REVIEW",
          lead_reviewer_assignment_id: String(assignment.rows[0].id),
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Requirement review finalized successfully",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to finalize requirement review:", error);

    return fail("Unable to finalize requirement review", 500);
  } finally {
    client.release();
  }
}
