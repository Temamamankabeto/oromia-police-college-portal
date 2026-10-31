import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    requirementId: string;
    commentId: string;
  }>;
};

const statuses = [
  "OPEN",
  "IN_PROGRESS",
  "RESOLVED",
  "REOPENED",
] as const;

type Status = (typeof statuses)[number];

const transitions: Record<Status, readonly Status[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED", "REOPENED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "RESOLVED"],
};

function fail(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      message,
      data: null,
      meta: null,
    },
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

  const { requirementId, commentId } = await context.params;

  if (
    !/^[1-9]\d*$/.test(requirementId) ||
    !/^[1-9]\d*$/.test(commentId)
  ) {
    return fail("Invalid requirement or comment ID", 400);
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
      (key) =>
        !["resolution_status", "resolution_remark"].includes(key)
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  const nextStatus = input.resolution_status;

  if (
    typeof nextStatus !== "string" ||
    !statuses.includes(nextStatus as Status)
  ) {
    return fail("Invalid resolution status", 400);
  }

  const remark =
    typeof input.resolution_remark === "string"
      ? input.resolution_remark.trim()
      : "";

  if (remark.length < 10 || remark.length > 2000) {
    return fail(
      "Resolution remark must contain 10-2000 characters",
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
        "Only the assigned Lead Reviewer can resolve comments",
        403
      );
    }

    if (
      requirement.rows[0].lifecycle_status !== "UNDER_REVIEW" ||
      requirement.rows[0].status !== "UNDER_REVIEW"
    ) {
      await client.query("ROLLBACK");
      return fail("Requirement is not under review", 409);
    }

    const comment = await client.query(
      `SELECT id, resolution_status, resolved_by, resolved_at
       FROM requirement_review_comments
       WHERE id = $1
         AND requirement_id = $2
       FOR UPDATE`,
      [commentId, requirementId]
    );

    if (!comment.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Review comment not found", 404);
    }

    const oldStatus = comment.rows[0].resolution_status as Status;

    if (
      !transitions[oldStatus]?.includes(nextStatus as Status)
    ) {
      await client.query("ROLLBACK");
      return fail(
        `Cannot change comment from ${oldStatus} to ${nextStatus}`,
        409
      );
    }

    if (nextStatus === "RESOLVED") {
      const evidence = await client.query<{ accepted: number; applied: number; pending: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE c.status = 'ACCEPTED')::integer AS accepted,
           COUNT(*) FILTER (WHERE c.status = 'ACCEPTED' AND vc.id IS NOT NULL)::integer AS applied,
           COUNT(*) FILTER (WHERE c.status IN ('DRAFT', 'SUBMITTED'))::integer AS pending
         FROM requirement_corrections c
         LEFT JOIN requirement_version_corrections vc ON vc.correction_id = c.id
         WHERE c.requirement_id = $1 AND c.comment_id = $2`,
        [requirementId, commentId]
      );
      const { accepted, applied, pending } = evidence.rows[0];
      if (pending > 0 || accepted === 0 || applied !== accepted) {
        await client.query("ROLLBACK");
        return fail("An accepted and applied correction is required before resolving this comment", 409);
      }
    }

    const updated = await client.query(
      `UPDATE requirement_review_comments
       SET resolution_status = $1::varchar(30),
           resolved_by = CASE
             WHEN $1::varchar(30) = 'RESOLVED'
               THEN $2::bigint
             ELSE NULL
           END,
           resolved_at = CASE
             WHEN $1::varchar(30) = 'RESOLVED'
               THEN NOW()
             ELSE NULL
           END,
           updated_at = NOW()
       WHERE id = $3
         AND requirement_id = $4
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         resolution_status,
         resolved_by::text AS resolved_by,
         resolved_at,
         updated_at`,
      [nextStatus, user.id, commentId, requirementId]
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
           'REQUIREMENT_REVIEW_COMMENT_STATUS_CHANGED',
           'requirement_review_comments',
           $2,
           $3::jsonb,
           $4::jsonb
         )`,
      [
        user.id,
        commentId,
        JSON.stringify({
          requirement_id: requirementId,
          resolution_status: oldStatus,
          resolved_by: comment.rows[0].resolved_by,
          resolved_at: comment.rows[0].resolved_at,
        }),
        JSON.stringify({
          requirement_id: requirementId,
          resolution_status: nextStatus,
          resolved_by: updated.rows[0].resolved_by,
          resolved_at: updated.rows[0].resolved_at,
          resolution_remark: remark,
          lead_reviewer_assignment_id: String(assignment.rows[0].id),
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Review comment status updated successfully",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error(
      "Failed to update requirement review comment:",
      error
    );

    return fail("Unable to update review comment status", 500);
  } finally {
    client.release();
  }
}
