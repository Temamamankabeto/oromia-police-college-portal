"use client";

import { useCallback, useEffect, useState } from "react";

type Correction = {
  id: string;
  requirement_id: string;
  comment_id: string;
  comment_type: string;
  comment_text: string;
  developer_id: string;
  developer_name: string;
  proposed_title: string;
  proposed_description: string;
  proposed_acceptance_criteria: string | null;
  correction_explanation: string;
  status: "DRAFT" | "SUBMITTED" | "ACCEPTED" | "RETURNED";
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
  created_at: string;
  updated_at: string;
};

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
  meta: unknown;
};

type Props = {
  requirementId: string;
  isLead: boolean;
  lifecycleStatus: string;
  originalTitle: string;
  originalDescription: string;
  originalAcceptanceCriteria: string | null;
};

type Decision = "ACCEPTED" | "RETURNED";

function displayStatus(value: string) {
  return value.replaceAll("_", " ");
}

export default function LeadReviewerCorrections({
  requirementId,
  isLead,
  lifecycleStatus,
  originalTitle,
  originalDescription,
  originalAcceptanceCriteria,
}: Props) {
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>("ACCEPTED");
  const [remarks, setRemarks] = useState("");

  const loadCorrections = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/corrections`,
        {
          cache: "no-store",
          credentials: "same-origin",
          signal,
        }
      );

      const result =
        (await response.json()) as ApiResponse<Correction[]>;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to load requirement corrections."
        );
      }

      if (!Array.isArray(result.data)) {
        throw new Error("Invalid corrections API response.");
      }

      setCorrections(result.data);
    },
    [requirementId]
  );

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError("");
      setNotice("");
      setCorrections([]);
      setActiveId(null);
      setRemarks("");

      try {
        await loadCorrections(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load corrections."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [loadCorrections]);

  async function submitDecision(
    event: React.FormEvent<HTMLFormElement>,
    correctionId: string
  ) {
    event.preventDefault();

    const trimmedRemarks = remarks.trim();

    if (
      !isLead ||
      lifecycleStatus !== "UNDER_REVIEW" ||
      busy ||
      activeId !== correctionId ||
      trimmedRemarks.length < 10 ||
      trimmedRemarks.length > 2000
    ) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/corrections/${encodeURIComponent(correctionId)}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify({
            decision,
            review_remarks: trimmedRemarks,
          }),
        }
      );

      const result =
        (await response.json()) as ApiResponse<Correction>;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to verify correction."
        );
      }

      if (
        result.data?.id !== correctionId ||
        result.data.status !== decision
      ) {
        throw new Error(
          "Unexpected correction verification response."
        );
      }

      await loadCorrections();

      setActiveId(null);
      setRemarks("");
      setNotice(result.message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to verify correction."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Developer correction verification"
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Developer Correction Verification
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Compare submitted changes with the original requirement
            before accepting or returning a correction.
          </p>
        </div>

        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {corrections.length} Corrections
        </span>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800"
        >
          {notice}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">
          Loading corrections...
        </p>
      ) : corrections.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">
          No submitted corrections are available for this requirement.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {corrections.map((correction) => (
            <article
              key={correction.id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-slate-900">
                    Correction #{correction.id}
                  </h4>
                  <p className="mt-1 text-xs text-slate-600">
                    {displayStatus(correction.comment_type)}
                    {" | "}
                    Developer: {correction.developer_name}
                  </p>
                </div>

                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">
                  {displayStatus(correction.status)}
                </span>
              </div>

              <div className="mt-4 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Related Review Comment
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
                  {correction.comment_text}
                </p>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="min-w-0 rounded-lg border border-slate-200 p-4">
                  <h5 className="font-semibold text-slate-900">
                    Original Requirement
                  </h5>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Title
                  </p>
                  <p className="mt-1 break-words text-sm">
                    {originalTitle}
                  </p>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {originalDescription}
                  </p>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Acceptance Criteria
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {originalAcceptanceCriteria || "Not specified."}
                  </p>
                </div>

                <div className="min-w-0 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                  <h5 className="font-semibold text-blue-950">
                    Proposed Correction
                  </h5>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Title
                  </p>
                  <p className="mt-1 break-words text-sm">
                    {correction.proposed_title}
                  </p>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {correction.proposed_description}
                  </p>

                  <p className="mt-3 text-xs font-semibold text-slate-500">
                    Acceptance Criteria
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                    {correction.proposed_acceptance_criteria ||
                      "Not specified."}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Developer Explanation
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                  {correction.correction_explanation}
                </p>
              </div>

              {correction.reviewed_at && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold">
                    Lead Reviewer Decision
                  </p>
                  <p className="mt-2 text-sm">
                    {displayStatus(correction.status)}
                    {" by "}
                    {correction.reviewed_by_name || "Lead Reviewer"}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {correction.review_remarks}
                  </p>
                </div>
              )}

              {isLead &&
                lifecycleStatus === "UNDER_REVIEW" &&
                correction.status === "SUBMITTED" && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    {activeId !== correction.id ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setActiveId(correction.id);
                          setDecision("ACCEPTED");
                          setRemarks("");
                          setError("");
                        }}
                        className="rounded-lg border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                      >
                        Verify Correction
                      </button>
                    ) : (
                      <form
                        onSubmit={(event) =>
                          submitDecision(event, correction.id)
                        }
                        className="space-y-4"
                      >
                        <label className="block text-sm font-medium">
                          Verification Decision
                          <select
                            value={decision}
                            onChange={(event) =>
                              setDecision(
                                event.target.value as Decision
                              )
                            }
                            disabled={busy}
                            className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
                          >
                            <option value="ACCEPTED">
                              Accept Correction
                            </option>
                            <option value="RETURNED">
                              Return to Developer
                            </option>
                          </select>
                        </label>

                        <label className="block text-sm font-medium">
                          Review Remarks
                          <textarea
                            value={remarks}
                            onChange={(event) =>
                              setRemarks(event.target.value)
                            }
                            required
                            minLength={10}
                            maxLength={2000}
                            rows={4}
                            disabled={busy}
                            placeholder="Explain the correction verification decision..."
                            className="mt-1 block w-full rounded-lg border border-slate-300 p-3"
                          />
                        </label>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="submit"
                            disabled={
                              busy ||
                              remarks.trim().length < 10 ||
                              remarks.trim().length > 2000
                            }
                            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                          >
                            {busy
                              ? "Saving..."
                              : decision === "ACCEPTED"
                                ? "Accept Correction"
                                : "Return to Developer"}
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setActiveId(null);
                              setRemarks("");
                            }}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Accepting a correction records the Lead Reviewer decision.
        The original requirement is not modified automatically.
      </p>
    </section>
  );
}