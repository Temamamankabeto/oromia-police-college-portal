import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string; activityId: string }>;
};

const fields = `
  id::text AS id,
  module_id::text AS module_id,
  activity_id::text AS activity_id,
  requirement_code,
  title,
  description,
  acceptance_criteria,
  priority,
  status,
  display_order,
  is_active
`;

function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://127.0.0.1:3000" ||
        origin === "http://localhost:3000"));
}

function databaseError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? error.code : null;

  if (code === "23514") return fail("Proposal locked or invalid activity", 409);
  if (code === "23505") return fail("Requirement code already exists", 409);
  if (code === "23503") return fail("Module or activity not found", 404);

  console.error("Functional requirement operation failed:", error);
  return fail("Unable to process functional requirement", 500);
}

export async function GET(
  _request: NextRequest,
  context: Context
) {
  try {
    if (!(await getCurrentUser())) {
      return fail("Authentication required", 401);
    }

    const { moduleId, activityId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId) ||
        !/^[1-9]\d*$/.test(activityId)) {
      return fail("Invalid module or activity ID", 400);
    }

    const result = await query(`
      SELECT ${fields}
      FROM activity_functional_requirements
      WHERE module_id = $1
        AND activity_id = $2
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM institutional_modules
          WHERE id = $1 AND deleted_at IS NULL
        )
        AND EXISTS (
          SELECT 1 FROM module_activities
          WHERE id = $2 AND module_id = $1 AND deleted_at IS NULL
        )
      ORDER BY display_order, id
    `, [moduleId, activityId]);

    return NextResponse.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  try {
    const user = await requireRole(["ADMIN"]);
    if (!user) {
      return fail("Administrator access required", 403);
    }

    if (!validOrigin(request)) {
      return fail("Invalid request origin", 403);
    }

    const { moduleId, activityId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId) ||
        !/^[1-9]\d*$/.test(activityId)) {
      return fail("Invalid module or activity ID", 400);
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
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
    const allowed = [
      "requirement_code", "title", "description",
      "acceptance_criteria", "priority", "status",
      "display_order", "is_active"
    ];

    if (Object.keys(input).some(k => !allowed.includes(k))) {
      return fail("Invalid fields", 400);
    }

    const code = typeof input.requirement_code === "string"
      ? input.requirement_code.trim().toUpperCase() : "";

    const title = typeof input.title === "string"
      ? input.title.trim() : "";

    const description = typeof input.description === "string"
      ? input.description.trim() : "";

    const criteria = input.acceptance_criteria == null
      ? null
      : typeof input.acceptance_criteria === "string"
        ? input.acceptance_criteria.trim()
        : undefined;

    const priority = input.priority ?? "MEDIUM";
    const status = input.status ?? "DRAFT";
    const order = input.display_order ?? 0;
    const active = input.is_active ?? true;

    if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
      return fail("Invalid requirement code", 400);
    }

    if (!title || title.length > 255) {
      return fail("Title must be 1–255 characters", 400);
    }

    if (!description || description.length > 10000) {
      return fail("Description must be 1–10000 characters", 400);
    }

    if (criteria === undefined ||
        (criteria !== null && criteria.length > 10000)) {
      return fail("Invalid acceptance criteria", 400);
    }

    if (!["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(priority))) {
      return fail("Invalid priority", 400);
    }

    if (status !== "DRAFT") {
      return fail("New requirements must start as DRAFT", 400);
    }

    if (typeof order !== "number" ||
        !Number.isSafeInteger(order) ||
        order < 0 || order > 100000) {
      return fail("Invalid display order", 400);
    }

    if (typeof active !== "boolean") {
      return fail("Invalid active status", 400);
    }

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(`
        INSERT INTO activity_functional_requirements
          (module_id, activity_id, requirement_code,
           title, description, acceptance_criteria,
           priority, status, display_order, is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING ${fields}
      `, [
        moduleId, activityId, code, title, description,
        criteria, priority, status, order, active
      ]);

      const requirement = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
          (actor_id, action, entity_type, entity_id, new_values)
         VALUES
          ($1, 'FUNCTIONAL_REQUIREMENT_CREATED',
           'activity_functional_requirements', $2, $3::jsonb)`,
        [
          user.id,
          requirement.id,
          JSON.stringify(requirement)
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json(
        { success: true, data: requirement },
        { status: 201 }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return databaseError(error);
  }
}
