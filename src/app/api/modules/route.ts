import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstitutionalModule = {
  id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const result = await query<InstitutionalModule>(`
      SELECT
        id::text AS id,
        module_code,
        title,
        description,
        display_order,
        is_active
      FROM institutional_modules
      WHERE deleted_at IS NULL
      ORDER BY display_order ASC, id ASC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load institutional modules:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load institutional modules" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRole(["ADMIN"]);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Administrator access required" },
        { status: 403 }
      );
    }

    const origin = request.headers.get("origin");
    if (
      !origin ||
      !(
        origin === "https://opc.osdavc.com" ||
        (process.env.NODE_ENV === "development" &&
          origin === "http://127.0.0.1:3000")
      )
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid request origin" },
        { status: 403 }
      );
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return NextResponse.json(
        { success: false, error: "JSON content type required" },
        { status: 415 }
      );
    }

    const body: unknown = await request.json();

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 }
      );
    }

    const input = body as Record<string, unknown>;

    const moduleCode =
      typeof input.module_code === "string"
        ? input.module_code.trim().toUpperCase()
        : "";

    const title =
      typeof input.title === "string" ? input.title.trim() : "";

    const description =
      typeof input.description === "string"
        ? input.description.trim()
        : null;

    const displayOrder = input.display_order ?? 0;
    const isActive = input.is_active ?? true;

    if (!/^[A-Z0-9_-]{1,20}$/.test(moduleCode)) {
      return NextResponse.json(
        { success: false, error: "Invalid module code" },
        { status: 400 }
      );
    }

    if (!title || title.length > 255) {
      return NextResponse.json(
        { success: false, error: "Module title must be 1–255 characters" },
        { status: 400 }
      );
    }

    if (
      (description !== null && description.length > 5000) ||
      typeof displayOrder !== "number" ||
      !Number.isSafeInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > 100000 ||
      typeof isActive !== "boolean"
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid module fields" },
        { status: 400 }
      );
    }

    const result = await query<InstitutionalModule>(
      `
      INSERT INTO institutional_modules
        (module_code, title, description, display_order, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id::text AS id,
        module_code,
        title,
        description,
        display_order,
        is_active
      `,
      [moduleCode, title, description, displayOrder, isActive]
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
      error.code === "23505"
    ) {
      return NextResponse.json(
        { success: false, error: "Module code already exists" },
        { status: 409 }
      );
    }

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { success: false, error: "Invalid JSON" },
        { status: 400 }
      );
    }

    console.error("Failed to create institutional module:", error);

    return NextResponse.json(
      { success: false, error: "Unable to create module" },
      { status: 500 }
    );
  }
}
