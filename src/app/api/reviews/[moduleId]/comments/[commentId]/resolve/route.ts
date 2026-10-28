import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    moduleId: string;
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

const transitions: Record<Status, Status[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED", "REOPENED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "RESOLVED"],
};

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  return (
    origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      origin === "http://127.0.0.1:3000")
  );
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  const user = await requireRole(["ADMIN", "REVIEWER"]);

  if (!user) {
    return fail("Reviewer access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { moduleId, commentId } = await context.params;

  if (
    !/^[1-9]\d*$/.test(moduleId) ||
    !/^[1-9]\d*$/.test(commentId)
  ) {
    return fail("Invalid module or comment ID", 400);
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
      key => key !== "resolution_status"
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

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const moduleResult = await client.query(
      `SELECT id
       FROM institutional_modules
       WHERE id = $1
         AND deleted_at IS NULL
         AND is_active = TRUE
       FOR UPDATE`,
      [moduleId]
    );

    if (!moduleResult.rows.length) {
      await client.query("ROLLBACK");
      return fail("Active module not found", 404);
    }

    const review = await client.query(
      `SELECT approval_status
       FROM module_reviews
       WHERE module_id = $1
       FOR UPDATE`,
      [moduleId]
    );

    if (
      review.rows[0]?.approval_status !== "UNDER_REVIEW"
    ) {
      await client.query("ROLLBACK");
      return fail("Proposal is not under review", 409);
    }

    const comment = await client.query(
      `SELECT id, resolution_status
       FROM module_comments
       WHERE id = $1
         AND module_id = $2
       FOR UPDATE`,
      [commentId, moduleId]
    );

    if (!comment.rows.length) {
      await client.query("ROLLBACK");
      return fail("Comment not found", 404);
    }

    const oldStatus =
      comment.rows[0].resolution_status as Status;

    if (
      !transitions[oldStatus]?.includes(
        nextStatus as Status
      )
    ) {
      await client.query("ROLLBACK");
      return fail(
        `Cannot change comment from ${oldStatus} to ${nextStatus}`,
        409
      );
    }

    const result = await client.query(
      `UPDATE module_comments
       SET
         resolution_status = $1::varchar(30),
         resolved_by = CASE
           WHEN $1::varchar(30) = 'RESOLVED' THEN $2::bigint
           ELSE NULL
         END,
         resolved_at = CASE
           WHEN $1::varchar(30) = 'RESOLVED' THEN NOW()
           ELSE NULL
         END,
         updated_at = NOW()
       WHERE id = $3
         AND module_id = $4
       RETURNING
         id::text AS id,
         module_id::text AS module_id,
         resolution_status,
         resolved_by::text AS resolved_by,
         resolved_at,
         updated_at`,
      [nextStatus, user.id, commentId, moduleId]
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
           'REVIEW_COMMENT_STATUS_CHANGED',
           'module_comments',
           $2,
           $3::jsonb,
           $4::jsonb
         )`,
      [
        user.id,
        commentId,
        JSON.stringify({
          resolution_status: oldStatus,
        }),
        JSON.stringify({
          resolution_status: nextStatus,
          module_id: moduleId,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to resolve review comment:", error);

    return fail("Unable to update comment status", 500);
  } finally {
    client.release();
  }
}
