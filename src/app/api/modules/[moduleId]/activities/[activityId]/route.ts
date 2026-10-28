import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{
    moduleId: string;
    activityId: string;
  }>;
};

type Activity = {
  id: string;
  module_id: string;
  activity_code: string | null;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

const fields = `
  id::text AS id,
  module_id::text AS module_id,
  activity_code,
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

  return (
    origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      origin === "http://127.0.0.1:3000")
  );
}

async function authorize(request: NextRequest) {
  const user = await requireRole(["ADMIN"]);

  if (!user) {
    return fail("Administrator access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
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
    return fail("Proposal is locked by its review or approval status", 409);
  }
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23505"
  ) {
    return fail("Activity code already exists in this module", 409);
  }

  console.error("Activity operation failed:", error);
  return fail("Unable to process activity operation", 500);
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;

    const { moduleId, activityId } = await context.params;

    if (
      !/^[1-9]\d*$/.test(moduleId) ||
      !/^[1-9]\d*$/.test(activityId)
    ) {
      return fail("Invalid module or activity ID", 400);
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
      "activity_code",
      "title",
      "description",
      "display_order",
      "is_active",
    ];

    const keys = Object.keys(input);

    if (!keys.length || keys.some(k => !allowed.includes(k))) {
      return fail("Invalid update fields", 400);
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if ("activity_code" in input) {
      const code =
        input.activity_code === null ||
        input.activity_code === ""
          ? null
          : typeof input.activity_code === "string"
            ? input.activity_code.trim().toUpperCase()
            : "";

      if (code !== null && !/^[A-Z0-9_-]{1,30}$/.test(code)) {
        return fail("Invalid activity code", 400);
      }

      values.push(code);
      updates.push(`activity_code = $${values.length}`);
    }

    if ("title" in input) {
      const title =
        typeof input.title === "string"
          ? input.title.trim()
          : "";

      if (!title || title.length > 255) {
        return fail("Invalid activity title", 400);
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
        (description !== null && description.length > 5000)
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

    values.push(moduleId, activityId);

    const moduleParam = values.length - 1;
    const activityParam = values.length;

    const result = await query<Activity>(
      `
      UPDATE module_activities
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE module_id = $${moduleParam}
        AND id = $${activityParam}
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
      return fail("Activity not found", 404);
    }

    return NextResponse.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  try {
    const denied = await authorize(request);
    if (denied) return denied;

    const { moduleId, activityId } = await context.params;

    if (
      !/^[1-9]\d*$/.test(moduleId) ||
      !/^[1-9]\d*$/.test(activityId)
    ) {
      return fail("Invalid module or activity ID", 400);
    }

    const result = await query<Activity>(
      `
      UPDATE module_activities
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
      RETURNING ${fields}
      `,
      [moduleId, activityId]
    );

    if (!result.rows.length) {
      return fail("Activity not found", 404);
    }

    return NextResponse.json({
      success: true,
      message: "Activity deleted successfully",
    });
  } catch (error) {
    return databaseError(error);
  }
}
