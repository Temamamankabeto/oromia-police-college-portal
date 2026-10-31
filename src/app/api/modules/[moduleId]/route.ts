import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
};

type ModuleRow = {
  id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

const fields = `
  id::text AS id,
  module_code,
  title,
  description,
  display_order,
  is_active
`;

function response(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status }
  );
}

function validOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");

  return origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://127.0.0.1:3000" ||
        origin === "http://localhost:3000"));
}

async function authorize(request: NextRequest) {
  const user = await requireRole(["ADMIN"]);

  if (!user) return response("Administrator access required", 403);

  if (!validOrigin(request)) {
    return response("Invalid request origin", 403);
  }

  return null;
}

function databaseError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23514"
  ) {
    return response("Proposal is locked by its review or approval status", 409);
  }
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "23505") {
      return response("Module code already exists", 409);
    }
  }

  console.error("Institutional module operation failed:", error);
  return response("Unable to process module operation", 500);
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;

    const { moduleId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId)) {
      return response("Invalid module ID", 400);
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return response("JSON content type required", 415);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return response("Invalid JSON", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response("Invalid request body", 400);
    }

    const input = body as Record<string, unknown>;

    const allowed = [
      "module_code",
      "title",
      "description",
      "display_order",
      "is_active",
    ];

    const keys = Object.keys(input);

    if (!keys.length || keys.some(key => !allowed.includes(key))) {
      return response("Invalid update fields", 400);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if ("module_code" in input) {
      const code = typeof input.module_code === "string"
        ? input.module_code.trim().toUpperCase()
        : "";

      if (!/^[A-Z0-9_-]{1,20}$/.test(code)) {
        return response("Invalid module code", 400);
      }

      values.push(code);
      updates.push(`module_code = $${values.length}`);
    }

    if ("title" in input) {
      const title = typeof input.title === "string"
        ? input.title.trim()
        : "";

      if (!title || title.length > 255) {
        return response("Module title must be 1–255 characters", 400);
      }

      values.push(title);
      updates.push(`title = $${values.length}`);
    }

    if ("description" in input) {
      const description = input.description === null
        ? null
        : typeof input.description === "string"
          ? input.description.trim()
          : undefined;

      if (
        description === undefined ||
        (description !== null && description.length > 5000)
      ) {
        return response("Invalid description", 400);
      }

      values.push(description);
      updates.push(`description = $${values.length}`);
    }

    if ("display_order" in input) {
      const order = input.display_order;

      if (
        typeof order !== "number" ||
        !Number.isSafeInteger(order) ||
        order < 0 ||
        order > 100000
      ) {
        return response("Invalid display order", 400);
      }

      values.push(order);
      updates.push(`display_order = $${values.length}`);
    }

    if ("is_active" in input) {
      if (typeof input.is_active !== "boolean") {
        return response("Invalid active status", 400);
      }

      values.push(input.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    values.push(moduleId);

    const result = await query<ModuleRow>(
      `
      UPDATE institutional_modules
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
        AND deleted_at IS NULL
      RETURNING ${fields}
      `,
      values
    );

    if (!result.rows.length) {
      return response("Module not found", 404);
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const user = await requireRole(["ADMIN"]);

    if (!user) {
      return response("Administrator access required", 403);
    }

    if (!validOrigin(request)) {
      return response("Invalid request origin", 403);
    }

    const { moduleId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId)) {
      return response("Invalid module ID", 400);
    }

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const previous = await client.query(
        `
        SELECT ${fields}, deleted_at
        FROM institutional_modules
        WHERE id = $1
          AND deleted_at IS NULL
        FOR UPDATE
        `,
        [moduleId]
      );

      if (!previous.rows.length) {
        await client.query("ROLLBACK");
        return response("Module not found", 404);
      }

      const dependencies = await client.query(
        `
        SELECT
          EXISTS (
            SELECT 1 FROM module_activities
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM module_objectives
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM activity_functional_requirements
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM module_reviews
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM module_comments
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM module_decisions
            WHERE module_id = $1
          )
          OR EXISTS (
            SELECT 1 FROM module_revisions
            WHERE module_id = $1
          ) AS has_dependencies
        `,
        [moduleId]
      );

      if (dependencies.rows[0]?.has_dependencies) {
        await client.query("ROLLBACK");

        return response(
          "Module cannot be deleted because it contains activities, requirements, objectives, or workflow history",
          409
        );
      }

      const result = await client.query(
        `
        UPDATE institutional_modules
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING ${fields}, deleted_at
        `,
        [moduleId]
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return response("Module not found", 404);
      }

      await client.query(
        `
        INSERT INTO audit_logs
          (actor_id, action, entity_type, entity_id,
           old_values, new_values)
        VALUES
          ($1, 'MODULE_DELETED', 'institutional_modules',
           $2, $3::jsonb, $4::jsonb)
        `,
        [
          user.id,
          moduleId,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0]),
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json({
        success: true,
        message: "Module deleted successfully",
        data: result.rows[0],
        meta: null,
      });
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
