import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequirementReviewRow = {
  requirement_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: string;
  requirement_status: string;
  lifecycle_status: string;
  module_id: string;
  module_code: string;
  module_title: string;
  activity_id: string;
  activity_code: string;
  activity_title: string;
  is_lead: boolean;
  reviewer_count: number;
  comment_count: number;
  unresolved_comment_count: number;
};

function fail(message: string, status: number) {
  return NextResponse.json(
    {
      success: false,
      message,
      data: null,
      meta: null,
    },
    { status }
  );
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return fail("Authentication required", 401);
  }

  if (
    user.role_code !== "ADMIN" &&
    user.role_code !== "REVIEWER"
  ) {
    return fail("Reviewer access required", 403);
  }

  try {
    const result = await query<RequirementReviewRow>(
      `SELECT
         fr.id::text AS requirement_id,
         fr.requirement_code,
         fr.title,
         fr.description,
         fr.acceptance_criteria,
         fr.priority,
         fr.status AS requirement_status,
         COALESCE(
           rl.lifecycle_status,
           'CREATED'
         ) AS lifecycle_status,

         m.id::text AS module_id,
         m.module_code,
         m.title AS module_title,

         a.id::text AS activity_id,
         a.activity_code,
         a.title AS activity_title,

         COALESCE(
           (
             SELECT ra.is_lead
             FROM requirement_assignments ra
             WHERE ra.requirement_id = fr.id
               AND ra.user_id = $1
               AND ra.role_code = 'REVIEWER'
               AND ra.revoked_at IS NULL
             LIMIT 1
           ),
           FALSE
         ) AS is_lead,

         (
           SELECT COUNT(*)::integer
           FROM requirement_assignments ra
           WHERE ra.requirement_id = fr.id
             AND ra.role_code = 'REVIEWER'
             AND ra.revoked_at IS NULL
         ) AS reviewer_count,

         (
           SELECT COUNT(*)::integer
           FROM requirement_review_comments c
           WHERE c.requirement_id = fr.id
         ) AS comment_count,

         (
           SELECT COUNT(*)::integer
           FROM requirement_review_comments c
           WHERE c.requirement_id = fr.id
             AND c.resolution_status <> 'RESOLVED'
         ) AS unresolved_comment_count

       FROM activity_functional_requirements fr

       JOIN institutional_modules m
         ON m.id = fr.module_id

       JOIN projects p
         ON p.id = m.project_id

       JOIN module_activities a
         ON a.id = fr.activity_id

       LEFT JOIN requirement_lifecycle rl
         ON rl.requirement_id = fr.id

       WHERE fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
         AND a.deleted_at IS NULL

         AND (
           $2 = 'ADMIN'
           OR EXISTS (
             SELECT 1
             FROM requirement_assignments assigned
             WHERE assigned.requirement_id = fr.id
               AND assigned.user_id = $1
               AND assigned.role_code = 'REVIEWER'
               AND assigned.revoked_at IS NULL
           )
         )

       ORDER BY
         m.display_order ASC,
         fr.display_order ASC,
         fr.id ASC`,
      [user.id, user.role_code]
    );

    return NextResponse.json({
      success: true,
      message: "Functional requirement reviews loaded successfully",
      data: result.rows,
      meta: {
        total: result.rowCount ?? result.rows.length,
      },
    });
  } catch (error) {
    console.error(
      "Failed to load functional requirement reviews:",
      error
    );

    return fail(
      "Unable to load functional requirement reviews",
      500
    );
  }
}