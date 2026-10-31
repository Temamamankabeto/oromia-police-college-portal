"use client";

import { useCallback, useEffect, useState } from "react";

type DecisionHistory = {
  id: string;
  from_status: string;
  to_status: string;
  remarks: string | null;
  actor_name: string;
  created_at: string;
  metadata: {
    decision?: string;
  } | null;
};

type Requirement = {
  requirement_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: string;
  requirement_status: string;
  lifecycle_status: string;
  module_code: string;
  module_name: string;
  assignment_id: string;
  decision_history: DecisionHistory[];
};

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
  meta: {
    total?: number;
    pending?: number;
  } | null;
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    REVIEWED: "bg-amber-100 text-amber-800",
    APPROVED: "bg-green-100 text-green-800",
    UNDER_REVIEW: "bg-blue-100 text-blue-800",
    UNDER_DEVELOPING: "bg-indigo-100 text-indigo-800",
    DEVELOPED: "bg-emerald-100 text-emerald-800",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
        styles[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default function RequirementApprovalsManager() {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = requirements.find(
    (requirement) => requirement.requirement_id === selectedId
  );

  const pendingCount = requirements.filter(
    (requirement) => requirement.lifecycle_status === "REVIEWED"
  ).length;

  const loadRequirements = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch("/api/requirement-approvals", {
        cache: "no-store",
        signal,
      });

      const result =
        (await response.json()) as ApiResponse<Requirement[]>;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to load assigned requirements."
        );
      }

      if (signal?.aborted) return;

      setRequirements(result.data);

      setSelectedId((current) =>
        current &&
        result.data.some((item) => item.requirement_id === current)
          ? current
          : result.data[0]?.requirement_id ?? null
      );
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();

    async function initialize() {
      try {
        await loadRequirements(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load approvals."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void initialize();

    return () => controller.abort();
  }, [loadRequirements]);

  async function submitDecision(
    decision: "APPROVED" | "RETURNED"
  ) {
    if (!selected || busy) return;

    const trimmedRemarks = remarks.trim();

    if (selected.lifecycle_status !== "REVIEWED") {
      setError("Only reviewed requirements can be decided.");
      return;
    }

    if (decision === "RETURNED" && trimmedRemarks.length < 10) {
      setError(
        "Provide at least 10 characters explaining why the requirement is returned."
      );
      return;
    }

    const confirmation =
      decision === "APPROVED"
        ? `Approve ${selected.requirement_code}? The assigned Developer will be able to start development.`
        : `Return ${selected.requirement_code} to the Lead Reviewer for correction?`;

    if (!window.confirm(confirmation)) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(
          selected.requirement_id
        )}/approval/decide`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            decision,
            remarks: trimmedRemarks,
          }),
        }
      );

      const result =
        (await response.json()) as ApiResponse<unknown>;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to process approval decision."
        );
      }

      setRemarks("");
      setMessage(result.message);
      await loadRequirements();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to process approval decision."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">
          Functional Requirement Approvals
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Review finalized requirements, approve implementation,
          or return requirements for correction.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <div className="rounded-lg bg-blue-50 px-4 py-3">
            <p className="text-xs text-blue-700">
              Assigned Requirements
            </p>
            <p className="text-2xl font-bold text-blue-950">
              {requirements.length}
            </p>
          </div>

          <div className="rounded-lg bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-700">
              Awaiting Decision
            </p>
            <p className="text-2xl font-bold text-amber-900">
              {pendingCount}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {message && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {message}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-slate-600">
          Loading assigned requirements...
        </div>
      ) : requirements.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-slate-600">
          No functional requirements are currently assigned to you.
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-4 font-semibold text-slate-900">
              Assigned Requirements
            </h2>

            {requirements.map((requirement) => (
              <button
                key={requirement.requirement_id}
                type="button"
                disabled={busy}
                onClick={() => {
                  setSelectedId(requirement.requirement_id);
                  setRemarks("");
                  setError("");
                  setMessage("");
                }}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selectedId === requirement.requirement_id
                    ? "border-blue-700 bg-blue-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <p className="text-xs font-semibold text-blue-900">
                  {requirement.requirement_code}
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {requirement.title}
                </p>
                <div className="mt-2">
                  <StatusBadge status={requirement.lifecycle_status} />
                </div>
              </button>
            ))}
          </aside>

          {selected && (
            <div className="min-w-0 space-y-5">
              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                      {selected.requirement_code}
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900">
                      {selected.title}
                    </h2>
                  </div>
                  <StatusBadge status={selected.lifecycle_status} />
                </div>

                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-slate-500">Module</dt>
                    <dd className="text-sm font-medium text-slate-900">
                      {selected.module_code} — {selected.module_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Priority</dt>
                    <dd className="text-sm font-medium text-slate-900">
                      {selected.priority}
                    </dd>
                  </div>
                </dl>

                <div className="mt-6">
                  <h3 className="font-semibold text-slate-900">
                    Requirement Description
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {selected.description}
                  </p>
                </div>

                <div className="mt-6">
                  <h3 className="font-semibold text-slate-900">
                    Acceptance Criteria
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    {selected.acceptance_criteria || "Not specified"}
                  </p>
                </div>
              </section>

              {selected.lifecycle_status === "REVIEWED" && (
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h3 className="text-lg font-semibold text-slate-900">
                    Approval Decision
                  </h3>

                  <label
                    htmlFor="approval-remarks"
                    className="mt-4 block text-sm font-medium text-slate-700"
                  >
                    Decision Remarks
                    <span className="ml-1 text-slate-500">
                      (required when returning)
                    </span>
                  </label>

                  <textarea
                    id="approval-remarks"
                    rows={4}
                    maxLength={5000}
                    disabled={busy}
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                    placeholder="Enter approval remarks or explain required corrections..."
                    className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                  />

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitDecision("APPROVED")}
                      className="rounded-lg bg-green-700 px-5 py-3 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-50"
                    >
                      {busy ? "Processing..." : "Approve Requirement"}
                    </button>

                    <button
                      type="button"
                      disabled={busy || remarks.trim().length < 10}
                      onClick={() => void submitDecision("RETURNED")}
                      className="rounded-lg bg-amber-600 px-5 py-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      Return for Correction
                    </button>
                  </div>
                </section>
              )}

              <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900">
                  Approval Decision History
                </h3>

                {selected.decision_history.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">
                    No approval decisions have been recorded.
                  </p>
                ) : (
                  <ol className="mt-4 space-y-4">
                    {selected.decision_history.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-slate-200 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge status={entry.to_status} />
                          <time className="text-xs text-slate-500">
                            {new Date(entry.created_at).toLocaleString()}
                          </time>
                        </div>

                        <p className="mt-2 text-sm font-medium text-slate-900">
                          {entry.actor_name}
                        </p>

                        {entry.remarks && (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            {entry.remarks}
                          </p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}