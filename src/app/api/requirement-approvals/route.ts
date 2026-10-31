import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequirementApprovalRow = {
  requirement_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: string;
  requirement_status: string;
  lifecycle_status: string;
  module_code: string;
  module_name: string;
  assignment_id: string;
  decision_history: unknown[];
};

function fail(message: string, status: number) {
  return NextResponse.json(
    { success: false, message, data: null, meta: null },
    { status }
  );
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  if (user.role_code !== "APPROVER") {
    return fail("Approver access required", 403);
  }

  try {
    const result = await query<RequirementApprovalRow>(
      `SELECT
         fr.id::text AS requirement_id,
         fr.requirement_code,
         fr.title,
         fr.description,
         fr.acceptance_criteria,
         fr.priority,
         fr.status AS requirement_status,
         rl.lifecycle_status,
         m.module_code,
         m.title AS module_name,
         ra.id::text AS assignment_id,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', e.id::text,
                 'from_status', e.from_status,
                 'to_status', e.to_status,
                 'remarks', e.remarks,
                 'actor_id', e.actor_id::text,
                 'actor_name', actor.full_name,
                 'created_at', e.created_at,
                 'metadata', e.metadata
               )
               ORDER BY e.created_at DESC, e.id DESC
             )
             FROM requirement_workflow_events e
             JOIN app_users actor ON actor.id = e.actor_id
             WHERE e.requirement_id = fr.id
               AND e.from_status = 'REVIEWED'
               AND e.to_status IN ('APPROVED', 'UNDER_REVIEW')
           ),
           '[]'::jsonb
         ) AS decision_history
       FROM requirement_assignments ra
       JOIN activity_functional_requirements fr
         ON fr.id = ra.requirement_id
       JOIN requirement_lifecycle rl
         ON rl.requirement_id = fr.id
       JOIN institutional_modules m
         ON m.id = fr.module_id
       JOIN projects p
         ON p.id = m.project_id
       WHERE ra.user_id = $1
         AND ra.role_code = 'APPROVER'
         AND ra.revoked_at IS NULL
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       ORDER BY
         CASE
           WHEN rl.lifecycle_status = 'REVIEWED' THEN 0
           WHEN rl.lifecycle_status = 'UNDER_REVIEW' THEN 1
           WHEN rl.lifecycle_status = 'APPROVED' THEN 2
           ELSE 3
         END,
         fr.requirement_code,
         fr.id`,
      [user.id]
    );

    return NextResponse.json({
      success: true,
      message: "Assigned requirement approvals loaded successfully",
      data: result.rows,
      meta: {
        total: result.rows.length,
        pending: result.rows.filter(
          (row) => row.lifecycle_status === "REVIEWED"
        ).length,
      },
    });
  } catch (error) {
    console.error("Failed to load requirement approvals:", error);

    return fail("Unable to load requirement approvals", 500);
  }
}