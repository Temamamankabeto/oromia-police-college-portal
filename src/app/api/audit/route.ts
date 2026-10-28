import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireRole } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireRole(["ADMIN"]);

  if (!admin) {
    return NextResponse.json(
      { success: false, error: "Administrator access required" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const search = (params.get("search") || "").trim();
  const entityType = (params.get("entity_type") || "").trim();

  const pageRaw = params.get("page") || "1";
  const limitRaw = params.get("limit") || "20";

  if (
    search.length > 150 ||
    entityType.length > 100 ||
    !/^[1-9]\d*$/.test(pageRaw) ||
    !/^[1-9]\d*$/.test(limitRaw)
  ) {
    return NextResponse.json(
      { success: false, error: "Invalid audit filters" },
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
      WHERE
        ($1::text = '' OR l.entity_type = $1::text)
        AND (
          $2::text = ''
          OR l.action ILIKE '%' || $2::text || '%'
          OR l.entity_type ILIKE '%' || $2::text || '%'
          OR COALESCE(u.full_name, '') ILIKE '%' || $2::text || '%'
        )
    `;

    const totalResult = await query<{ total: number }>(
      `SELECT COUNT(*)::integer AS total
       FROM audit_logs l
       LEFT JOIN app_users u ON u.id = l.actor_id
       ${filters}`,
      [entityType, search]
    );

    const result = await query(
      `SELECT
         l.id::text AS id,
         l.action,
         l.entity_type,
         l.entity_id::text AS entity_id,
         l.actor_id::text AS actor_id,
         COALESCE(u.full_name, 'System') AS actor_name,
         l.old_values,
         l.new_values,
         l.created_at
       FROM audit_logs l
       LEFT JOIN app_users u ON u.id = l.actor_id
       ${filters}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $3 OFFSET $4`,
      [entityType, search, limit, offset]
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
    console.error("Audit history query failed:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load audit history" },
      { status: 500 }
    );
  }
}
