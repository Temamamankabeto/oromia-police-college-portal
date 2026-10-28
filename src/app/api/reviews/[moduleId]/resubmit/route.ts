import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

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

export async function POST(
  request: NextRequest,
  context: Context
) {
  const user = await requireRole(["ADMIN"]);

  if (!user) {
    return fail("Administrator access required", 403);
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
      key => key !== "change_summary"
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  const summary =
    typeof input.change_summary === "string"
      ? input.change_summary.trim()
      : "";

  if (!summary || summary.length > 5000) {
    return fail(
      "Change summary must contain 1–5000 characters",
      400
    );
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const moduleResult = await client.query(
      `SELECT id, title, description
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

    const reviewResult = await client.query(
      `SELECT id, approval_status, current_revision
       FROM module_reviews
       WHERE module_id = $1
       FOR UPDATE`,
      [moduleId]
    );

    const review = reviewResult.rows[0];

    if (
      !review ||
      review.approval_status !== "REVISION_REQUESTED"
    ) {
      await client.query("ROLLBACK");

      return fail(
        "Only proposals awaiting revision can be resubmitted",
        409
      );
    }

    const activitiesResult = await client.query(
      `SELECT
         id::text AS id,
         activity_code,
         title,
         description,
         display_order,
         is_active
       FROM module_activities
       WHERE module_id = $1
         AND deleted_at IS NULL
       ORDER BY display_order, id`,
      [moduleId]
    );

    const nextRevision = review.current_revision + 1;
    const moduleData = moduleResult.rows[0];

    const revisionResult = await client.query(
      `INSERT INTO module_revisions
         (
           module_id,
           revision_number,
           title,
           description,
           activities_snapshot,
           change_summary,
           edited_by
         )
       VALUES
         ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING
         id::text AS id,
         module_id::text AS module_id,
         revision_number,
         title,
         description,
         activities_snapshot,
         change_summary,
         edited_by::text AS edited_by,
         created_at`,
      [
        moduleId,
        nextRevision,
        moduleData.title,
        moduleData.description,
        JSON.stringify(activitiesResult.rows),
        summary,
        user.id,
      ]
    );

    const updatedReview = await client.query(
      `UPDATE module_reviews
       SET
         approval_status = 'UNDER_REVIEW',
         current_revision = $2,
         updated_at = NOW()
       WHERE module_id = $1
       RETURNING
         module_id::text AS module_id,
         approval_status,
         current_revision`,
      [moduleId, nextRevision]
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
           'PROPOSAL_RESUBMITTED',
           'module_reviews',
           $2,
           $3::jsonb,
           $4::jsonb
         )`,
      [
        user.id,
        review.id,
        JSON.stringify({
          approval_status: "REVISION_REQUESTED",
          current_revision: review.current_revision,
        }),
        JSON.stringify({
          approval_status: "UNDER_REVIEW",
          current_revision: nextRevision,
          revision_id: revisionResult.rows[0].id,
          change_summary: summary,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Proposal resubmitted for review",
      data: {
        review: updatedReview.rows[0],
        revision: revisionResult.rows[0],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Failed to resubmit proposal:", error);

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      return fail("Revision already exists", 409);
    }

    return fail("Unable to resubmit proposal", 500);
  } finally {
    client.release();
  }
}
