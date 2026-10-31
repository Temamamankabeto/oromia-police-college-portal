"use client";

import { useEffect, useState } from "react";

type ReportSummary = {
  projects: number;
  active_projects: number;
  completed_projects: number;
  modules: number;
  activities: number;
  requirements: number;
  pending_review: number;
  under_review: number;
  reviewed: number;
  approved: number;
  under_developing: number;
  developed: number;
  deployed: number;
  tested: number;
  test_passed: number;
  test_failed: number;
  test_blocked: number;
};

type SummaryResponse = {
  success: boolean;
  message?: string;
  data?: ReportSummary | null;
};

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

function percent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

function MetricCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number;
  subtitle?: string;
}) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
        {formatNumber(value)}
      </p>
      {subtitle && (
        <p className="mt-2 text-xs text-slate-500">{subtitle}</p>
      )}
    </article>
  );
}

function ProgressRow({
  title,
  value,
  total,
  color,
}: {
  title: string;
  value: number;
  total: number;
  color: string;
}) {
  const progress = percent(value, total);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-slate-700">{title}</span>
        <span className="tabular-nums text-slate-600">
          {formatNumber(value)} ({progress}%)
        </span>
      </div>

      <div
        className="h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

export default function ReportsDashboard() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSummary() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/reports/summary", {
          cache: "no-store",
          signal: controller.signal,
        });

        const result = (await response.json()) as SummaryResponse;

        if (!response.ok || !result.success || !result.data) {
          throw new Error(result.message || "Unable to load reports");
        }

        if (!controller.signal.aborted) {
          setSummary(result.data);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load report summary"
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadSummary();

    return () => controller.abort();
  }, [refreshKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Project Reports
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Project structure, functional requirements, approvals,
            development and testing performance.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setRefreshKey((value) => value + 1)}
          disabled={loading}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh Reports"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading && !summary && (
        <div
          role="status"
          className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500"
        >
          Loading project statistics...
        </div>
      )}

      {summary && (
        <>
          <section className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Project Overview
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard
                title="Total Projects"
                value={summary.projects}
                subtitle={`${formatNumber(summary.active_projects)} active projects`}
              />
              <MetricCard
                title="Completed Projects"
                value={summary.completed_projects}
              />
              <MetricCard
                title="Institutional Modules"
                value={summary.modules}
              />
              <MetricCard
                title="Module Activities"
                value={summary.activities}
              />
              <MetricCard
                title="Functional Requirements"
                value={summary.requirements}
              />
              <MetricCard
                title="Approved Requirements"
                value={summary.approved}
                subtitle="Includes subsequent development lifecycle stages"
              />
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">
                Review and Approval Progress
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Current functional requirement lifecycle.
              </p>

              <div className="mt-6 space-y-5">
                <ProgressRow
                  title="Pending Review"
                  value={summary.pending_review}
                  total={summary.requirements}
                  color="bg-slate-500"
                />
                <ProgressRow
                  title="Under Review"
                  value={summary.under_review}
                  total={summary.requirements}
                  color="bg-amber-500"
                />
                <ProgressRow
                  title="Reviewed - Awaiting Approval"
                  value={summary.reviewed}
                  total={summary.requirements}
                  color="bg-indigo-500"
                />
                <ProgressRow
                  title="Approved"
                  value={summary.approved}
                  total={summary.requirements}
                  color="bg-emerald-600"
                />
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">
                Development Progress
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Development completion includes developed, deployed
                and tested requirements.
              </p>

              <div className="mt-6 space-y-5">
                <ProgressRow
                  title="Under Developing"
                  value={summary.under_developing}
                  total={summary.requirements}
                  color="bg-amber-500"
                />
                <ProgressRow
                  title="Development Completed"
                  value={summary.developed}
                  total={summary.requirements}
                  color="bg-blue-600"
                />
                <ProgressRow
                  title="Deployed"
                  value={summary.deployed}
                  total={summary.requirements}
                  color="bg-violet-600"
                />
                <ProgressRow
                  title="Tested"
                  value={summary.tested}
                  total={summary.requirements}
                  color="bg-emerald-600"
                />
              </div>
            </section>
          </div>

          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Testing Results
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Recorded testing executions, including repeat tests.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                title="Passed Tests"
                value={summary.test_passed}
              />
              <MetricCard
                title="Failed Tests"
                value={summary.test_failed}
              />
              <MetricCard
                title="Blocked Tests"
                value={summary.test_blocked}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}