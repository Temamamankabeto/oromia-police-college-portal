"use client";

import { useEffect, useState } from "react";

type Activity = {
  id: string;
  code: string | null;
  title: string;
  requirements: string | null;
};

type Module = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  activities: Activity[];
};

export default function PublicRequirementsExplorer() {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/public/requirements", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load modules");
        return response.json();
      })
      .then((result) => {
        if (!result.success) throw new Error("Unable to load modules");
        setModules(result.data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Loading failed");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="rounded-3xl bg-gradient-to-br from-blue-950 to-blue-700 p-6 text-white shadow-xl md:p-8">
      <h3 className="text-2xl font-bold">
        Institutional Modules & Requirements
      </h3>
      <p className="mt-2 text-sm text-blue-100">
        Expand a module and activity to view its recorded details.
      </p>

      <div className="mt-6 max-h-[650px] space-y-3 overflow-y-auto pr-1">
        {loading && <p>Loading institutional modules...</p>}
        {error && <p role="alert">{error}</p>}

        {!loading && !error && modules.length === 0 && (
          <p>No active institutional modules are available.</p>
        )}

        {modules.map((module) => (
          <details
            key={module.id}
            className="group rounded-xl bg-white/10"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold [&::-webkit-details-marker]:hidden">
              <span>{module.title}</span>
              <span className="shrink-0 transition-transform group-open:rotate-90">
                ▶
              </span>
            </summary>

            <div className="space-y-3 px-4 pb-4">
              {module.description && (
                <p className="text-sm text-blue-100">
                  {module.description}
                </p>
              )}

              {module.activities.length === 0 && (
                <p className="text-sm text-blue-100">
                  No activities recorded.
                </p>
              )}

              {module.activities.map((activity) => (
                <details
                  key={activity.id}
                  className="group/activity rounded-lg bg-white/10"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                    <span>{activity.title}</span>
                    <span className="shrink-0 transition-transform group-open/activity:rotate-90">
                      ▶
                    </span>
                  </summary>
                  <div className="border-t border-white/10 px-3 py-3 text-sm text-blue-100">
                    {activity.requirements?.trim() ||
                      "No requirement details recorded yet."}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
