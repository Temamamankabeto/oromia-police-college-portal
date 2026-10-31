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

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  return (
    origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://localhost:3000" ||
        origin === "http://127.0.0.1:3000"))
  );
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
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

  const { requirementId, correctionId } = await context.params;

  if (
    !/^[1-9]\d*$/.test(requirementId) ||
    !/^[1-9]\d*$/.test(correctionId)
  ) {
    return fail("Invalid requirement or correction ID", 400);
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

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return fail("Invalid request body", 400);
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).some(
      key => !["decision", "review_remarks"].includes(key)
    )
  ) {
    return fail("Unexpected review fields", 400);
  }

  const decision = input.decision;

  if (
    decision !== "ACCEPTED" &&
    decision !== "RETURNED"
  ) {
    return fail("Decision must be ACCEPTED or RETURNED", 400);
  }

  const remarks =
    typeof input.review_remarks === "string"
      ? input.review_remarks.trim()
      : "";

  if (remarks.length < 10 || remarks.length > 2000) {
    return fail(
      "Review remarks must contain 10-2000 characters",
      400
    );
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirement = await client.query(
      `SELECT fr.id, fr.status, rl.lifecycle_status
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
      return fail(
        "Only the assigned Lead Reviewer can verify corrections",
        403
      );
    }

    if (
      requirement.rows[0].status !== "UNDER_REVIEW" ||
      requirement.rows[0].lifecycle_status !== "UNDER_REVIEW"
    ) {
      await client.query("ROLLBACK");
      return fail("Requirement is not under review", 409);
    }

    const correction = await client.query(
      `SELECT
         id,
         requirement_id,
         comment_id,
         developer_id,
         status,
         submitted_at,
         reviewed_by,
         reviewed_at,
         review_remarks
       FROM requirement_corrections
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [correctionId, requirementId]
    );

    if (!correction.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Correction not found", 404);
    }

    if (correction.rows[0].status !== "SUBMITTED") {
      await client.query("ROLLBACK");
      return fail(
        "Only submitted corrections can be reviewed",
        409
      );
    }

    if (
      correction.rows[0].reviewed_by !== null ||
      correction.rows[0].reviewed_at !== null
    ) {
      await client.query("ROLLBACK");
      return fail("Correction has already been reviewed", 409);
    }

    const comment = await client.query(
      `SELECT id, resolution_status
       FROM requirement_review_comments
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [correction.rows[0].comment_id, requirementId]
    );

    if (!comment.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Associated review comment not found", 404);
    }

    if (comment.rows[0].resolution_status === "RESOLVED") {
      await client.query("ROLLBACK");
      return fail(
        "Cannot review a correction for a resolved comment",
        409
      );
    }

    const updated = await client.query(
      `UPDATE requirement_corrections
       SET status = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           review_remarks = $3,
           updated_at = NOW()
       WHERE id = $4
         AND requirement_id = $5
         AND status = 'SUBMITTED'
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         comment_id::text AS comment_id,
         developer_id::text AS developer_id,
         status,
         submitted_at,
         reviewed_by::text AS reviewed_by,
         reviewed_at,
         review_remarks,
         updated_at`,
      [decision, user.id, remarks, correctionId, requirementId]
    );

    if (!updated.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Correction state changed concurrently", 409);
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
         'REQUIREMENT_CORRECTION_REVIEWED',
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
          comment_id: String(correction.rows[0].comment_id),
          status: "SUBMITTED",
          reviewed_by: null,
          reviewed_at: null,
        }),
        JSON.stringify({
          requirement_id: requirementId,
          comment_id: String(correction.rows[0].comment_id),
          status: decision,
          reviewed_by: String(user.id),
          reviewed_at: updated.rows[0].reviewed_at,
          review_remarks: remarks,
          lead_reviewer_assignment_id: String(
            assignment.rows[0].id
          ),
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message:
        decision === "ACCEPTED"
          ? "Correction accepted successfully"
          : "Correction returned to Developer successfully",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Failed to review correction:", error);

    return fail("Unable to review correction", 500);
  } finally {
    client.release();
  }
}