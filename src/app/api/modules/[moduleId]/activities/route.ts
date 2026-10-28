import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
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

const activityFields = `
  id::text AS id,
  module_id::text AS module_id,
  activity_code,
  title,
  description,
  display_order,
  is_active
`;

function errorResponse(message: string, status: number) {
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

export async function GET(
  _request: NextRequest,
  context: Context
) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return errorResponse("Unauthorized", 401);
    }

    const { moduleId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId)) {
      return errorResponse("Invalid module ID", 400);
    }

    const moduleResult = await query(
      `SELECT id FROM institutional_modules
       WHERE id = $1 AND deleted_at IS NULL`,
      [moduleId]
    );

    if (!moduleResult.rows.length) {
      return errorResponse("Module not found", 404);
    }

    const result = await query<Activity>(
      `SELECT ${activityFields}
       FROM module_activities
       WHERE module_id = $1 AND deleted_at IS NULL
       ORDER BY display_order ASC, id ASC`,
      [moduleId]
    );

    return NextResponse.json({
      success: true,
      module_id: moduleId,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load activities:", error);
    return errorResponse("Unable to load activities", 500);
  }
}

export async function POST(
  request: NextRequest,
  context: Context
) {
  try {
    const user = await requireRole(["ADMIN"]);

    if (!user) {
      return errorResponse("Administrator access required", 403);
    }

    if (!validOrigin(request)) {
      return errorResponse("Invalid request origin", 403);
    }

    const { moduleId } = await context.params;

    if (!/^[1-9]\d*$/.test(moduleId)) {
      return errorResponse("Invalid module ID", 400);
    }

    if (
      !request.headers.get("content-type")
        ?.includes("application/json")
    ) {
      return errorResponse("JSON content type required", 415);
    }

    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON", 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body", 400);
    }

    const input = body as Record<string, unknown>;

    const activityCode =
      input.activity_code === null ||
      input.activity_code === undefined ||
      input.activity_code === ""
        ? null
        : typeof input.activity_code === "string"
          ? input.activity_code.trim().toUpperCase()
          : "";

    const title =
      typeof input.title === "string"
        ? input.title.trim()
        : "";

    const description =
      input.description === null ||
      input.description === undefined
        ? null
        : typeof input.description === "string"
          ? input.description.trim()
          : undefined;

    const displayOrder = input.display_order ?? 0;
    const isActive = input.is_active ?? true;

    if (
      activityCode !== null &&
      !/^[A-Z0-9_-]{1,30}$/.test(activityCode)
    ) {
      return errorResponse("Invalid activity code", 400);
    }

    if (!title || title.length > 255) {
      return errorResponse("Invalid activity title", 400);
    }

    if (
      description === undefined ||
      (description !== null && description.length > 5000) ||
      typeof displayOrder !== "number" ||
      !Number.isSafeInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > 100000 ||
      typeof isActive !== "boolean"
    ) {
      return errorResponse("Invalid activity fields", 400);
    }

    const moduleResult = await query(
      `SELECT id FROM institutional_modules
       WHERE id = $1 AND deleted_at IS NULL`,
      [moduleId]
    );

    if (!moduleResult.rows.length) {
      return errorResponse("Module not found", 404);
    }

    const result = await query<Activity>(
      `INSERT INTO module_activities
         (module_id, activity_code, title, description,
          display_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${activityFields}`,
      [
        moduleId,
        activityCode,
        title,
        description,
        displayOrder,
        isActive,
      ]
    );

    return NextResponse.json(
      { success: true, data: result.rows[0] },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23514"
    ) {
      return errorResponse(
        "Proposal is locked by its review or approval status",
        409
      );
    }
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      return errorResponse(
        "Activity code already exists in this module",
        409
      );
    }

    console.error("Failed to create activity:", error);
    return errorResponse("Unable to create activity", 500);
  }
}
