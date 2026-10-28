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
  const user = await requireRole(["ADMIN", "REVIEWER"]);

  if (!user) {
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
      key => key !== "remarks"
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  const remarks =
    typeof input.remarks === "string"
      ? input.remarks.trim()
      : "";

  if (!remarks || remarks.length > 5000) {
    return fail(
      "Revision remarks must contain 1–5000 characters",
      400
    );
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

    const reviewResult = await client.query(
      `SELECT
         id,
         approval_status,
         current_revision
       FROM module_reviews
       WHERE module_id = $1
       FOR UPDATE`,
      [moduleId]
    );

    const review = reviewResult.rows[0];

    if (!review || review.approval_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");

      return fail(
        "Revision can only be requested during review",
        409
      );
    }

    const decision = await client.query(
      `INSERT INTO module_decisions
         (
           module_id,
           decision,
           decision_by,
           remarks,
           revision_number
         )
       VALUES
         ($1, 'REVISION_REQUESTED', $2, $3, $4)
       RETURNING
         id::text AS id,
         module_id::text AS module_id,
         decision,
         decision_by::text AS decision_by,
         remarks,
         revision_number,
         created_at`,
      [
        moduleId,
        user.id,
        remarks,
        review.current_revision,
      ]
    );

    const updated = await client.query(
      `UPDATE module_reviews
       SET
         approval_status = 'REVISION_REQUESTED',
         updated_at = NOW()
       WHERE module_id = $1
       RETURNING
         module_id::text AS module_id,
         approval_status,
         current_revision`,
      [moduleId]
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
           'REVIEW_REVISION_REQUESTED',
           'module_reviews',
           $2,
           $3::jsonb,
           $4::jsonb
         )`,
      [
        user.id,
        review.id,
        JSON.stringify({
          approval_status: "UNDER_REVIEW",
          current_revision: review.current_revision,
        }),
        JSON.stringify({
          approval_status: "REVISION_REQUESTED",
          current_revision: review.current_revision,
          decision_id: decision.rows[0].id,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Proposal revision requested",
      data: {
        review: updated.rows[0],
        decision: decision.rows[0],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to request proposal revision:", error);

    return fail("Unable to request proposal revision", 500);
  } finally {
    client.release();
  }
}
