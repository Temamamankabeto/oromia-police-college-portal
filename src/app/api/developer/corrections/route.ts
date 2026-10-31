import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (user.role_code !== "DEVELOPER") {
    return fail("Developer access required", 403);
  }

  try {
    const result = await query(
      `SELECT
         fr.id::text AS requirement_id,
         fr.requirement_code,
         fr.title,
         fr.description,
         fr.acceptance_criteria,
         fr.status AS requirement_status,
         rl.lifecycle_status,
         ra.id::text AS assignment_id,
         ra.assigned_at,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', rc.id::text,
                 'comment_type', rc.comment_type,
                 'comment_text', rc.comment_text,
                 'resolution_status', rc.resolution_status,
                 'created_at', rc.created_at
               )
               ORDER BY rc.created_at, rc.id
             )
             FROM requirement_review_comments rc
             WHERE rc.requirement_id = fr.id
           ),
           '[]'::jsonb
         ) AS comments,
         COALESCE(
           (
             SELECT jsonb_agg(
               jsonb_build_object(
                 'id', c.id::text,
                 'comment_id', c.comment_id::text,
                 'proposed_title', c.proposed_title,
                 'proposed_description', c.proposed_description,
                 'proposed_acceptance_criteria',
                   c.proposed_acceptance_criteria,
                 'correction_explanation', c.correction_explanation,
                 'status', c.status,
                 'submitted_at', c.submitted_at,
                 'reviewed_at', c.reviewed_at,
                 'review_remarks', c.review_remarks,
                 'created_at', c.created_at
               )
               ORDER BY c.created_at DESC, c.id DESC
             )
             FROM requirement_corrections c
             WHERE c.requirement_id = fr.id
               AND (
                 c.status <> 'DRAFT'
                 OR c.developer_id = $1
               )
           ),
           '[]'::jsonb
         ) AS corrections
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
         AND ra.role_code = 'DEVELOPER'
         AND ra.revoked_at IS NULL
         AND fr.deleted_at IS NULL
         AND fr.is_active = TRUE
         AND m.deleted_at IS NULL
         AND m.is_active = TRUE
         AND p.deleted_at IS NULL
       ORDER BY fr.requirement_code, fr.id`,
      [user.id]
    );

    return NextResponse.json({
      success: true,
      message: "Developer correction workspace loaded successfully",
      data: result.rows,
      meta: {
        total_requirements: result.rows.length,
      },
    });
  } catch (error) {
    console.error("Failed to load developer workspace:", error);

    return fail("Unable to load developer correction workspace", 500);
  }
}