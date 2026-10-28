import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const result = await query<{
      total_modules: number;
      total_activities: number;
      pending_reviews: number;
      under_review: number;
      pending_approvals: number;
      approved: number;
      revision_requested: number;
      rejected: number;
      active_users: number;
    }>(
      `SELECT
         (
           SELECT COUNT(*)::integer
           FROM institutional_modules
           WHERE deleted_at IS NULL
         ) AS total_modules,

         (
           SELECT COUNT(*)::integer
           FROM module_activities a
           JOIN institutional_modules m ON m.id = a.module_id
           WHERE a.deleted_at IS NULL
             AND m.deleted_at IS NULL
         ) AS total_activities,

         (
           SELECT COUNT(*)::integer
           FROM institutional_modules m
           LEFT JOIN module_reviews r ON r.module_id = m.id
           WHERE m.deleted_at IS NULL
             AND COALESCE(r.approval_status, 'PENDING') = 'PENDING'
         ) AS pending_reviews,

         (
           SELECT COUNT(*)::integer
           FROM module_reviews r
           JOIN institutional_modules m ON m.id = r.module_id
           WHERE m.deleted_at IS NULL
             AND r.approval_status = 'UNDER_REVIEW'
         ) AS under_review,

         (
           SELECT COUNT(*)::integer
           FROM module_reviews r
           JOIN institutional_modules m ON m.id = r.module_id
           WHERE m.deleted_at IS NULL
             AND r.approval_status = 'READY_FOR_APPROVAL'
         ) AS pending_approvals,

         (
           SELECT COUNT(*)::integer
           FROM module_reviews r
           JOIN institutional_modules m ON m.id = r.module_id
           WHERE m.deleted_at IS NULL
             AND r.approval_status = 'APPROVED'
         ) AS approved,

         (
           SELECT COUNT(*)::integer
           FROM module_reviews r
           JOIN institutional_modules m ON m.id = r.module_id
           WHERE m.deleted_at IS NULL
             AND r.approval_status = 'REVISION_REQUESTED'
         ) AS revision_requested,

         (
           SELECT COUNT(*)::integer
           FROM module_reviews r
           JOIN institutional_modules m ON m.id = r.module_id
           WHERE m.deleted_at IS NULL
             AND r.approval_status = 'REJECTED'
         ) AS rejected,

         (
           SELECT COUNT(*)::integer
           FROM app_users
           WHERE is_active = TRUE
             AND deleted_at IS NULL
         ) AS active_users`
    );

    return NextResponse.json(
      {
        success: true,
        data: result.rows[0],
      },
      {
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    console.error("Dashboard statistics failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load dashboard statistics" },
      { status: 500 }
    );
  }
}
