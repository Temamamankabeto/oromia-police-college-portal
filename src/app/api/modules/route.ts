import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InstitutionalModule = {
  id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

export async function GET() {
  try {
    const result = await query<InstitutionalModule>(`
      SELECT
        id,
        module_code,
        title,
        description,
        display_order,
        is_active
      FROM institutional_modules
      WHERE deleted_at IS NULL
      ORDER BY display_order ASC, id ASC
    `);

    return NextResponse.json({
      success: true,
      data: result.rows,
      total: result.rowCount,
    });
  } catch (error) {
    console.error("Failed to load institutional modules:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load institutional modules",
      },
      { status: 500 }
    );
  }
}
