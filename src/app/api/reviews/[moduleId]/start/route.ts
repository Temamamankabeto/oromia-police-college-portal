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

    const existing = reviewResult.rows[0];

    if (existing && existing.approval_status !== "PENDING") {
      await client.query("ROLLBACK");

      return fail(
        `Review cannot start from ${existing.approval_status}`,
        409
      );
    }

    const updated = await client.query(
      `INSERT INTO module_reviews
         (module_id, approval_status, current_revision)
       VALUES ($1, 'UNDER_REVIEW', 1)
       ON CONFLICT (module_id)
       DO UPDATE SET
         approval_status = 'UNDER_REVIEW',
         updated_at = NOW()
       RETURNING
         id::text AS id,
         module_id::text AS module_id,
         approval_status,
         current_revision`,
      [moduleId]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id,
          old_values, new_values)
       VALUES
         ($1, 'REVIEW_STARTED', 'module_reviews', $2,
          $3::jsonb, $4::jsonb)`,
      [
        user.id,
        updated.rows[0].id,
        JSON.stringify({
          approval_status: existing?.approval_status ?? "PENDING",
        }),
        JSON.stringify({
          approval_status: "UNDER_REVIEW",
          module_id: moduleId,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Review started successfully",
      data: updated.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Failed to start review:", error);

    return fail("Unable to start review", 500);
  } finally {
    client.release();
  }
}
