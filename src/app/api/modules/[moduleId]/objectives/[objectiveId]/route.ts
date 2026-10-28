import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string; objectiveId: string }>;
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

function databaseError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : null;

  if (code === "23514") {
    return fail("Proposal is locked or objective is invalid", 409);
  }

  if (code === "23505") {
    return fail("Objective code already exists", 409);
  }

  if (code === "23503") {
    return fail("Parent module not found", 404);
  }

  console.error("Objective update/delete failed:", error);
  return fail("Unable to process objective operation", 500);
}

async function authorize(request: NextRequest) {
  const user = await requireRole(["ADMIN"]);

  if (!user) {
    return {
      user: null,
      denied: fail("Administrator access required", 403)
    };
  }

  if (!validOrigin(request)) {
    return {
      user: null,
      denied: fail("Invalid request origin", 403)
    };
  }

  return { user, denied: null };
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  try {
    const { user, denied } = await authorize(request);
    if (denied) return denied;
    if (!user) return fail("Administrator access required", 403);

    const { moduleId, objectiveId } = await context.params;

    if (
      !/^[1-9]\d*$/.test(moduleId) ||
      !/^[1-9]\d*$/.test(objectiveId)
    ) {
      return fail("Invalid module or objective ID", 400);
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

    const allowed = [
      "objective_code",
      "title",
      "description",
      "display_order",
      "is_active"
    ];

    const keys = Object.keys(input);

    if (!keys.length || keys.some(k => !allowed.includes(k))) {
      return fail("Invalid update fields", 400);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if ("objective_code" in input) {
      const code =
        input.objective_code === null ||
        input.objective_code === ""
          ? null
          : typeof input.objective_code === "string"
            ? input.objective_code.trim().toUpperCase()
            : "";

      if (code !== null && !/^[A-Z0-9_-]{1,40}$/.test(code)) {
        return fail("Invalid objective code", 400);
      }

      values.push(code);
      updates.push(`objective_code = $${values.length}`);
    }

    if ("title" in input) {
      const title =
        typeof input.title === "string"
          ? input.title.trim()
          : "";

      if (!title || title.length > 255) {
        return fail("Title must be 1–255 characters", 400);
      }

      values.push(title);
      updates.push(`title = $${values.length}`);
    }

    if ("description" in input) {
      const description =
        input.description === null
          ? null
          : typeof input.description === "string"
            ? input.description.trim()
            : undefined;

      if (
        description === undefined ||
        (description !== null && description.length > 10000)
      ) {
        return fail("Invalid description", 400);
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
        return fail("Invalid display order", 400);
      }

      values.push(order);
      updates.push(`display_order = $${values.length}`);
    }

    if ("is_active" in input) {
      if (typeof input.is_active !== "boolean") {
        return fail("Invalid active status", 400);
      }

      values.push(input.is_active);
      updates.push(`is_active = $${values.length}`);
    }

    values.push(moduleId, objectiveId);

    const moduleParam = values.length - 1;
    const objectiveParam = values.length;

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const previous = await client.query(
        `SELECT ${fields}
         FROM module_objectives
         WHERE module_id = $1
           AND id = $2
           AND deleted_at IS NULL
         FOR UPDATE`,
        [moduleId, objectiveId]
      );

      if (!previous.rows.length) {
        await client.query("ROLLBACK");
        return fail("Objective not found", 404);
      }

      const result = await client.query(
        `
        UPDATE module_objectives
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE module_id = $${moduleParam}
          AND id = $${objectiveParam}
          AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM institutional_modules
            WHERE id = $${moduleParam}
              AND deleted_at IS NULL
          )
        RETURNING ${fields}
        `,
        values
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return fail("Objective not found", 404);
      }

      await client.query(
        `INSERT INTO audit_logs
          (actor_id, action, entity_type, entity_id,
           old_values, new_values)
         VALUES
          ($1, 'OBJECTIVE_UPDATED', 'module_objectives',
           $2, $3::jsonb, $4::jsonb)`,
        [
          user.id,
          objectiveId,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0])
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json({
        success: true,
        data: result.rows[0]
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

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  try {
    const { user, denied } = await authorize(request);
    if (denied) return denied;
    if (!user) return fail("Administrator access required", 403);

    const { moduleId, objectiveId } = await context.params;

    if (
      !/^[1-9]\d*$/.test(moduleId) ||
      !/^[1-9]\d*$/.test(objectiveId)
    ) {
      return fail("Invalid module or objective ID", 400);
    }

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const previous = await client.query(
        `SELECT ${fields}
         FROM module_objectives
         WHERE module_id = $1
           AND id = $2
           AND deleted_at IS NULL
         FOR UPDATE`,
        [moduleId, objectiveId]
      );

      if (!previous.rows.length) {
        await client.query("ROLLBACK");
        return fail("Objective not found", 404);
      }

      const result = await client.query(
        `
        UPDATE module_objectives
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE module_id = $1
          AND id = $2
          AND deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM institutional_modules
            WHERE id = $1
              AND deleted_at IS NULL
          )
        RETURNING ${fields}, deleted_at
        `,
        [moduleId, objectiveId]
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");
        return fail("Objective not found", 404);
      }

      await client.query(
        `INSERT INTO audit_logs
          (actor_id, action, entity_type, entity_id,
           old_values, new_values)
         VALUES
          ($1, 'OBJECTIVE_DELETED', 'module_objectives',
           $2, $3::jsonb, $4::jsonb)`,
        [
          user.id,
          objectiveId,
          JSON.stringify(previous.rows[0]),
          JSON.stringify(result.rows[0])
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json({
        success: true,
        message: "Objective deleted successfully"
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
