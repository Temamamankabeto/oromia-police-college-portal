import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
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

export async function GET(
  _request: NextRequest,
  context: Context
) {
  try {
    const user = await getCurrentUser();

    if (!user) return fail("Unauthorized", 401);

    const { moduleId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId)) {
      return fail("Invalid module ID", 400);
    }

    const moduleResult = await query(
      `SELECT id FROM institutional_modules
       WHERE id = $1 AND deleted_at IS NULL`,
      [moduleId]
    );

    if (!moduleResult.rows.length) {
      return fail("Module not found", 404);
    }

    const result = await query(
      `SELECT
         c.id::text AS id,
         c.module_id::text AS module_id,
         c.activity_id::text AS activity_id,
         c.parent_comment_id::text AS parent_comment_id,
         c.author_id::text AS author_id,
         u.full_name AS author_name,
         c.comment_text,
         c.resolution_status,
         c.resolved_by::text AS resolved_by,
         c.resolved_at,
         c.created_at,
         c.updated_at
       FROM module_comments c
       INNER JOIN app_users u ON u.id = c.author_id
       WHERE c.module_id = $1
       ORDER BY c.created_at ASC, c.id ASC`,
      [moduleId]
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load review comments:", error);
    return fail("Unable to load review comments", 500);
  }
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  const user = await getCurrentUser();

  if (!user || !["ADMIN", "REVIEWER"].includes(user.role_code)) {
    return fail("Reviewer access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { moduleId } = await context.params;

  if (!/^[1-9]\d*$/.test(moduleId)) {
    return fail("Invalid module ID", 400);
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

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body", 400);
  }

  const input = body as Record<string, unknown>;

  if (
    Object.keys(input).some(
      key => !["comment_text", "activity_id"].includes(key)
    )
  ) {
    return fail("Unexpected comment fields", 400);
  }

  const commentText =
    typeof input.comment_text === "string"
      ? input.comment_text.trim()
      : "";

  const activityId =
    input.activity_id === null ||
    input.activity_id === undefined ||
    input.activity_id === ""
      ? null
      : input.activity_id;

  if (!commentText || commentText.length > 10000) {
    return fail("Comment must contain 1–10000 characters", 400);
  }

  if (
    activityId !== null &&
    (typeof activityId !== "string" ||
      !/^[1-9]\d*$/.test(activityId))
  ) {
    return fail("Invalid activity ID", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const moduleResult = await client.query(
      `SELECT id FROM institutional_modules
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
      `SELECT approval_status FROM module_reviews
       WHERE module_id = $1 FOR UPDATE`,
      [moduleId]
    );

    if (review.rows[0]?.approval_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");
      return fail("Proposal is not under review", 409);
    }

    if (activityId !== null) {
      const activity = await client.query(
        `SELECT id FROM module_activities
         WHERE id = $1
           AND module_id = $2
           AND deleted_at IS NULL`,
        [activityId, moduleId]
      );

      if (!activity.rows.length) {
        await client.query("ROLLBACK");
        return fail("Activity does not belong to this module", 400);
      }
    }

    const result = await client.query(
      `INSERT INTO module_comments
         (module_id, activity_id, author_id, comment_text)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id::text AS id,
         module_id::text AS module_id,
         activity_id::text AS activity_id,
         author_id::text AS author_id,
         comment_text,
         resolution_status,
         created_at`,
      [moduleId, activityId, user.id, commentText]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, new_values)
       VALUES
         ($1, 'REVIEW_COMMENT_ADDED', 'module_comments',
          $2, $3::jsonb)`,
      [
        user.id,
        result.rows[0].id,
        JSON.stringify({
          module_id: moduleId,
          activity_id: activityId,
          resolution_status: "OPEN",
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      { success: true, data: result.rows[0] },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to create review comment:", error);
    return fail("Unable to create review comment", 500);
  } finally {
    client.release();
  }
}
