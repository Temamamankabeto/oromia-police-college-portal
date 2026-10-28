import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RecordRow = {
  module_id: string;
  module_code: string;
  module_title: string;
  module_description: string | null;
  activity_id: string | null;
  activity_code: string | null;
  activity_title: string | null;
  activity_description: string | null;
};

export async function GET() {
  try {
    const result = await query<RecordRow>(`
      SELECT
        m.id::text AS module_id,
        m.module_code,
        m.title AS module_title,
        m.description AS module_description,
        a.id::text AS activity_id,
        a.activity_code,
        a.title AS activity_title,
        a.description AS activity_description
      FROM institutional_modules m
      LEFT JOIN module_activities a
        ON a.module_id = m.id
        AND a.deleted_at IS NULL
        AND a.is_active = TRUE
      WHERE m.deleted_at IS NULL
        AND m.is_active = TRUE
      ORDER BY m.display_order, m.id, a.display_order, a.id
    `);

    const modules = new Map<string, {
      id: string;
      code: string;
      title: string;
      description: string | null;
      activities: {
        id: string;
        code: string | null;
        title: string;
        requirements: string | null;
      }[];
    }>();

    for (const row of result.rows) {
      if (!modules.has(row.module_id)) {
        modules.set(row.module_id, {
          id: row.module_id,
          code: row.module_code,
          title: row.module_title,
          description: row.module_description,
          activities: [],
        });
      }

      if (row.activity_id && row.activity_title) {
        modules.get(row.module_id)!.activities.push({
          id: row.activity_id,
          code: row.activity_code,
          title: row.activity_title,
          requirements: row.activity_description,
        });
      }
    }

    return NextResponse.json(
      { success: true, data: [...modules.values()] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Public requirements loading failed:", error);
    return NextResponse.json(
      { success: false, error: "Unable to load requirements" },
      { status: 500 }
    );
  }
}
