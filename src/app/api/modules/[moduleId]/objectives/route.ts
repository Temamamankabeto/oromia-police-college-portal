import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
};

const fields = `
  id::text AS id,
  module_id::text AS module_id,
  objective_code,
  title,
  description,
  display_order,
  is_active
`;

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, error: message },
    { status }
  );
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      origin === "http://127.0.0.1:3000");
}

function dbError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? error.code : null;

  if (code === "23514") return fail("Proposal is locked or invalid", 409);
  if (code === "23505") return fail("Objective code already exists", 409);
  if (code === "23503") return fail("Parent module not found", 404);

  console.error("Objective operation failed:", error);
  return fail("Unable to process objective", 500);
}

export async function GET(
  _request: NextRequest,
  context: Context
) {
  try {
    if (!(await getCurrentUser())) {
      return fail("Authentication required", 401);
    }

    const { moduleId } = await context.params;
    if (!/^[1-9]\d*$/.test(moduleId)) {
      return fail("Invalid module ID", 400);
    }

    const result = await query(`
      SELECT ${fields}
      FROM module_objectives
      WHERE module_id = $1
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM institutional_modules
          WHERE id = $1 AND deleted_at IS NULL
        )
      ORDER BY display_order, id
    `, [moduleId]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    return dbError(error);
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

    if (!validOrigin(request)) return fail("Invalid origin", 403);

    const { moduleId } = await context.params;
    if (!/^[1-9]\d*$/.test(moduleId)) {
      return fail("Invalid module ID", 400);
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
      return fail("Invalid body", 400);
    }

    const input = body as Record<string, unknown>;
    const allowed = [
      "objective_code", "title", "description",
      "display_order", "is_active"
    ];

    if (Object.keys(input).some(k => !allowed.includes(k))) {
      return fail("Invalid fields", 400);
    }

    const title = typeof input.title === "string"
      ? input.title.trim() : "";

    const code = input.objective_code == null || input.objective_code === ""
      ? null
      : typeof input.objective_code === "string"
        ? input.objective_code.trim().toUpperCase()
        : "";

    const description = input.description == null
      ? null
      : typeof input.description === "string"
        ? input.description.trim()
        : undefined;

    const order = input.display_order ?? 0;
    const active = input.is_active ?? true;

    if (!title || title.length > 255) {
      return fail("Title must be 1–255 characters", 400);
    }

    if (code !== null && !/^[A-Z0-9_-]{1,40}$/.test(code)) {
      return fail("Invalid objective code", 400);
    }

    if (description === undefined ||
        (description !== null && description.length > 10000)) {
      return fail("Invalid description", 400);
    }

    if (typeof order !== "number" ||
        !Number.isSafeInteger(order) || order < 0 || order > 100000) {
      return fail("Invalid display order", 400);
    }

    if (typeof active !== "boolean") {
      return fail("Invalid active status", 400);
    }

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(`
        INSERT INTO module_objectives
          (module_id, objective_code, title, description,
           display_order, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${fields}
      `, [moduleId, code, title, description, order, active]);

      const objective = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (actor_id, action, entity_type, entity_id, new_values)
         VALUES
           ($1, 'OBJECTIVE_CREATED', 'module_objectives',
            $2, $3::jsonb)`,
        [
          user.id,
          objective.id,
          JSON.stringify(objective)
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json(
        { success: true, data: objective },
        { status: 201 }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return dbError(error);
  }
}
