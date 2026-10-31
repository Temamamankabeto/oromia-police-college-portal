import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicRow = {
  project_id: string;
  project_code: string;
  project_title: string;
  project_description: string | null;
  module_id: string;
  module_code: string;
  module_title: string;
  module_description: string | null;
  activity_id: string;
  activity_code: string | null;
  activity_title: string;
  activity_description: string | null;
  requirement_id: string;
  requirement_code: string;
  requirement_title: string;
  requirement_description: string;
  acceptance_criteria: string | null;
  priority: string;
  lifecycle_status: string;
  approval_status: string;
};

type Requirement = {
  id: string;
  code: string;
  title: string;
  description: string;
  acceptanceCriteria: string | null;
  priority: string;
  status: string;
};
type Activity = {
  id: string;
  code: string | null;
  title: string;
  description: string | null;
  requirements: Requirement[];
};
type Module = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  activities: Activity[];
};
type ProjectProgress = {
  totalModules: number;
  completedModules: number;
  percentage: number;
};

type Project = {
  progress: ProjectProgress;
  id: string;
  code: string;
  title: string;
  description: string | null;
  modules: Module[];
};

export async function GET() {
  try {
    // Public endpoint: expose approved requirements only. Drafts, review notes,
    // corrections, assignments, audit records and private workflow data stay hidden.
    const result = await query<PublicRow>(`
      SELECT
        p.id::text AS project_id, p.project_code, p.title AS project_title,
        p.description AS project_description,
        m.id::text AS module_id, m.module_code, m.title AS module_title,
        m.description AS module_description,
        a.id::text AS activity_id, a.activity_code, a.title AS activity_title,
        a.description AS activity_description,
        r.id::text AS requirement_id, r.requirement_code,
        r.title AS requirement_title, r.description AS requirement_description,
        r.acceptance_criteria, r.priority,
        l.lifecycle_status, r.status AS approval_status
      FROM activity_functional_requirements r
      INNER JOIN requirement_lifecycle l ON l.requirement_id = r.id
      INNER JOIN module_activities a ON a.id = r.activity_id AND a.module_id = r.module_id
      INNER JOIN institutional_modules m ON m.id = r.module_id
      INNER JOIN projects p ON p.id = m.project_id
      WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE'
        AND m.deleted_at IS NULL AND m.is_active = TRUE
        AND a.deleted_at IS NULL AND a.is_active = TRUE
        AND r.deleted_at IS NULL AND r.is_active = TRUE
      ORDER BY p.title, p.id, m.display_order, m.id,
               a.display_order, a.id, r.display_order, r.id
    `);

    // Calculate completion against ALL active modules and ALL active requirements,
    // including unpublished ones. Never count an empty module as completed.
    const projectProgressResult = await query<{
      project_id: string;
      total_modules: number;
      completed_modules: number;
    }>(`
      WITH module_progress AS (
        SELECT m.project_id, m.id AS module_id,
          COUNT(r.id)::int AS requirement_count,
          COUNT(r.id) FILTER (
            WHERE r.status = 'APPROVED'
              AND l.lifecycle_status IN ('DEVELOPED', 'DEPLOYED', 'TESTED')
          )::int AS completed_requirement_count
        FROM institutional_modules m
        LEFT JOIN activity_functional_requirements r
          ON r.module_id = m.id
          AND r.deleted_at IS NULL AND r.is_active = TRUE
        LEFT JOIN requirement_lifecycle l ON l.requirement_id = r.id
        WHERE m.deleted_at IS NULL AND m.is_active = TRUE
        GROUP BY m.project_id, m.id
      )
      SELECT project_id::text AS project_id,
        COUNT(*)::int AS total_modules,
        COUNT(*) FILTER (
          WHERE requirement_count > 0
            AND requirement_count = completed_requirement_count
        )::int AS completed_modules
      FROM module_progress
      GROUP BY project_id
    `);
    const progressByProject = new Map(projectProgressResult.rows.map(row => [
      row.project_id,
      {
        totalModules: row.total_modules,
        completedModules: row.completed_modules,
        percentage: row.total_modules > 0
          ? Math.round((row.completed_modules / row.total_modules) * 1000) / 10
          : 0,
      },
    ]));

    const projects = new Map<string, Project>();
    const modules = new Map<string, Module>();
    const activities = new Map<string, Activity>();

    for (const row of result.rows) {
      let project = projects.get(row.project_id);
      if (!project) {
        project = {
          id: row.project_id, code: row.project_code,
          title: row.project_title, description: row.project_description, modules: [],
          progress: progressByProject.get(row.project_id) ?? {
            totalModules: 0, completedModules: 0, percentage: 0,
          },
        };
        projects.set(row.project_id, project);
      }

      let moduleEntry = modules.get(row.module_id);
      if (!moduleEntry) {
        moduleEntry = {
          id: row.module_id, code: row.module_code,
          title: row.module_title, description: row.module_description, activities: [],
        };
        modules.set(row.module_id, moduleEntry);
        project.modules.push(moduleEntry);
      }

      let activity = activities.get(row.activity_id);
      if (!activity) {
        activity = {
          id: row.activity_id, code: row.activity_code,
          title: row.activity_title, description: row.activity_description, requirements: [],
        };
        activities.set(row.activity_id, activity);
        moduleEntry.activities.push(activity);
      }

      activity.requirements.push({
        id: row.requirement_id, code: row.requirement_code,
        title: row.requirement_title, description: row.requirement_description,
        acceptanceCriteria: row.acceptance_criteria, priority: row.priority,
        status: row.lifecycle_status,
      });
    }

    return NextResponse.json(
      { success: true, message: "Requirements loaded", data: [...projects.values()], meta: { total: projects.size } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Public requirements loading failed:", error);
    return NextResponse.json(
      { success: false, message: "Unable to load requirements", data: [], meta: {} },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}


