"use client";

import { useCallback, useEffect, useState } from "react";

type Role = "ADMIN" | "APPROVER";

type Proposal = {
  module_id: string;
  module_code: string;
  title: string;
  description: string | null;
  approval_status: string;
  current_revision: number;
  unresolved_comment_count: number;
};

type Decision = {
  id: string;
  decision: string;
  remarks: string | null;
  revision_number: number;
  created_at: string;
  decision_by_name: string;
};

export default function ApprovalsManager({
  role,
}: {
  role: Role;
}) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [history, setHistory] = useState<Decision[]>([]);
  const [decision, setDecision] = useState("APPROVED");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadProposals = useCallback(async () => {
    const response = await fetch("/api/reviews", {
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load proposals");
    }

    setProposals(result.data ?? []);
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function initialLoad() {
      try {
        const response = await fetch("/api/reviews", {
          cache: "no-store",
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load proposals");
        }

        if (!controller.signal.aborted) {
          setProposals(result.data ?? []);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load proposals"
          );
        }
      }
    }

    void initialLoad();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedId) return;

    const controller = new AbortController();

    async function loadHistory() {
      try {
        const response = await fetch(
          `/api/approvals/${selectedId}/history`,
          { cache: "no-store", signal: controller.signal }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load history");
        }

        if (!controller.signal.aborted) {
          setHistory(result.data ?? []);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load history"
          );
        }
      }
    }

    void loadHistory();

    return () => controller.abort();
  }, [selectedId]);

  const selected = proposals.find(
    proposal => proposal.module_id === selectedId
  );

  const awaiting = proposals.filter(
    proposal =>
      proposal.approval_status === "READY_FOR_APPROVAL"
  );

  async function submitDecision() {
    if (!selected) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/approvals/${selected.module_id}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, remarks }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Decision failed");
      }

      setMessage(result.message || "Decision recorded");
      setRemarks("");

      await loadProposals();

      const historyResponse = await fetch(
        `/api/approvals/${selected.module_id}/history`,
        { cache: "no-store" }
      );

      const historyResult = await historyResponse.json();

      if (historyResponse.ok && historyResult.success) {
        setHistory(historyResult.data ?? []);
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Decision failed"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Proposal Approvals</h1>
        <p className="text-sm text-slate-500">
          Review proposals, record decisions, and track approval history.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 p-5">
        <p className="text-sm text-slate-500">Awaiting Approval</p>
        <p className="text-3xl font-bold">{awaiting.length}</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}

      {message && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">
          {message}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <h2 className="mb-4 font-semibold">Proposals</h2>

          <div className="space-y-2">
            {proposals.map(proposal => (
              <button
                key={proposal.module_id}
                type="button"
                onClick={() => {
                  setSelectedId(proposal.module_id);
                  setMessage("");
                  setError("");
                }}
                className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50"
              >
                <p className="font-semibold">{proposal.title}</p>
                <p className="text-xs text-slate-500">
                  {proposal.module_code} ·{" "}
                  {proposal.approval_status.replaceAll("_", " ")}
                </p>
              </button>
            ))}

            {proposals.length === 0 && (
              <p className="text-sm text-slate-500">
                No proposals available.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">
              Select a proposal to view its approval details.
            </p>
          ) : (
            <div className="space-y-4">
              <h2 className="text-lg font-bold">{selected.title}</h2>

              <p className="whitespace-pre-wrap text-sm">
                {selected.description || "No description"}
              </p>

              <p className="text-sm">
                Status: <strong>
                  {selected.approval_status.replaceAll("_", " ")}
                </strong>
              </p>

              <p className="text-sm">
                Revision: {selected.current_revision}
              </p>

              {selected.approval_status === "READY_FOR_APPROVAL" && (
                <div className="space-y-3 border-t pt-4">
                  <label className="block text-sm font-semibold">
                    Approval Decision
                  </label>

                  <select
                    value={decision}
                    onChange={event => setDecision(event.target.value)}
                    className="w-full rounded-lg border p-2"
                  >
                    <option value="APPROVED">Approve</option>
                    <option value="REVISION_REQUESTED">
                      Request Revision
                    </option>
                    <option value="REJECTED">Reject</option>
                  </select>

                  <textarea
                    value={remarks}
                    onChange={event => setRemarks(event.target.value)}
                    maxLength={5000}
                    rows={3}
                    placeholder="Decision remarks"
                    className="w-full rounded-lg border p-3"
                  />

                  <button
                    type="button"
                    disabled={
                      busy ||
                      (decision !== "APPROVED" && !remarks.trim())
                    }
                    onClick={() => void submitDecision()}
                    className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? "Saving..." : "Submit Decision"}
                  </button>
                </div>
              )}

              <div className="border-t pt-4">
                <h3 className="mb-3 font-semibold">Decision History</h3>

                {history.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No decisions recorded.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {history.map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg border p-3 text-sm"
                      >
                        <p className="font-semibold">
                          {item.decision.replaceAll("_", " ")}
                        </p>
                        <p>{item.decision_by_name}</p>
                        <p>Revision {item.revision_number}</p>
                        {item.remarks && (
                          <p className="mt-2 whitespace-pre-wrap">
                            {item.remarks}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-400">
                Signed in as {role}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
