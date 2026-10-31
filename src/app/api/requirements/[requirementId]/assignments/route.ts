import { NextRequest, NextResponse } from "next/server";
import { getPool, query } from "@/lib/db";
import { getCurrentUser, requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ requirementId: string }>;
};

type AssignmentRole = "REVIEWER" | "DEVELOPER" | "APPROVER" | "TESTER";

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, message, data: null, meta: null },
    { status }
  );
}

function validOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  return origin === "https://opc.osdavc.com" ||
    (process.env.NODE_ENV === "development" &&
      (origin === "http://localhost:3000" ||
        origin === "http://127.0.0.1:3000"));
}

function validId(value: string): boolean {
  return /^[1-9]\d*$/.test(value);
}

function databaseError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : null;

  if (code === "23505") {
    return fail("This assignment already exists", 409);
  }

  if (code === "23503") {
    return fail("Related record does not exist", 404);
  }

  console.error("Requirement assignment failed:", error);
  return fail("Unable to process requirement assignment", 500);
}

export async function GET(
  _request: NextRequest,
  context: Context
) {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
  }

  try {
    const result = await query(
      `SELECT
         ra.id::text AS id,
         ra.requirement_id::text AS requirement_id,
         ra.user_id::text AS user_id,
         u.full_name,
         u.email,
         ra.role_code,
         ra.assigned_by::text AS assigned_by,
         ra.assigned_at,
         ra.revoked_at,
         ra.is_lead
       FROM requirement_assignments ra
       JOIN app_users u ON u.id = ra.user_id
       JOIN activity_functional_requirements fr
         ON fr.id = ra.requirement_id
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE ra.requirement_id = $1
         AND fr.deleted_at IS NULL
         AND m.deleted_at IS NULL
         AND p.deleted_at IS NULL
         AND ($2 = 'ADMIN' OR ra.user_id = $3)
       ORDER BY ra.assigned_at DESC, ra.id DESC`,
      [requirementId, user.role_code, user.id]
    );

    return NextResponse.json({
      success: true,
      message: "Assignments loaded successfully",
      data: result.rows,
      meta: { total: result.rowCount },
    });
  } catch (error) {
    return databaseError(error);
  }
}

