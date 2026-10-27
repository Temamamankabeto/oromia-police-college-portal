import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ModuleActivity = {
  id: string;
  module_id: string;
  activity_code: string | null;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type RouteContext = {
  params: Promise<{ moduleId: string }>;
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { moduleId } = await context.params;

  if (!/^[1-9]\d*$/.test(moduleId)) {
    return NextResponse.json(
      { success: false, error: "Invalid module ID" },
      { status: 400 }
    );
  }

  try {
    const result = await query<ModuleActivity>(
      `
      SELECT
        id,
        module_id,
        activity_code,
        title,
        description,
        display_order,
        is_active
      FROM module_activities
      WHERE module_id = $1
        AND deleted_at IS NULL
      ORDER BY display_order ASC, id ASC
      `,
      [moduleId]
    );

    return NextResponse.json({
      success: true,
      module_id: moduleId,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load module activities:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load module activities",
      },
      { status: 500 }
    );
  }
}
