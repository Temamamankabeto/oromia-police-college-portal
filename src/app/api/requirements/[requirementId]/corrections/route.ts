import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ requirementId: string }>;
};

type CorrectionInput = {
  comment_id: string;
  proposed_title: string;
  proposed_description: string;
  proposed_acceptance_criteria: string | null;
  correction_explanation: string;
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

export async function GET(
  _request: NextRequest,
  context: Context
) {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
  }

  try {
    const access = await query(
      `SELECT fr.id
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
         AND (
           $2 = 'ADMIN'
           OR EXISTS (
             SELECT 1
             FROM requirement_assignments ra
             WHERE ra.requirement_id = fr.id
               AND ra.user_id = $3
               AND ra.role_code = $2
               AND ra.revoked_at IS NULL
           )
         )`,
      [requirementId, user.role_code, user.id]
    );

    if (!access.rows[0]) {
      return fail("Requirement not found or access denied", 404);
    }

    const result = await query(
      `SELECT
         c.id::text AS id,
         c.requirement_id::text AS requirement_id,
         c.comment_id::text AS comment_id,
         rc.comment_type,
         rc.comment_text,
         c.developer_id::text AS developer_id,
         developer.full_name AS developer_name,
         c.proposed_title,
         c.proposed_description,
         c.proposed_acceptance_criteria,
         c.correction_explanation,
         c.status,
         c.submitted_at,
         c.reviewed_by::text AS reviewed_by,
         reviewer.full_name AS reviewed_by_name,
         c.reviewed_at,
         c.review_remarks,
         c.created_at,
         c.updated_at
       FROM requirement_corrections c
       JOIN requirement_review_comments rc
         ON rc.id = c.comment_id
        AND rc.requirement_id = c.requirement_id
       JOIN app_users developer
         ON developer.id = c.developer_id
       LEFT JOIN app_users reviewer
         ON reviewer.id = c.reviewed_by
       WHERE c.requirement_id = $1
         AND (
           c.status <> 'DRAFT'
           OR c.developer_id = $2
           OR $3 = 'ADMIN'
         )
       ORDER BY c.created_at DESC, c.id DESC`,
      [requirementId, user.id, user.role_code]
    );

    return NextResponse.json({
      success: true,
      message: "Requirement corrections loaded successfully",
      data: result.rows,
      meta: { total: result.rowCount },
    });
  } catch (error) {
    console.error("Failed to load requirement corrections:", error);
    return fail("Unable to load requirement corrections", 500);
  }
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

  if (
    !request.headers.get("content-type")
      ?.includes("application/json")
  ) {
    return fail("JSON content type required", 415);
  }

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
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

  const allowedFields = [
    "comment_id",
    "proposed_title",
    "proposed_description",
    "proposed_acceptance_criteria",
    "correction_explanation",
  ];

  if (
    Object.keys(input).some(
      key => !allowedFields.includes(key)
    )
  ) {
    return fail("Unexpected correction fields", 400);
  }

  const commentId =
    typeof input.comment_id === "string"
      ? input.comment_id
      : "";

  const title =
    typeof input.proposed_title === "string"
      ? input.proposed_title.trim()
      : "";

  const description =
    typeof input.proposed_description === "string"
      ? input.proposed_description.trim()
      : "";

  const explanation =
    typeof input.correction_explanation === "string"
      ? input.correction_explanation.trim()
      : "";

  const rawCriteria = input.proposed_acceptance_criteria;

  if (
    rawCriteria !== undefined &&
    rawCriteria !== null &&
    typeof rawCriteria !== "string"
  ) {
    return fail("Invalid acceptance criteria", 400);
  }

  const criteria =
    typeof rawCriteria === "string"
      ? rawCriteria.trim() || null
      : null;

  if (!validId(commentId)) {
    return fail("Invalid review comment ID", 400);
  }

  if (title.length < 1 || title.length > 255) {
    return fail("Title must contain 1-255 characters", 400);
  }

  if (!description || description.length > 20000) {
    return fail("Description must contain 1-20000 characters", 400);
  }

  if (criteria && criteria.length > 20000) {
    return fail("Acceptance criteria exceed 20000 characters", 400);
  }

  if (explanation.length < 10 || explanation.length > 10000) {
    return fail(
      "Correction explanation must contain 10-10000 characters",
      400
    );
  }

  const correction: CorrectionInput = {
    comment_id: commentId,
    proposed_title: title,
    proposed_description: description,
    proposed_acceptance_criteria: criteria,
    correction_explanation: explanation,
  };

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirement = await client.query(
      `SELECT fr.id, fr.status, rl.lifecycle_status
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
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

    if (
      requirement.rows[0].status !== "UNDER_REVIEW" ||
      requirement.rows[0].lifecycle_status !== "UNDER_REVIEW"
    ) {
      await client.query("ROLLBACK");
      return fail("Requirement is not under review", 409);
    }

    const assignment = await client.query(
      `SELECT id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND user_id = $2
         AND role_code = 'DEVELOPER'
         AND revoked_at IS NULL`,
      [requirementId, user.id]
    );

    if (!assignment.rows[0]) {
      await client.query("ROLLBACK");
      return fail(
        "Only an assigned Developer can prepare corrections",
        403
      );
    }

    const comment = await client.query(
      `SELECT id, resolution_status
       FROM requirement_review_comments
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [correction.comment_id, requirementId]
    );

    if (!comment.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Review comment not found", 404);
    }

    if (comment.rows[0].resolution_status === "RESOLVED") {
      await client.query("ROLLBACK");
      return fail("Cannot correct an already resolved comment", 409);
    }

    const created = await client.query(
      `INSERT INTO requirement_corrections (
         requirement_id,
         comment_id,
         developer_id,
         proposed_title,
         proposed_description,
         proposed_acceptance_criteria,
         correction_explanation
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         comment_id::text AS comment_id,
         developer_id::text AS developer_id,
         proposed_title,
         proposed_description,
         proposed_acceptance_criteria,
         correction_explanation,
         status,
         created_at,
         updated_at`,
      [
        requirementId,
        correction.comment_id,
        user.id,
        correction.proposed_title,
        correction.proposed_description,
        correction.proposed_acceptance_criteria,
        correction.correction_explanation,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (
         actor_id,
         action,
         entity_type,
         entity_id,
         new_values
       )
       VALUES (
         $1,
         'REQUIREMENT_CORRECTION_DRAFT_CREATED',
         'requirement_corrections',
         $2,
         $3::jsonb
       )`,
      [
        user.id,
        created.rows[0].id,
        JSON.stringify({
          requirement_id: requirementId,
          comment_id: correction.comment_id,
          developer_id: user.id,
          developer_assignment_id: String(assignment.rows[0].id),
          proposed_title: correction.proposed_title,
          proposed_description: correction.proposed_description,
          proposed_acceptance_criteria:
            correction.proposed_acceptance_criteria,
          correction_explanation: correction.correction_explanation,
          status: "DRAFT",
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        message: "Correction draft created successfully",
        data: created.rows[0],
        meta: null,
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to create correction draft:", error);
    return fail("Unable to create correction draft", 500);
  } finally {
    client.release();
  }
}