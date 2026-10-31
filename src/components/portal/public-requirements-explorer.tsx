"use client";

import { useEffect, useState } from "react";

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
type Project = {
  progress: {
    totalModules: number;
    completedModules: number;
    percentage: number;
  };
  id: string;
  code: string;
  title: string;
  description: string | null;
  modules: Module[];
};

type ApiResult = { success: boolean; message?: string; data?: Project[] };

const statusStyles: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-700",
  ASSIGNED_FOR_REVIEW: "bg-sky-100 text-sky-800",
  UNDER_REVIEW: "bg-amber-100 text-amber-800",
  REVIEWED: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-blue-100 text-blue-800",
  UNDER_DEVELOPING: "bg-orange-100 text-orange-800",
  DEVELOPED: "bg-emerald-100 text-emerald-800",
  DEPLOYED: "bg-violet-100 text-violet-800",
  TESTED: "bg-teal-100 text-teal-800",
};

function RequirementStatus({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const style = statusStyles[normalized] ?? "bg-slate-100 text-slate-700";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}
      aria-label={`Requirement status: ${normalized.replaceAll("_", " ")}`}
    >
      {normalized.replaceAll("_", " ")}
    </span>
  );
}

function Branch({
  title, subtitle, count, status, level, expanded, onToggle, children,
}: {
  title: string;
  subtitle?: string | null;
  count?: number;
  status?: string;
  level: number;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={level > 0 ? "relative ml-4 border-l-2 border-blue-200 pl-4 before:absolute before:left-0 before:top-5 before:w-4 before:border-t-2 before:border-blue-200" : ""}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl border border-blue-100 bg-white px-3 py-3 text-left text-slate-900 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-800 transition-transform ${expanded ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold">{title}</span>
          {subtitle && <span className="mt-0.5 block text-xs text-slate-500">{subtitle}</span>}
        </span>
        {status && <RequirementStatus status={status} />}
        {count !== undefined && <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">{count}</span>}
      </button>
      {expanded && <div className="space-y-3 pt-3">{children}</div>}
    </div>
  );
}

export default function PublicRequirementsExplorer() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/public/requirements", {
          cache: "no-store", signal: controller.signal,
        });
        const result = (await response.json()) as ApiResult;
        if (!response.ok || !result.success || !Array.isArray(result.data)) {
          throw new Error(result.message || "Unable to load published requirements");
        }
        if (!controller.signal.aborted) setProjects(result.data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load requirements");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();

    const refreshInterval = window.setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, 30000);

    return () => {
      controller.abort();
      window.clearInterval(refreshInterval);
    };
  }, []);

  function isOpen(id: string) {
    return open[id] ?? expandAll;
  }
  function toggle(id: string) {
    setOpen((previous) => ({ ...previous, [id]: !isOpen(id) }));
  }
  function setAll(value: boolean) {
    setExpandAll(value);
    setOpen({});
  }

  const requirementCount = projects.reduce(
    (total, project) => total + project.modules.reduce(
      (moduleTotal, module) => moduleTotal + module.activities.reduce(
        (activityTotal, activity) => activityTotal + activity.requirements.length, 0
      ), 0
    ), 0
  );

  return (
    <section aria-labelledby="public-explorer-title" className="min-w-0 rounded-3xl border border-blue-100 bg-white p-5 text-slate-900 shadow-xl md:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="public-explorer-title" className="text-xl font-bold text-blue-950 md:text-2xl">Projects, Modules, Activities &amp; Requirements</h3>

        </div>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-900">{requirementCount} approved</span>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => setAll(true)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-50">Expand All</button>
        <button type="button" onClick={() => setAll(false)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-900 hover:bg-blue-50">Collapse All</button>
      </div>
      <div className="mt-5 max-h-[680px] space-y-4 overflow-y-auto pr-1" aria-live="polite">
        {loading && <p className="py-6 text-sm text-slate-500">Loading published requirements...</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!loading && !error && projects.length === 0 && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No approved functional requirements are currently published.</p>}
        {projects.map((project) => (
          <Branch key={project.id} level={0} title={`${project.code} — ${project.title}`} subtitle={project.description} count={project.modules.length} expanded={isOpen(`p:${project.id}`)} onToggle={() => toggle(`p:${project.id}`)}>
            <div className="ml-1 rounded-xl border border-blue-100 bg-blue-50/70 p-4" aria-label={`Project completion ${project.progress.percentage}%`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-blue-950">Project completion</span>
                <span className="font-bold tabular-nums text-blue-900">{project.progress.percentage}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-blue-100" role="progressbar" aria-label="Module completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress.percentage}>
                <div className="h-full rounded-full bg-blue-700 transition-all" style={{ width: `${project.progress.percentage}%` }} />
              </div>
              <p className="mt-2 text-xs text-slate-600">{project.progress.completedModules} of {project.progress.totalModules} active modules completed</p>
            </div>
            {project.modules.map((module) => (
              <Branch key={module.id} level={1} title={`${module.code} — ${module.title}`} subtitle={module.description} count={module.activities.length} expanded={isOpen(`m:${module.id}`)} onToggle={() => toggle(`m:${module.id}`)}>
                {module.activities.map((activity) => (
                  <Branch key={activity.id} level={2} title={`${activity.code ? `${activity.code} — ` : ""}${activity.title}`} subtitle={activity.description} count={activity.requirements.length} expanded={isOpen(`a:${activity.id}`)} onToggle={() => toggle(`a:${activity.id}`)}>
                    {activity.requirements.map((requirement) => (
                      <Branch key={requirement.id} level={3} title={`${requirement.code} — ${requirement.title}`} subtitle={`${requirement.priority} priority`} status={requirement.status} expanded={isOpen(`r:${requirement.id}`)} onToggle={() => toggle(`r:${requirement.id}`)}>
                        <div className="ml-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                          <h4 className="font-semibold text-blue-950">Requirement description</h4>
                          <p className="mt-1 whitespace-pre-wrap break-words">{requirement.description}</p>
                          {requirement.acceptanceCriteria && <><h4 className="mt-4 font-semibold text-blue-950">Acceptance criteria</h4><p className="mt-1 whitespace-pre-wrap break-words">{requirement.acceptanceCriteria}</p></>}
                        </div>
                      </Branch>
                    ))}
                  </Branch>
                ))}
              </Branch>
            ))}
          </Branch>
        ))}
      </div>
    </section>
  );
}
