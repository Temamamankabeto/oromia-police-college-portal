"use client";

import { useCallback, useEffect, useState } from "react";

type Requirement = {
  requirement_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: string;
  lifecycle_status: string;
  module_code: string;
  module_name: string;
};
type ApiResponse<T> = { success: boolean; message: string; data: T; meta: unknown };

export default function DeveloperRequirementsManager() {
  const [items, setItems] = useState<Requirement[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [remarks, setRemarks] = useState("");
  const [evidence, setEvidence] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/developer/requirements", { cache: "no-store", signal });
      const payload = await response.json() as ApiResponse<Requirement[]>;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Unable to load requirements");
      setItems(payload.data);
      setSelectedId(previous => payload.data.some(item => item.requirement_id === previous) ? previous : (payload.data[0]?.requirement_id ?? ""));
      setError("");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Unable to load requirements");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();

    async function fetchRequirements() {
      await load(controller.signal);
    }

    void fetchRequirements();

    return () => controller.abort();
  }, [load]);
  const selected = items.find(item => item.requirement_id === selectedId);
  async function transition(action: "start" | "complete") {
    if (!selected || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/requirements/${selected.requirement_id}/development/${action}`, {
        method: "POST",
        headers: action === "complete" ? { "Content-Type": "application/json" } : undefined,
        body: action === "complete" ? JSON.stringify({ remarks: remarks.trim(), evidence: evidence.trim() }) : undefined,
      });
      const payload = await response.json() as ApiResponse<unknown>;
      if (!response.ok || !payload.success) throw new Error(payload.message || "Workflow action failed");
      setSuccess(payload.message); setRemarks(""); setEvidence("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workflow action failed"); }
    finally { setBusy(false); }
  }
  return (
    <section className="space-y-5">
      <header><h1 className="text-2xl font-bold text-slate-900">My Development Requirements</h1><p className="mt-1 text-sm text-slate-600">Start approved work and record completion evidence.</p></header>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
      {success && <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">{success}</div>}
      {loading ? <p>Loading assigned requirements...</p> : items.length === 0 ? <p className="rounded-lg bg-white p-5">No approved development requirements are assigned to you.</p> : (
        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-semibold">Assigned Requirements ({items.length})</h2><div className="space-y-2">{items.map(item => <button type="button" key={item.requirement_id} onClick={() => { setSelectedId(item.requirement_id); setRemarks(""); setEvidence(""); setSuccess(""); }} className={`w-full rounded-lg border p-3 text-left text-sm ${item.requirement_id === selectedId ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}><span className="block font-semibold">{item.requirement_code}</span><span className="mt-1 block">{item.title}</span><span className="mt-2 block text-xs font-semibold text-blue-700">{item.lifecycle_status.replaceAll("_", " ")}</span></button>)}</div></aside>
          {selected && <div className="space-y-4"><article className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-blue-700">{selected.module_code} â€” {selected.module_name}</p><h2 className="text-xl font-bold">{selected.title}</h2><p className="text-sm text-slate-500">{selected.requirement_code} Â· {selected.priority}</p></div><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">{selected.lifecycle_status.replaceAll("_", " ")}</span></div><h3 className="mt-5 font-semibold">Requirement Description</h3><p className="mt-2 whitespace-pre-wrap text-sm">{selected.description}</p><h3 className="mt-5 font-semibold">Acceptance Criteria</h3><p className="mt-2 whitespace-pre-wrap text-sm">{selected.acceptance_criteria || "Not specified"}</p></article>
            <article className="rounded-xl border border-slate-200 bg-white p-5"><h3 className="font-semibold">Development Actions</h3>{selected.lifecycle_status === "APPROVED" && <div className="mt-4"><p className="mb-3 text-sm text-slate-600">The requirement is approved and ready for implementation.</p><button type="button" disabled={busy} onClick={() => void transition("start")} className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Processing..." : "Start Development"}</button></div>}{selected.lifecycle_status === "UNDER_DEVELOPING" && <div className="mt-4 space-y-4"><p className="text-sm text-blue-800">Development is in progress. Provide completion details when implementation is finished.</p><label className="block text-sm font-medium">Completion Remarks<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3" maxLength={5000} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Describe the implemented functionality and verification performed" /></label><label className="block text-sm font-medium">Implementation Evidence<textarea className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-3" maxLength={5000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Commit reference, pull request, test results, or deployment artifact" /></label><button type="button" disabled={busy || remarks.trim().length < 10 || evidence.trim().length < 10} onClick={() => void transition("complete")} className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Processing..." : "Mark as Completed"}</button></div>}{selected.lifecycle_status === "DEVELOPED" && <p className="mt-4 rounded-lg bg-green-50 p-3 text-sm font-medium text-green-800">Development completed. Ready for the next workflow stage.</p>}</article>
          </div>}
        </div>
      )}
    </section>
  );
}