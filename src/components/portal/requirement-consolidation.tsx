"use client";

import { useCallback, useEffect, useState } from "react";

type Correction = {
  id: string;
  status: string;
  proposed_title: string;
  proposed_description: string;
  proposed_acceptance_criteria: string | null;
};
type Version = {
  id: string;
  version_number: number;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  consolidation_remarks: string;
  correction_ids: string[];
  created_by_name: string;
  created_at: string;
};
type ApiResponse<T> = { success: boolean; message: string; data: T };
type Props = {
  requirementId: string;
  isLead: boolean;
  lifecycleStatus: string;
  originalTitle: string;
  originalDescription: string;
  originalAcceptanceCriteria: string | null;
  onApplied: () => Promise<void>;
};

export default function RequirementConsolidation({ requirementId, isLead, lifecycleStatus,
  originalTitle, originalDescription, originalAcceptanceCriteria, onApplied }: Props) {
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [title, setTitle] = useState(originalTitle);
  const [description, setDescription] = useState(originalDescription);
  const [criteria, setCriteria] = useState(originalAcceptanceCriteria ?? "");
  const [remarks, setRemarks] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    const base = `/api/requirements/${encodeURIComponent(requirementId)}`;
    const [correctionsResponse, versionsResponse] = await Promise.all([
      fetch(`${base}/corrections`, { cache: "no-store", signal }),
      fetch(`${base}/versions`, { cache: "no-store", signal }),
    ]);
    const correctionResult = (await correctionsResponse.json()) as ApiResponse<Correction[]>;
    const versionResult = (await versionsResponse.json()) as ApiResponse<Version[]>;
    if (!correctionsResponse.ok || !correctionResult.success || !Array.isArray(correctionResult.data)) {
      throw new Error(correctionResult.message || "Cannot load corrections");
    }
    if (!versionsResponse.ok || !versionResult.success || !Array.isArray(versionResult.data)) {
      throw new Error(versionResult.message || "Cannot load requirement versions");
    }
    setCorrections(correctionResult.data);
    setVersions(versionResult.data);
  }, [requirementId]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchHistory = async () => {
      try {
        await load(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Unable to load version history");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchHistory();
    return () => controller.abort();
  }, [load]);

  const applied = new Set(versions.flatMap(version => version.correction_ids));
  const accepted = corrections.filter(c => c.status === "ACCEPTED" && !applied.has(c.id));
  const pending = corrections.some(c => c.status === "DRAFT" || c.status === "SUBMITTED");
  const canApply = isLead && lifecycleStatus === "UNDER_REVIEW" && accepted.length > 0 && !pending;

  async function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canApply || busy || remarks.trim().length < 10 || !title.trim() || !description.trim()) return;
    if (!window.confirm(`Apply one consolidated version incorporating ${accepted.length} accepted correction(s)? This updates the functional requirement.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/requirements/${encodeURIComponent(requirementId)}/versions`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(),
          acceptance_criteria: criteria.trim() || null, consolidation_remarks: remarks.trim(),
          correction_ids: accepted.map(c => c.id) }),
      });
      const result = (await response.json()) as ApiResponse<Version>;
      if (!response.ok || !result.success) throw new Error(result.message || "Consolidation failed");
      await Promise.all([load(), onApplied()]);
      setRemarks("");
      setNotice(`Version ${result.data.version_number} applied successfully. Review the updated requirement above.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to apply consolidation");
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Requirement consolidation and version history" className="rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="text-lg font-semibold text-slate-900">Consolidation &amp; Version History</h3>
      <p className="mt-1 text-sm text-slate-600">The Lead Reviewer must combine all accepted corrections into one verified requirement before resolving comments.</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
      {loading ? <p className="mt-3 text-sm">Loading history...</p> : <>
        <div className="mt-4 space-y-3">
          <h4 className="font-semibold">Version history ({versions.length})</h4>
          {versions.length === 0 && <p className="text-sm text-slate-600">No applied versions yet. The original requirement will be preserved as version 1.</p>}
          {versions.map(version => (
            <details key={version.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-semibold">Version {version.version_number} — {version.title} · {version.created_by_name}</summary>
              <div className="mt-3 space-y-2 text-sm">
                <p className="whitespace-pre-wrap">{version.description}</p>
                <p className="whitespace-pre-wrap"><strong>Acceptance criteria:</strong> {version.acceptance_criteria || "Not specified"}</p>
                <p><strong>Corrections:</strong> {version.correction_ids.join(", ") || "Original snapshot"}</p>
                <p><strong>Remarks:</strong> {version.consolidation_remarks}</p>
                <p className="text-slate-500">{new Date(version.created_at).toLocaleString()}</p>
              </div>
            </details>
          ))}
        </div>
        {isLead && lifecycleStatus === "UNDER_REVIEW" && <form onSubmit={apply} className="mt-5 space-y-3 border-t pt-4">
          <h4 className="font-semibold">Prepare consolidated requirement</h4>
          <p className="text-sm text-slate-600">Accepted and unapplied correction IDs: {accepted.map(c => `#${c.id}`).join(", ") || "None"}</p>
          {pending && <p className="text-sm text-amber-800">Pending drafts or submitted corrections must be reviewed first.</p>}
          {accepted.map(c => <details key={c.id} className="rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer font-medium">Accepted correction #{c.id} — {c.proposed_title}</summary>
            <p className="mt-2 whitespace-pre-wrap">{c.proposed_description}</p>
            <p className="mt-2 whitespace-pre-wrap"><strong>Criteria:</strong> {c.proposed_acceptance_criteria}</p>
            <button type="button" disabled={busy} className="mt-2 rounded border px-3 py-1" onClick={() => {
              setTitle(c.proposed_title); setDescription(c.proposed_description);
              setCriteria(c.proposed_acceptance_criteria ?? "");
            }}>Use as editing starting point</button>
          </details>)}
          <label className="block text-sm font-medium">Consolidated title
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={255} required disabled={busy || !canApply} className="mt-1 w-full rounded border p-2" />
          </label>
          <label className="block text-sm font-medium">Consolidated description
            <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={20000} required rows={6} disabled={busy || !canApply} className="mt-1 w-full rounded border p-2" />
          </label>
          <label className="block text-sm font-medium">Consolidated acceptance criteria
            <textarea value={criteria} onChange={e => setCriteria(e.target.value)} maxLength={20000} rows={8} disabled={busy || !canApply} className="mt-1 w-full rounded border p-2" />
          </label>
          <label className="block text-sm font-medium">Lead Reviewer consolidation remarks (10–5000 characters)
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} minLength={10} maxLength={5000} required rows={3} disabled={busy || !canApply} className="mt-1 w-full rounded border p-2" />
          </label>
          <button type="submit" disabled={!canApply || busy || remarks.trim().length < 10} className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "Applying..." : `Apply consolidated version (${accepted.length} corrections)`}
          </button>
        </form>}
      </>}
    </section>
  );
}
