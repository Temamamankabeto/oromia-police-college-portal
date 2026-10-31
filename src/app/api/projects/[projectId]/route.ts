import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ projectId: string }>;
};

type ProjectStatus =
  | "PLANNED"
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";

type Project = {
  id: string;
  project_code: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

const statuses: ProjectStatus[] = [
  "PLANNED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, message, data: null, meta: null },
    { status }
  );
}

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  return (
    origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://localhost:3000" ||
        origin === "http://127.0.0.1:3000"))
  );
}

export async function PATCH(
  request: NextRequest,
  context: Context
) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return fail("Administrator access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { projectId } = await context.params;

  if (!/^[1-9]\d*$/.test(projectId)) {
    return fail("Invalid project ID", 400);
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
    "title",
    "description",
    "status",
  ];

  const keys = Object.keys(input);

  if (
    keys.length === 0 ||
    keys.some(key => !allowedFields.includes(key))
  ) {
    return fail("Invalid project update fields", 400);
  }

  if (
    input.title !== undefined &&
    (typeof input.title !== "string" ||
      input.title.trim().length < 2 ||
      input.title.trim().length > 255)
  ) {
    return fail("Invalid project title", 400);
  }

  if (
    input.description !== undefined &&
    input.description !== null &&
    (typeof input.description !== "string" ||
      input.description.trim().length > 5000)
  ) {
    return fail("Invalid project description", 400);
  }

  if (
    input.status !== undefined &&
    (typeof input.status !== "string" ||
      !statuses.includes(input.status as ProjectStatus))
  ) {
    return fail("Invalid project status", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query<Project>(
      `SELECT
         id::text AS id,
         project_code,
         title,
         description,
         status,
         created_by::text AS created_by,
         created_at,
         updated_at
       FROM projects
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [projectId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return fail("Project not found", 404);
    }

    const title =
      typeof input.title === "string"
        ? input.title.trim()
        : existing.title;

    const description =
      input.description === null
        ? null
        : typeof input.description === "string"
          ? input.description.trim()
          : existing.description;

    const status =
      typeof input.status === "string"
        ? (input.status as ProjectStatus)
        : existing.status;

    if (
      title === existing.title &&
      description === existing.description &&
      status === existing.status
    ) {
      await client.query("ROLLBACK");

      return NextResponse.json({
        success: true,
        message: "No project changes detected",
        data: existing,
        meta: null,
      });
    }

    const updatedResult = await client.query<Project>(
      `UPDATE projects
       SET
         title = $2,
         description = $3,
         status = $4,
         updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING
         id::text AS id,
         project_code,
         title,
         description,
         status,
         created_by::text AS created_by,
         created_at,
         updated_at`,
      [projectId, title, description, status]
    );

    const updated = updatedResult.rows[0];

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
         ($1, 'PROJECT_UPDATED', 'projects', $2, $3::jsonb, $4::jsonb)`,
      [
        admin.id,
        projectId,
        JSON.stringify({
          title: existing.title,
          description: existing.description,
          status: existing.status,
        }),
        JSON.stringify({
          title: updated.title,
          description: updated.description,
          status: updated.status,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Project updated successfully",
      data: updated,
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Project update failed:", error);
    return fail("Unable to update project", 500);
  } finally {
    client.release();
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context
) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return fail("Administrator access required", 403);
  }

  if (!validOrigin(request)) {
    return fail("Invalid request origin", 403);
  }

  const { projectId } = await context.params;

  if (!/^[1-9]\d*$/.test(projectId)) {
    return fail("Invalid project ID", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query<Project>(
      `SELECT
         id::text AS id,
         project_code,
         title,
         description,
         status,
         created_by::text AS created_by,
         created_at,
         updated_at
       FROM projects
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [projectId]
    );

    const existing = existingResult.rows[0];

    if (!existing) {
      await client.query("ROLLBACK");
      return fail("Project not found", 404);
    }

    const dependencies = await client.query<{
      has_dependencies: boolean;
    }>(
      `SELECT
         (
           EXISTS (
             SELECT 1
             FROM institutional_modules
             WHERE project_id = $1
           )
           OR EXISTS (
             SELECT 1
             FROM project_members
             WHERE project_id = $1
           )
         ) AS has_dependencies`,
      [projectId]
    );

    if (dependencies.rows[0]?.has_dependencies) {
      await client.query("ROLLBACK");

      return fail(
        "Project cannot be deleted because it has modules or project membership history",
        409
      );
    }

    const deletedResult = await client.query(
      `UPDATE projects
       SET deleted_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
         AND deleted_at IS NULL
       RETURNING
         id::text AS id,
         project_code,
         title,
         description,
         status,
         created_at,
         updated_at,
         deleted_at`,
      [projectId]
    );

    const deleted = deletedResult.rows[0];

    if (!deleted) {
      await client.query("ROLLBACK");
      return fail("Project not found", 404);
    }

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
         (
           $1,
           'PROJECT_DELETED',
           'projects',
           $2,
           $3::jsonb,
           $4::jsonb
         )`,
      [
        admin.id,
        projectId,
        JSON.stringify(existing),
        JSON.stringify(deleted),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Project deleted successfully",
      data: deleted,
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    console.error("Project deletion failed:", error);

    return fail("Unable to delete project", 500);
  } finally {
    client.release();
  }
}
