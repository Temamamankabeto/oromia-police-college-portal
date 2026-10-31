import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SummaryRow = {
  projects: number;
  active_projects: number;
  completed_projects: number;
  modules: number;
  activities: number;
  requirements: number;
  pending_review: number;
  under_review: number;
  reviewed: number;
  approved: number;
  under_developing: number;
  developed: number;
  deployed: number;
  tested: number;
  test_passed: number;
  test_failed: number;
  test_blocked: number;
};

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        message: "Authentication required",
        data: null,
        meta: null,
      },
      { status: 401 }
    );
  }

  if (
    !["ADMIN", "REVIEWER", "APPROVER"].includes(user.role_code)
  ) {
    return NextResponse.json(
      {
        success: false,
        message: "Access denied",
        data: null,
        meta: null,
      },
      { status: 403 }
    );
  }

  try {
    const result = await query<SummaryRow>(`
      SELECT
        (
          SELECT COUNT(*)::integer
          FROM projects
          WHERE deleted_at IS NULL
        ) AS projects,

        (
          SELECT COUNT(*)::integer
          FROM projects
          WHERE deleted_at IS NULL
            AND status = 'ACTIVE'
        ) AS active_projects,

        (
          SELECT COUNT(*)::integer
          FROM projects
          WHERE deleted_at IS NULL
            AND status = 'COMPLETED'
        ) AS completed_projects,

        (
          SELECT COUNT(*)::integer
          FROM institutional_modules
          WHERE deleted_at IS NULL
        ) AS modules,

        (
          SELECT COUNT(*)::integer
          FROM module_activities a
          JOIN institutional_modules m ON m.id = a.module_id
          JOIN projects p ON p.id = m.project_id
          WHERE a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
        ) AS activities,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
        ) AS requirements,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status IN (
              'CREATED',
              'ASSIGNED_FOR_REVIEW'
            )
        ) AS pending_review,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status = 'UNDER_REVIEW'
        ) AS under_review,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status = 'REVIEWED'
        ) AS reviewed,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status IN (
              'APPROVED',
              'UNDER_DEVELOPING',
              'DEVELOPED',
              'DEPLOYED',
              'TESTED'
            )
        ) AS approved,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status = 'UNDER_DEVELOPING'
        ) AS under_developing,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status IN (
              'DEVELOPED',
              'DEPLOYED',
              'TESTED'
            )
        ) AS developed,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status IN ('DEPLOYED', 'TESTED')
        ) AS deployed,

        (
          SELECT COUNT(*)::integer
          FROM activity_functional_requirements fr
          JOIN requirement_lifecycle rl
            ON rl.requirement_id = fr.id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          JOIN module_activities a ON a.id = fr.activity_id
          WHERE fr.deleted_at IS NULL
            AND a.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND rl.lifecycle_status = 'TESTED'
        ) AS tested,

        (
          SELECT COUNT(*)::integer
          FROM requirement_test_results t
          JOIN activity_functional_requirements fr
            ON fr.id = t.requirement_id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          WHERE t.result = 'PASSED'
            AND fr.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
        ) AS test_passed,

        (
          SELECT COUNT(*)::integer
          FROM requirement_test_results t
          JOIN activity_functional_requirements fr
            ON fr.id = t.requirement_id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          WHERE t.result = 'FAILED'
            AND fr.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
        ) AS test_failed,

        (
          SELECT COUNT(*)::integer
          FROM requirement_test_results t
          JOIN activity_functional_requirements fr
            ON fr.id = t.requirement_id
          JOIN institutional_modules m ON m.id = fr.module_id
          JOIN projects p ON p.id = m.project_id
          WHERE t.result = 'BLOCKED'
            AND fr.deleted_at IS NULL
            AND m.deleted_at IS NULL
            AND p.deleted_at IS NULL
        ) AS test_blocked
    `);

    return NextResponse.json(
      {
        success: true,
        message: "Report summary retrieved successfully",
        data: result.rows[0],
        meta: null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("Report summary query failed:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to load report summary",
        data: null,
        meta: null,
      },
      { status: 500 }
    );
  }
}