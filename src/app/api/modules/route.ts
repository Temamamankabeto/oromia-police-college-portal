import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstitutionalModule = {
  id: string;
  project_id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

const moduleFields = `
  id::text AS id,
  project_id::text AS project_id,
  module_code,
  title,
  description,
  display_order,
  is_active
`;

function fail(error: string, status: number) {
  return NextResponse.json(
    { success: false, error },
    { status }
  );
}

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  return (
    origin === "https://opc.osdavc.com" ||
    (
      process.env.NODE_ENV === "development" &&
      (
        origin === "http://127.0.0.1:3000" ||
        origin === "http://localhost:3000"
      )
    )
  );
}

function databaseError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : null;

  if (code === "23505") {
    return fail("Module code already exists", 409);
  }

  if (code === "23503") {
    return fail("Selected project does not exist", 404);
  }

  if (code === "23514") {
    return fail("Module operation violates workflow restrictions", 409);
  }

  console.error("Institutional module operation failed:", error);

  return fail("Unable to process institutional module", 500);
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return fail("Unauthorized", 401);
    }

    const result = await query<InstitutionalModule>(`
      SELECT ${moduleFields}
      FROM institutional_modules
      WHERE deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM projects
          WHERE projects.id = institutional_modules.project_id
            AND projects.deleted_at IS NULL
        )
      ORDER BY display_order ASC, id ASC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load institutional modules:", error);

    return fail("Unable to load institutional modules", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireRole(["ADMIN"]);

    if (!user) {
      return fail("Administrator access required", 403);
    }

    if (!validOrigin(request)) {
      return fail("Invalid request origin", 403);
    }

    if (
      !request.headers
        .get("content-type")
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

    const allowedFields = [
      "project_id",
      "module_code",
      "title",
      "description",
      "display_order",
      "is_active",
    ];

    if (
      Object.keys(input).some(
        key => !allowedFields.includes(key)
      )
    ) {
      return fail("Invalid module fields", 400);
    }

    const projectId =
      typeof input.project_id === "string" ||
      typeof input.project_id === "number"
        ? String(input.project_id)
        : "";

    if (!/^[1-9]\d*$/.test(projectId)) {
      return fail("Valid project ID is required", 400);
    }

    const moduleCode =
      typeof input.module_code === "string"
        ? input.module_code.trim().toUpperCase()
        : "";

    const title =
      typeof input.title === "string"
        ? input.title.trim()
        : "";

    const description =
      input.description === undefined ||
      input.description === null
        ? null
        : typeof input.description === "string"
          ? input.description.trim()
          : undefined;

    const displayOrder = input.display_order ?? 0;
    const isActive = input.is_active ?? true;

    if (!/^[A-Z0-9_-]{1,20}$/.test(moduleCode)) {
      return fail("Invalid module code", 400);
    }

    if (!title || title.length > 255) {
      return fail("Module title must be 1-255 characters", 400);
    }

    if (
      description === undefined ||
      (
        description !== null &&
        description.length > 5000
      ) ||
      typeof displayOrder !== "number" ||
      !Number.isSafeInteger(displayOrder) ||
      displayOrder < 0 ||
      displayOrder > 100000 ||
      typeof isActive !== "boolean"
    ) {
      return fail("Invalid module fields", 400);
    }

    const client = await getPool().connect();

    try {
      await client.query("BEGIN");

      const projectResult = await client.query(
        `SELECT id
         FROM projects
         WHERE id = $1
           AND deleted_at IS NULL
         FOR SHARE`,
        [projectId]
      );

      if (!projectResult.rows.length) {
        await client.query("ROLLBACK");
        return fail("Selected project not found", 404);
      }

      const result = await client.query<InstitutionalModule>(
        `INSERT INTO institutional_modules
          (
            project_id,
            module_code,
            title,
            description,
            display_order,
            is_active
          )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${moduleFields}`,
        [
          projectId,
          moduleCode,
          title,
          description,
          displayOrder,
          isActive,
        ]
      );

      const createdModule = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
          (
            actor_id,
            action,
            entity_type,
            entity_id,
            new_values
          )
         VALUES
          (
            $1,
            'MODULE_CREATED',
            'institutional_modules',
            $2,
            $3::jsonb
          )`,
        [
          user.id,
          createdModule.id,
          JSON.stringify(createdModule),
        ]
      );

      await client.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          data: createdModule,
        },
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
