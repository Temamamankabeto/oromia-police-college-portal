import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    requirementId: string;
    correctionId: string;
  }>;
};

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, message, data: null, meta: null },
    { status }
  );
}

function validId(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
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

export async function POST(
  request: NextRequest,
  context: Context
) {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  if (user.role_code !== "DEVELOPER") {
    return fail("Developer access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { requirementId, correctionId } = await context.params;

  if (!validId(requirementId) || !validId(correctionId)) {
    return fail("Invalid requirement or correction ID", 400);
  }

  const client = await getPool().connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const requirement = await client.query(
      `SELECT
         fr.id,
         fr.status,
         rl.lifecycle_status
       FROM activity_functional_requirements fr
       JOIN institutional_modules m
         ON m.id = fr.module_id
       JOIN projects p
         ON p.id = m.project_id
       JOIN requirement_lifecycle rl
         ON rl.requirement_id = fr.id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       FOR UPDATE OF fr, rl`,
      [requirementId]
    );

    if (!requirement.rows[0]) {
      return fail("Active requirement not found", 404);
    }

    if (
      requirement.rows[0].status !== "UNDER_REVIEW" ||
      requirement.rows[0].lifecycle_status !== "UNDER_REVIEW"
    ) {
      return fail("Requirement is not under review", 409);
    }

    const assignment = await client.query(
      `SELECT id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND user_id = $2
         AND role_code = 'DEVELOPER'
         AND revoked_at IS NULL
       FOR UPDATE`,
      [requirementId, user.id]
    );

    if (!assignment.rows[0]) {
      return fail(
        "Only an assigned Developer can submit corrections",
        403
      );
    }

    const correction = await client.query(
      `SELECT
         id,
         requirement_id,
         comment_id,
         developer_id,
         status,
         proposed_title,
         proposed_description,
         proposed_acceptance_criteria,
         correction_explanation
       FROM requirement_corrections
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [correctionId, requirementId]
    );

    if (!correction.rows[0]) {
      return fail("Correction not found", 404);
    }

    const current = correction.rows[0];

    if (String(current.developer_id) !== user.id) {
      return fail(
        "Only the Developer who created this draft can submit it",
        403
      );
    }

    if (current.status !== "DRAFT") {
      return fail(
        "Only draft corrections can be submitted",
        409
      );
    }

    const comment = await client.query(
      `SELECT id, resolution_status
       FROM requirement_review_comments
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [current.comment_id, requirementId]
    );

    if (!comment.rows[0]) {
      return fail("Review comment not found", 404);
    }

    if (comment.rows[0].resolution_status === "RESOLVED") {
      return fail(
        "Cannot submit a correction for a resolved comment",
        409
      );
    }

    const updated = await client.query(
      `UPDATE requirement_corrections
       SET status = 'SUBMITTED',
           submitted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND requirement_id = $2
         AND status = 'DRAFT'
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         comment_id::text AS comment_id,
         developer_id::text AS developer_id,
         status,
         submitted_at,
         updated_at`,
      [correctionId, requirementId]
    );

    if (!updated.rows[0]) {
      throw new Error("Correction submission update failed.");
    }

    await client.query(
      `INSERT INTO audit_logs (
         actor_id,
         action,
         entity_type,
         entity_id,
         old_values,
         new_values
       )
       VALUES (
         $1,
         'REQUIREMENT_CORRECTION_SUBMITTED',
         'requirement_corrections',
         $2,
         $3::jsonb,
         $4::jsonb
       )`,
      [
        user.id,
        correctionId,
        JSON.stringify({
          requirement_id: requirementId,
          status: "DRAFT",
          submitted_at: null,
        }),
        JSON.stringify({
          requirement_id: requirementId,
          comment_id: String(current.comment_id),
          developer_id: user.id,
          developer_assignment_id: String(assignment.rows[0].id),
          status: "SUBMITTED",
          submitted_at: updated.rows[0].submitted_at,
        }),
      ]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return NextResponse.json({
      success: true,
      message: "Correction submitted for Lead Reviewer verification",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    console.error("Failed to submit correction:", error);
    return fail("Unable to submit correction", 500);
  } finally {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    client.release();
  }
}