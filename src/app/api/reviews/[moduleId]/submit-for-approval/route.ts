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
      `SELECT id, approval_status, current_revision
       FROM module_reviews
       WHERE module_id = $1
       FOR UPDATE`,
      [moduleId]
    );

    const review = reviewResult.rows[0];

    if (!review || review.approval_status !== "UNDER_REVIEW") {
      await client.query("ROLLBACK");

      return fail(
        "Only proposals under review can be submitted for approval",
        409
      );
    }

    const unresolvedResult = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM module_comments
       WHERE module_id = $1
         AND resolution_status <> 'RESOLVED'`,
      [moduleId]
    );

    const unresolved = unresolvedResult.rows[0].total;

    if (unresolved > 0) {
      await client.query("ROLLBACK");

      return fail(
        `${unresolved} unresolved review comment(s) remain`,
        409
      );
    }

    const updated = await client.query(
      `UPDATE module_reviews
       SET
         approval_status = 'READY_FOR_APPROVAL',
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
           'REVIEW_SUBMITTED_FOR_APPROVAL',
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
          approval_status: "READY_FOR_APPROVAL",
          current_revision: review.current_revision,
          unresolved_comments: 0,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Proposal submitted for approval",
      data: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Failed to submit proposal for approval:", error);

    return fail("Unable to submit proposal for approval", 500);
  } finally {
    client.release();
  }
}
