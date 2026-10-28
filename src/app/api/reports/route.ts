import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statuses = new Set([
  "PENDING",
  "UNDER_REVIEW",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "REVISION_REQUESTED",
  "REJECTED",
]);

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const params = request.nextUrl.searchParams;
  const status = params.get("status") || "";
  const search = (params.get("search") || "").trim();

  const pageRaw = params.get("page") || "1";
  const limitRaw = params.get("limit") || "20";

  if (
    (status && !statuses.has(status)) ||
    search.length > 150 ||
    !/^[1-9]\d*$/.test(pageRaw) ||
    !/^[1-9]\d*$/.test(limitRaw)
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid report filters" },
      { status: 400 }
    );
  }

  const page = Number(pageRaw);
  const limit = Number(limitRaw);

  if (
    !Number.isSafeInteger(page) ||
    page > 100000 ||
    !Number.isSafeInteger(limit) ||
    limit > 100
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid pagination" },
      { status: 400 }
    );
  }

  const offset = (page - 1) * limit;

  try {
    const filters = `
      WHERE m.deleted_at IS NULL
        AND ($1::text = '' OR
          COALESCE(r.approval_status, 'PENDING') = $1::text)
        AND (
          $2::text = ''
          OR m.title ILIKE '%' || $2::text || '%'
          OR m.module_code ILIKE '%' || $2::text || '%'
        )
    `;

    const totalResult = await query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total
       FROM institutional_modules m
       LEFT JOIN module_reviews r ON r.module_id = m.id
       ${filters}`,
      [status, search]
    );

    const result = await query(
      `SELECT
         m.id::text AS module_id,
         m.module_code,
         m.title,
         m.is_active,
         COALESCE(r.approval_status, 'PENDING') AS approval_status,
         COALESCE(r.current_revision, 0) AS current_revision,
         r.approved_at,
         approver.full_name AS approved_by_name,

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

         (
           SELECT COUNT(*)::integer
           FROM module_decisions d
           WHERE d.module_id = m.id
         ) AS decision_count,

         m.updated_at
       FROM institutional_modules m
       LEFT JOIN module_reviews r ON r.module_id = m.id
       LEFT JOIN app_users approver ON approver.id = r.approved_by
       ${filters}
       ORDER BY m.display_order ASC, m.id ASC
       LIMIT $3 OFFSET $4`,
      [status, search, limit, offset]
    );

    return NextResponse.json(
      {
        success: true,
        data: result.rows,
        total: totalResult.rows[0].total,
        page,
        limit,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Reports query failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load reports" },
      { status: 500 }
    );
  }
}
