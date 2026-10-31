import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ requirementId: string }>;
};

type CommentType =
  | "COMMENT"
  | "FINDING"
  | "RECOMMENDATION"
  | "CHANGE_REQUEST";

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
         c.author_id::text AS author_id,
         u.full_name AS author_name,
         c.comment_type,
         c.comment_text,
         c.resolution_status,
         c.resolved_by::text AS resolved_by,
         c.resolved_at,
         c.created_at,
         c.updated_at
       FROM requirement_review_comments c
       JOIN app_users u ON u.id = c.author_id
       WHERE c.requirement_id = $1
       ORDER BY c.created_at ASC, c.id ASC`,
      [requirementId]
    );

    return NextResponse.json({
      success: true,
      message: "Requirement review comments loaded successfully",
      data: result.rows,
      meta: { total: result.rowCount },
    });
  } catch (error) {
    console.error("Failed to load requirement comments:", error);
    return fail("Unable to load requirement comments", 500);
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

  if (user.role_code !== "REVIEWER") {
    return fail("Reviewer access required", 403);
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body", 400);
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).some(
      key => !["comment_type", "comment_text"].includes(key)
    )
  ) {
    return fail("Unexpected comment fields", 400);
  }

  const commentText =
    typeof input.comment_text === "string"
      ? input.comment_text.trim()
      : "";

  const commentType = input.comment_type ?? "COMMENT";

  const validTypes: CommentType[] = [
    "COMMENT",
    "FINDING",
    "RECOMMENDATION",
    "CHANGE_REQUEST",
  ];

  if (!commentText || commentText.length > 10000) {
    return fail("Comment must contain 1-10000 characters", 400);
  }

  if (!validTypes.includes(commentType as CommentType)) {
    return fail("Invalid comment type", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirement = await client.query(
      `SELECT fr.id, rl.lifecycle_status
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

    const assignment = await client.query(
      `SELECT id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND user_id = $2
         AND role_code = 'REVIEWER'
         AND revoked_at IS NULL`,
      [requirementId, user.id]
    );

    if (!assignment.rows[0]) {
      await client.query("ROLLBACK");
      return fail("You are not assigned to this requirement", 403);
    }

    if (requirement.rows[0].lifecycle_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");
      return fail("Requirement is not under review", 409);
    }

    const created = await client.query(
      `INSERT INTO requirement_review_comments
         (requirement_id, author_id, comment_type, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         author_id::text AS author_id,
         comment_type,
         comment_text,
         resolution_status,
         created_at`,
      [requirementId, user.id, commentType, commentText]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, new_values)
       VALUES
         ($1, 'REQUIREMENT_REVIEW_COMMENT_ADDED',
          'requirement_review_comments', $2, $3::jsonb)`,
      [
        user.id,
        created.rows[0].id,
        JSON.stringify({
          requirement_id: requirementId,
          comment_type: commentType,
          comment_text: commentText,
          resolution_status: "OPEN",
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        message: "Requirement review comment added successfully",
        data: created.rows[0],
        meta: null,
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to create requirement comment:", error);
    return fail("Unable to create requirement review comment", 500);
  } finally {
    client.release();
  }
}