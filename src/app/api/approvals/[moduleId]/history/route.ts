import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ moduleId: string }>;
};

export async function GET(
  _request: Request,
  context: Context
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Authentication required" },
      { status: 401 }
    );
  }

  const { moduleId } = await context.params;

  if (!/^[1-9]\d*$/.test(moduleId)) {
    return NextResponse.json(
      { success: false, error: "Invalid module ID" },
      { status: 400 }
    );
  }

  try {
    const result = await query(
      `SELECT
         d.id::text AS id,
         d.decision,
         d.remarks,
         d.revision_number,
         d.created_at,
         u.full_name AS decision_by_name
       FROM module_decisions d
       JOIN app_users u ON u.id = d.decision_by
       JOIN institutional_modules m ON m.id = d.module_id
       WHERE d.module_id = $1
         AND m.deleted_at IS NULL
       ORDER BY d.created_at DESC, d.id DESC`,
      [moduleId]
    );

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Decision history error:", error);

    return NextResponse.json(
      { success: false, error: "Unable to load decision history" },
      { status: 500 }
    );
  }
}