export async function POST(
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

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return fail("JSON content type required", 415);
  }

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
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

  if (Object.keys(input).some((key) => !["user_id", "role_code"].includes(key))) {
    return fail("Unexpected assignment fields", 400);
  }

  const userId =
    typeof input.user_id === "string" ? input.user_id : "";

  const role = input.role_code;

  if (!validId(userId)) {
    return fail("Invalid user ID", 400);
  }

  if (
    role !== "REVIEWER" &&
    role !== "DEVELOPER" &&
    role !== "APPROVER" &&
    role !== "TESTER"
  ) {
    return fail("Invalid assignment role", 400);
  }

  const assignmentRole: AssignmentRole = role;

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const requirement = await client.query(
      `SELECT fr.id, fr.status, m.project_id
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       FOR UPDATE OF fr`,
      [requirementId]
    );

    if (!requirement.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Active requirement not found", 404);
    }

    const eligible = await client.query(
      `SELECT u.id
       FROM app_users u
       JOIN app_roles r ON r.id = u.role_id
       WHERE u.id = $1
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL
         AND r.role_code = $2`,
      [userId, assignmentRole]
    );

    if (!eligible.rows[0]) {
      await client.query("ROLLBACK");
      return fail("User is not active or does not have the selected role", 409);
    }

    const existing = await client.query(
      `SELECT id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND user_id = $2
         AND role_code = $3
         AND revoked_at IS NULL`,
      [requirementId, userId, assignmentRole]
    );

    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return fail("User is already assigned to this requirement", 409);
    }

    const created = await client.query(
      `INSERT INTO requirement_assignments
         (requirement_id, user_id, role_code, assigned_by)
       VALUES ($1, $2, $3, $4)
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         user_id::text AS user_id,
         role_code,
         assigned_by::text AS assigned_by,
         assigned_at,
         revoked_at,
         is_lead`,
      [requirementId, userId, assignmentRole, admin.id]
    );

    const assignment = created.rows[0];

    if (assignmentRole === "REVIEWER") {
      const lifecycle = await client.query(
        `INSERT INTO requirement_lifecycle
           (requirement_id, lifecycle_status, updated_by)
         VALUES ($1, 'ASSIGNED_FOR_REVIEW', $2)
         ON CONFLICT (requirement_id)
         DO UPDATE SET
           lifecycle_status = 'ASSIGNED_FOR_REVIEW',
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
         WHERE requirement_lifecycle.lifecycle_status = 'CREATED'
         RETURNING lifecycle_status`,
        [requirementId, admin.id]
      );

      if (lifecycle.rows.length > 0) {
        await client.query(
          `INSERT INTO requirement_workflow_events
             (requirement_id, from_status, to_status, actor_id, remarks, metadata)
           VALUES
             ($1, 'CREATED', 'ASSIGNED_FOR_REVIEW', $2,
              'Reviewer assigned', $3::jsonb)`,
          [
            requirementId,
            admin.id,
            JSON.stringify({
              assignment_id: assignment.id,
              assigned_user_id: userId,
            }),
          ]
        );
      }
    }

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, new_values)
       VALUES
         ($1, 'REQUIREMENT_ASSIGNED', 'requirement_assignments', $2, $3::jsonb)`,
      [admin.id, assignment.id, JSON.stringify(assignment)]
    );

    await client.query("COMMIT");

    return NextResponse.json(
      {
        success: true,
        message: "Requirement assigned successfully",
        data: assignment,
        meta: null,
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return databaseError(error);
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

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
  }

  const assignmentId = request.nextUrl.searchParams.get("assignmentId");

  if (!assignmentId || !validId(assignmentId)) {
    return fail("Valid assignmentId query parameter required", 400);
  }

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT
         ra.id,
         ra.requirement_id,
         ra.user_id,
         ra.role_code,
         ra.assigned_by,
         ra.assigned_at,
          ra.revoked_at,
          ra.is_lead
       FROM requirement_assignments ra
       WHERE ra.id = $1
         AND ra.requirement_id = $2
         AND ra.revoked_at IS NULL
       FOR UPDATE`,
      [assignmentId, requirementId]
    );

    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return fail("Active assignment not found", 404);
    }

    const updated = await client.query(
      `UPDATE requirement_assignments
       SET revoked_at = NOW(),
           is_lead = FALSE
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING id::text AS id, requirement_id::text AS requirement_id,
         user_id::text AS user_id, role_code, revoked_at, is_lead`,
      [assignmentId]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, old_values, new_values)
       VALUES
         ($1, 'REQUIREMENT_ASSIGNMENT_REVOKED',
          'requirement_assignments', $2, $3::jsonb, $4::jsonb)`,
      [
        admin.id,
        assignmentId,
        JSON.stringify(existing.rows[0]),
        JSON.stringify(updated.rows[0]),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Requirement assignment revoked successfully",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return databaseError(error);
  } finally {
    client.release();
  }
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

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return fail("JSON content type required", 415);
  }

  const { requirementId } = await context.params;

  if (!validId(requirementId)) {
    return fail("Invalid requirement ID", 400);
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

  if (
    Object.keys(input).length !== 1 ||
    typeof input.assignment_id !== "string" ||
    !validId(input.assignment_id)
  ) {
    return fail("Valid assignment_id is required", 400);
  }

  const assignmentId = input.assignment_id;
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    // Serialize leadership changes for the same requirement.
    const requirement = await client.query(
      `SELECT fr.id
       FROM activity_functional_requirements fr
       JOIN institutional_modules m ON m.id = fr.module_id
       JOIN projects p ON p.id = m.project_id
       WHERE fr.id = $1
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       FOR UPDATE OF fr`,
      [requirementId]
    );

    if (!requirement.rows.length) {
      await client.query("ROLLBACK");
      return fail("Active requirement not found", 404);
    }

    const target = await client.query(
      `SELECT ra.id, ra.user_id, ra.is_lead
       FROM requirement_assignments ra
       JOIN app_users u ON u.id = ra.user_id
       JOIN app_roles r ON r.id = u.role_id
       WHERE ra.id = $1
         AND ra.requirement_id = $2
         AND ra.role_code = 'REVIEWER'
         AND ra.revoked_at IS NULL
         AND u.is_active = TRUE
         AND u.deleted_at IS NULL
         AND r.role_code = 'REVIEWER'
       FOR UPDATE OF ra`,
      [assignmentId, requirementId]
    );

    if (!target.rows.length) {
      await client.query("ROLLBACK");
      return fail("Active eligible Reviewer assignment not found", 404);
    }

    const previous = await client.query(
      `SELECT id::text AS id, user_id::text AS user_id
       FROM requirement_assignments
       WHERE requirement_id = $1
         AND is_lead = TRUE
         AND revoked_at IS NULL
       FOR UPDATE`,
      [requirementId]
    );

    if (target.rows[0].is_lead) {
      await client.query("ROLLBACK");
      return fail("This Reviewer is already the Lead Reviewer", 409);
    }

    await client.query(
      `UPDATE requirement_assignments
       SET is_lead = FALSE
       WHERE requirement_id = $1
         AND is_lead = TRUE
         AND revoked_at IS NULL`,
      [requirementId]
    );

    const updated = await client.query(
      `UPDATE requirement_assignments
       SET is_lead = TRUE
       WHERE id = $1
         AND requirement_id = $2
         AND role_code = 'REVIEWER'
         AND revoked_at IS NULL
       RETURNING
         id::text AS id,
         requirement_id::text AS requirement_id,
         user_id::text AS user_id,
         role_code,
         is_lead`,
      [assignmentId, requirementId]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, action, entity_type, entity_id, old_values, new_values)
       VALUES
         ($1, 'REQUIREMENT_LEAD_REVIEWER_CHANGED',
          'requirement_assignments', $2, $3::jsonb, $4::jsonb)`,
      [
        admin.id,
        assignmentId,
        JSON.stringify({
          previous_lead: previous.rows[0] ?? null,
        }),
        JSON.stringify({
          new_lead: updated.rows[0],
        }),
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      message: "Lead Reviewer updated successfully",
      data: updated.rows[0],
      meta: null,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return databaseError(error);
  } finally {
    client.release();
  }
}
