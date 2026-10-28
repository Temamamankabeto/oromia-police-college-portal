import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewRow = {
  module_id: string;
  module_code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  approval_status: string;
  current_revision: number;
  activity_count: number;
  comment_count: number;
  unresolved_comment_count: number;
  last_updated: string;
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

    const result = await query<ReviewRow>(`
      SELECT
        m.id::text AS module_id,
        m.module_code,
        m.title,
        m.description,
        m.is_active,

        COALESCE(
          r.approval_status,
          'PENDING'
        ) AS approval_status,

        COALESCE(
          r.current_revision,
          1
        ) AS current_revision,

        (
          SELECT COUNT(*)::integer
          FROM module_activities a
          WHERE a.module_id = m.id
            AND a.deleted_at IS NULL
        ) AS activity_count,

        (
          SELECT COUNT(*)::integer
          FROM module_comments c
          WHERE c.module_id = m.id
        ) AS comment_count,

        (
          SELECT COUNT(*)::integer
          FROM module_comments c
          WHERE c.module_id = m.id
            AND c.resolution_status <> 'RESOLVED'
        ) AS unresolved_comment_count,

        COALESCE(
          r.updated_at,
          m.updated_at
        ) AS last_updated

      FROM institutional_modules m

      LEFT JOIN module_reviews r
        ON r.module_id = m.id

      WHERE m.deleted_at IS NULL

      ORDER BY
        m.display_order ASC,
        m.id ASC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load proposal reviews:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load proposal reviews",
      },
      { status: 500 }
    );
  }
}
