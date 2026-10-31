import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Unauthorized", 401);
  }

  try {
    const result = await query<Project>(
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
       WHERE deleted_at IS NULL
       ORDER BY created_at DESC, id DESC`
    );

    return NextResponse.json({
      success: true,
      message: "Projects loaded successfully",
      data: result.rows,
      meta: { total: result.rowCount },
    });
  } catch (error) {
    console.error("Project listing failed:", error);
    return fail("Unable to load projects", 500);
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
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
    "project_code",
    "title",
    "description",
    "status",
  ];

  if (
    Object.keys(input).some(
      key => !allowedFields.includes(key)
    )
  ) {
    return fail("Unexpected project fields", 400);
  }

  const projectCode =
    typeof input.project_code === "string"
      ? input.project_code.trim().toUpperCase()
      : "";

  const title =
    typeof input.title === "string"
      ? input.title.trim()
      : "";

  const description =
    typeof input.description === "string"
      ? input.description.trim()
      : input.description === null ||
          input.description === undefined
        ? null
        : undefined;

  const status =
    input.status === undefined
      ? "ACTIVE"
      : input.status;

  if (!/^[A-Z0-9_-]{2,40}$/.test(projectCode)) {
    return fail(
      "Project code must contain 2-40 letters, numbers, underscores or hyphens",
      400
    );
  }

  if (title.length < 2 || title.length > 255) {
    return fail(
      "Project title must contain 2-255 characters",
      400
    );
  }

  if (
    description === undefined ||
    (description !== null && description.length > 5000)
  ) {
    return fail("Invalid project description", 400);
  }

  if (
    typeof status !== "string" ||
    !statuses.includes(status as ProjectStatus)
  ) {
    return fail("Invalid project status", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<Project>(
      `INSERT INTO projects
         (project_code, title, description, status, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id::text AS id,
         project_code,
         title,
         description,
         status,
         created_by::text AS created_by,
         created_at,
         updated_at`,
      [
        projectCode,
        title,
        description,
        status,
        admin.id,
      ]
    );

    const created = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, new_values)
       VALUES
         ($1, 'PROJECT_CREATED', 'projects', $2, $3::jsonb)`,
      [
        admin.id,
        created.id,
        JSON.stringify({
          project_code: created.project_code,
          title: created.title,
          description: created.description,
          status: created.status,
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        message: "Project created successfully",
        data: created,
        meta: null,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    await client.query("ROLLBACK").catch(() => {});

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      return fail("Project code already exists", 409);
    }

    console.error("Project creation failed:", error);
    return fail("Unable to create project", 500);
  } finally {
    client.release();
  }
}