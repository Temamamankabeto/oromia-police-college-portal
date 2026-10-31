import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ requirementId: string }>;
};

type Decision = "APPROVED" | "RETURNED";

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

  if (user.role_code !== "APPROVER") {
    return fail("Approver access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { requirementId } = await context.params;

  if (!/^[1-9]\d*$/.test(requirementId)) {
    return fail("Invalid requirement ID", 400);
  }

  if (
    !request.headers
      .get("content-type")
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body", 400);
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).some(
      (key) => !["decision", "remarks"].includes(key)
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  if (
    input.decision !== "APPROVED" &&
    input.decision !== "RETURNED"
  ) {
    return fail("Invalid approval decision", 400);
  }

  if (
    input.remarks !== undefined &&
    typeof input.remarks !== "string"
  ) {
    return fail("Invalid remarks", 400);
  }

  const decision: Decision = input.decision;
  const remarks =
    typeof input.remarks === "string"
      ? input.remarks.trim()
      : "";

  if (remarks.length > 5000) {
    return fail("Remarks must not exceed 5000 characters", 400);
  }

  if (decision === "RETURNED" && remarks.length < 10) {
    return fail(
      "Returning a requirement requires at least 10 characters of remarks",
      400
    );
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirementResult = await client.query(
      `SELECT
         fr.id,
         fr.requirement_code,
         fr.status,
         fr.title
       FROM activity_functional_requirements fr
       JOIN institutional_modules m
         ON m.id = fr.module_id
       JOIN projects p
         ON p.id = m.project_id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       FOR UPDATE OF fr`,
      [requirementId]
    );

    const requirement = requirementResult.rows[0];

    if (!requirement) {
      await client.query("ROLLBACK");
      return fail("Active requirement not found", 404);
    }

    const assignmentResult = await client.query(
      `SELECT ra.id
       FROM requirement_assignments ra
       WHERE ra.requirement_id = $1
         AND ra.user_id = $2
         AND ra.role_code = 'APPROVER'
         AND ra.revoked_at IS NULL`,
      [requirementId, user.id]
    );

    const assignment = assignmentResult.rows[0];

    if (!assignment) {
      await client.query("ROLLBACK");
      return fail(
        "Only the assigned Approver can decide this requirement",
        403
      );
    }

    const lifecycleResult = await client.query(
      `SELECT lifecycle_status
       FROM requirement_lifecycle
       WHERE requirement_id = $1
       FOR UPDATE`,
      [requirementId]
    );

    const currentStatus =
      lifecycleResult.rows[0]?.lifecycle_status;

    if (currentStatus !== "REVIEWED") {
      await client.query("ROLLBACK");
      return fail(
        "Only reviewed requirements can receive approval decisions",
        409
      );
    }

    if (requirement.status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");
      return fail(
        "Requirement approval status does not permit this decision",
        409
      );
    }

    const unresolvedResult = await client.query<{
      total: number;
    }>(
      `SELECT COUNT(*)::integer AS total
       FROM requirement_review_comments
       WHERE requirement_id = $1
         AND resolution_status <> 'RESOLVED'`,
      [requirementId]
    );

    if ((unresolvedResult.rows[0]?.total ?? 0) > 0) {
      await client.query("ROLLBACK");
      return fail(
        "Unresolved review comments prevent an approval decision",
        409
      );
    }

    const outstandingResult = await client.query<{
      total: number;
    }>(
      `SELECT COUNT(*)::integer AS total
       FROM requirement_corrections c
       LEFT JOIN requirement_version_corrections vc
         ON vc.correction_id = c.id
       WHERE c.requirement_id = $1
         AND (
           c.status IN ('DRAFT', 'SUBMITTED')
           OR (c.status = 'ACCEPTED' AND vc.id IS NULL)
         )`,
      [requirementId]
    );

    if ((outstandingResult.rows[0]?.total ?? 0) > 0) {
      await client.query("ROLLBACK");
      return fail(
        "Pending or unapplied accepted corrections prevent approval",
        409
      );
    }

    const nextLifecycle =
      decision === "APPROVED"
        ? "APPROVED"
        : "UNDER_REVIEW";

    const nextRequirementStatus =
      decision === "APPROVED"
        ? "APPROVED"
        : "UNDER_REVIEW";

    const lifecycleUpdate = await client.query(
      `UPDATE requirement_lifecycle
       SET lifecycle_status = $2,
           updated_by = $3,
           updated_at = NOW()
       WHERE requirement_id = $1
         AND lifecycle_status = 'REVIEWED'
       RETURNING
         requirement_id::text AS requirement_id,
         lifecycle_status,
         updated_by::text AS updated_by,
         updated_at`,
      [requirementId, nextLifecycle, user.id]
    );

    if (!lifecycleUpdate.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Requirement lifecycle changed concurrently", 409);
    }

    await client.query(
      `UPDATE activity_functional_requirements
       SET status = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [requirementId, nextRequirementStatus]
    );

    const eventResult = await client.query(
      `INSERT INTO requirement_workflow_events
         (
           requirement_id,
           from_status,
           to_status,
           actor_id,
           remarks,
           metadata
         )
       VALUES
         ($1, 'REVIEWED', $2, $3, $4, $5::jsonb)
       RETURNING id::text AS id, created_at`,
      [
        requirementId,
        nextLifecycle,
        user.id,
        remarks || null,
        JSON.stringify({
          decision,
          assignment_id: String(assignment.id),
          requirement_code: requirement.requirement_code,
        }),
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
         (
           actor_id,
           action,
           entity_type,
           entity_id,
           old_values,
           new_values
         )
       VALUES
         (
           $1,
           $2,
           'activity_functional_requirements',
           $3,
           $4::jsonb,
           $5::jsonb
         )`,
      [
        user.id,
        decision === "APPROVED"
          ? "REQUIREMENT_APPROVED"
          : "REQUIREMENT_RETURNED_FOR_REVIEW",
        requirementId,
        JSON.stringify({
          status: requirement.status,
          lifecycle_status: "REVIEWED",
        }),
        JSON.stringify({
          status: nextRequirementStatus,
          lifecycle_status: nextLifecycle,
          decision,
          remarks,
          workflow_event_id: eventResult.rows[0].id,
          approver_id: user.id,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message:
        decision === "APPROVED"
          ? "Functional requirement approved successfully"
          : "Functional requirement returned for review",
      data: {
        ...lifecycleUpdate.rows[0],
        requirement_status: nextRequirementStatus,
        decision,
        remarks,
        workflow_event_id: eventResult.rows[0].id,
      },
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Requirement approval decision failed:", error);

    return fail("Unable to process requirement approval", 500);
  } finally {
    client.release();
  }
}