import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
};

const decisions = [
  "APPROVED",
  "REVISION_REQUESTED",
  "REJECTED",
] as const;

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  const user = await requireRole(["ADMIN", "APPROVER"]);

  if (!user) {
    return fail("Approver access required", 403);
  }

  const origin = request.headers.get("origin");

  if (
    origin !== "https://opc.osdavc.com" &&
    !(
      process.env.NODE_ENV === "development" &&
      origin === "http://127.0.0.1:3000"
    )
  ) {
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
      key => !["decision", "remarks"].includes(key)
    )
  ) {
    return fail("Unexpected fields", 400);
  }

  const decision = input.decision;

  if (
    typeof decision !== "string" ||
    !decisions.some(value => value === decision)
  ) {
    return fail("Invalid approval decision", 400);
  }

  if (
    input.remarks !== undefined &&
    typeof input.remarks !== "string"
  ) {
    return fail("Invalid remarks", 400);
  }

  const remarks =
    typeof input.remarks === "string"
      ? input.remarks.trim()
      : "";

  if (remarks.length > 5000) {
    return fail("Remarks must not exceed 5000 characters", 400);
  }

  if (
    decision !== "APPROVED" &&
    !remarks
  ) {
    return fail(
      "Remarks are required for revision or rejection",
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
      return fail("Active proposal not found", 404);
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
      review.approval_status !== "READY_FOR_APPROVAL"
    ) {
      await client.query("ROLLBACK");
      return fail(
        "Proposal is not awaiting approval",
        409
      );
    }

    const unresolved = await client.query(
      `SELECT COUNT(*)::integer AS total
       FROM module_comments
       WHERE module_id = $1
         AND resolution_status <> 'RESOLVED'`,
      [moduleId]
    );

    if (unresolved.rows[0].total > 0) {
      await client.query("ROLLBACK");
      return fail(
        "Unresolved comments prevent approval decisions",
        409
      );
    }

    const decisionResult = await client.query(
      `INSERT INTO module_decisions
         (module_id, decision, decision_by, remarks, revision_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id::text AS id,
         decision,
         remarks,
         revision_number,
         created_at`,
      [
        moduleId,
        decision,
        user.id,
        remarks || null,
        review.current_revision,
      ]
    );

    const updated = await client.query(
      `UPDATE module_reviews
       SET
         approval_status = $2::text,
         approved_by = CASE
           WHEN $2::text = 'APPROVED' THEN $3::bigint
           ELSE NULL
         END,
         approved_at = CASE
           WHEN $2::text = 'APPROVED' THEN NOW()
           ELSE NULL
         END,
         updated_at = NOW()
       WHERE module_id = $1
       RETURNING
         module_id::text AS module_id,
         approval_status,
         current_revision,
         approved_by::text AS approved_by,
         approved_at`,
      [moduleId, decision, user.id]
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
         ($1, $2, 'module_reviews', $3, $4::jsonb, $5::jsonb)`,
      [
        user.id,
        `APPROVAL_${decision}`,
        review.id,
        JSON.stringify({
          approval_status: "READY_FOR_APPROVAL",
          current_revision: review.current_revision,
        }),
        JSON.stringify({
          approval_status: decision,
          current_revision: review.current_revision,
          decision_id: decisionResult.rows[0].id,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: `Proposal ${decision.toLowerCase().replaceAll("_", " ")}`,
      data: {
        review: updated.rows[0],
        decision: decisionResult.rows[0],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Approval decision failed:", error);
    return fail("Unable to save approval decision", 500);
  } finally {
    client.release();
  }
}
