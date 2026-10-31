"use client";

import { useCallback, useEffect, useState } from "react";
import LeadReviewerCorrections from "./lead-reviewer-corrections";
import RequirementConsolidation from "./requirement-consolidation";

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
  module_title: string;
  activity_code: string;
  activity_title: string;
  is_lead: boolean;
  reviewer_count: number;
  comment_count: number;
  unresolved_comment_count: number;
};

type ReviewComment = {
  id: string;
  author_name: string;
  comment_type: string;
  comment_text: string;
  resolution_status: string;
  created_at: string;
};

type ResolutionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "REOPENED";

const resolutionTransitions: Record<
  ResolutionStatus,
  ResolutionStatus[]
> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED", "REOPENED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "RESOLVED"],
};

type ApiResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
};

const commentTypes = [
  "COMMENT",
  "FINDING",
  "RECOMMENDATION",
  "CHANGE_REQUEST",
] as const;

type CommentType = (typeof commentTypes)[number];

function label(value: string) {
  return value.replaceAll("_", " ");
}

export default function RequirementReviewsManager() {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [commentError, setCommentError] = useState("");
  const [notice, setNotice] = useState("");
  const [commentType, setCommentType] = useState<CommentType>("COMMENT");
  const [commentText, setCommentText] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionRemark, setResolutionRemark] = useState("");
  const [resolutionStatus, setResolutionStatus] =
    useState<ResolutionStatus>("IN_PROGRESS");

  const selected = requirements.find(
    (requirement) => requirement.requirement_id === selectedId
  );

  const loadRequirements = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/requirement-reviews", {
      cache: "no-store",
      signal,
    });

    const result = (await response.json()) as ApiResponse<Requirement[]>;

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Unable to load requirements.");
    }

    setRequirements(result.data);
    setSelectedId((current) =>
      current && result.data.some((item) => item.requirement_id === current)
        ? current
        : result.data[0]?.requirement_id ?? null
    );
  }, []);

  const loadComments = useCallback(
    async (requirementId: string, signal?: AbortSignal) => {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/review/comments`,
        { cache: "no-store", signal }
      );

      const result = (await response.json()) as ApiResponse<ReviewComment[]>;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load review comments.");
      }

      setComments(result.data);
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        await loadRequirements(controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load requirements."
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [loadRequirements]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }

    const requirementId = selectedId;
    const controller = new AbortController();

    async function load() {
      setCommentsLoading(true);
      setCommentError("");
      setComments([]);

      try {
        await loadComments(requirementId, controller.signal);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setCommentError(
            cause instanceof Error ? cause.message : "Unable to load comments."
          );
        }
      } finally {
        if (!controller.signal.aborted) setCommentsLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [selectedId, loadComments]);

  async function startReview() {
    if (!selected || busy || selected.lifecycle_status !== "ASSIGNED_FOR_REVIEW") {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(selected.requirement_id)}/review/start`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to start requirement review.");
      }

      setNotice(result.message || "Requirement review started successfully.");
      await loadRequirements();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to start review."
      );
    } finally {
      setBusy(false);
    }
  }
  async function updateResolution(
    event: React.FormEvent<HTMLFormElement>,
    commentId: string
  ) {
    event.preventDefault();

    if (!selected || busy || resolutionRemark.trim().length < 10) {
      return;
    }

    const requirementId = selected.requirement_id;

    setBusy(true);
    setCommentError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/review/comments/${encodeURIComponent(commentId)}/resolve`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            resolution_status: resolutionStatus,
            resolution_remark: resolutionRemark.trim(),
          }),
        }
      );

      const result = (await response.json()) as ApiResponse<unknown>;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to update comment status.");
      }

      setResolvingId(null);
      setResolutionRemark("");
      setNotice("Comment resolution status updated successfully.");

      await Promise.all([
        loadComments(requirementId),
        loadRequirements(),
      ]);
    } catch (cause) {
      setCommentError(
        cause instanceof Error
          ? cause.message
          : "Unable to update comment status."
      );
    } finally {
      setBusy(false);
    }
  }

  async function finalizeReview() {
    if (
      !selected ||
      !selected.is_lead ||
      selected.lifecycle_status !== "UNDER_REVIEW" ||
      selected.unresolved_comment_count !== 0 ||
      busy ||
      commentsLoading
    ) {
      return;
    }

    const requirementId = selected.requirement_id;

    if (
      !window.confirm(
        `Finalize review for ${selected.requirement_code}? This will move the requirement to REVIEWED.`
      )
    ) {
      return;
    }

    setBusy(true);
    setCommentError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(requirementId)}/review/finalize`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result = (await response.json()) as ApiResponse<unknown>;

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to finalize requirement review."
        );
      }

      await loadRequirements();

      setResolvingId(null);
      setResolutionRemark("");
      setNotice("Requirement review finalized successfully.");
    } catch (cause) {
      setCommentError(
        cause instanceof Error
          ? cause.message
          : "Unable to finalize requirement review."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selected || busy || !commentText.trim()) return;

    setBusy(true);
    setCommentError("");
    setNotice("");

    try {
      const response = await fetch(
        `/api/requirements/${encodeURIComponent(selected.requirement_id)}/review/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            comment_type: commentType,
            comment_text: commentText.trim(),
          }),
        }
      );

      const result = (await response.json()) as ApiResponse<ReviewComment>;

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to submit comment.");
      }

      setCommentText("");
      setNotice("Review comment submitted successfully.");
      await Promise.all([
        loadComments(selected.requirement_id),
        loadRequirements(),
      ]);
    } catch (cause) {
      setCommentError(
        cause instanceof Error ? cause.message : "Unable to submit comment."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">
          Functional Requirement Reviews
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Review assigned requirements and record findings or recommendations.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-600">Loading requirements...</p>
      ) : requirements.length === 0 ? (
        <p className="rounded-xl border bg-white p-6 text-sm text-slate-600">
          No functional requirements are assigned to your account.
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(250px,1fr)_minmax(0,2fr)]">
          <aside className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 font-semibold">Assigned Requirements</h2>

            {requirements.map((requirement) => (
              <button
                key={requirement.requirement_id}
                type="button"
                onClick={() => {
                  setSelectedId(requirement.requirement_id);
                  setNotice("");
                  setCommentText("");
                }}
                aria-pressed={selectedId === requirement.requirement_id}
                className={`w-full rounded-lg border p-3 text-left text-sm ${
                  selectedId === requirement.requirement_id
                    ? "border-blue-700 bg-blue-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="block font-semibold">
                  {requirement.requirement_code}
                </span>
                <span className="mt-1 block">{requirement.title}</span>
                <span className="mt-2 block text-xs text-slate-500">
                  {label(requirement.lifecycle_status)}
                  {requirement.is_lead ? " · Lead Reviewer" : ""}
                </span>
              </button>
            ))}
          </aside>

          {selected && (
            <div className="min-w-0 space-y-5">
              <article className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-blue-800">
                      {selected.module_code} / {selected.activity_code}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">
                      {selected.requirement_code} — {selected.title}
                    </h2>
                  </div>
                  <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                    {label(selected.lifecycle_status)}
                  </span>
                </div>

                <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
                  {selected.description}
                </p>

                <h3 className="mt-5 text-sm font-semibold">
                  Acceptance Criteria
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                  {selected.acceptance_criteria || "Not specified."}
                </p>

                <p className="mt-4 text-xs text-slate-500">
                  Priority: {selected.priority} · Assigned Reviewers:{" "}
                  {selected.reviewer_count}
                  {selected.is_lead ? " · You are the Lead Reviewer" : ""}
                </p>
              </article>

              {selected.lifecycle_status === "ASSIGNED_FOR_REVIEW" && (
                <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
                  <h3 className="font-semibold text-blue-950">
                    Start Functional Requirement Review
                  </h3>
                  <p className="mt-2 text-sm text-blue-800">
                    Begin reviewing this assigned requirement before finalization.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void startReview()}
                    className="mt-4 rounded-lg bg-blue-700 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {busy ? "Starting..." : "Start Review"}
                  </button>
                </section>
              )}
              <LeadReviewerCorrections
                key={selected.requirement_id}
                requirementId={selected.requirement_id}
                isLead={selected.is_lead}
                lifecycleStatus={selected.lifecycle_status}
                originalTitle={selected.title}
                originalDescription={selected.description}
                originalAcceptanceCriteria={selected.acceptance_criteria}
              />

              <RequirementConsolidation
                key={selected.requirement_id}
                requirementId={selected.requirement_id}
                isLead={selected.is_lead}
                lifecycleStatus={selected.lifecycle_status}
                originalTitle={selected.title}
                originalDescription={selected.description}
                originalAcceptanceCriteria={selected.acceptance_criteria}
                onApplied={async () => { await loadRequirements(); }}
              />

              <section className="rounded-xl border border-slate-200 bg-white p-5">
                <h3 className="text-lg font-semibold">
                  Review Comments ({selected.comment_count})
                </h3>

                {commentError && (
                  <p role="alert" className="mt-3 text-sm text-red-700">
                    {commentError}
                  </p>
                )}

                {commentsLoading ? (
                  <p className="mt-3 text-sm text-slate-500">
                    Loading comments...
                  </p>
                ) : comments.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No review comments yet.
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {comments.map((comment) => (
                      <article
                        key={comment.id}
                        className="rounded-lg border border-slate-200 p-4"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <strong className="text-sm">
                            {comment.author_name}
                          </strong>
                          <span className="text-xs text-slate-500">
                            {label(comment.comment_type)} ·{" "}
                            {label(comment.resolution_status)}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                          {comment.comment_text}
                        </p>

                        {selected.is_lead &&
                          selected.lifecycle_status === "UNDER_REVIEW" &&
                          resolutionTransitions[
                            comment.resolution_status as ResolutionStatus
                          ]?.length > 0 && (
                            <div className="mt-4 border-t border-slate-200 pt-3">
                              {resolvingId !== comment.id ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => {
                                    const current =
                                      comment.resolution_status as ResolutionStatus;
                                    setResolvingId(comment.id);
                                    setResolutionRemark("");
                                    setResolutionStatus(
                                      resolutionTransitions[current][0]
                                    );
                                    setCommentError("");
                                  }}
                                  className="rounded-lg border border-blue-700 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50"
                                >
                                  Update Resolution
                                </button>
                              ) : (
                                <form
                                  onSubmit={(event) =>
                                    updateResolution(event, comment.id)
                                  }
                                  className="space-y-3"
                                >
                                  <label className="block text-sm font-medium">
                                    New Status
                                    <select
                                      value={resolutionStatus}
                                      onChange={(event) =>
                                        setResolutionStatus(
                                          event.target.value as ResolutionStatus
                                        )
                                      }
                                      className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
                                    >
                                      {resolutionTransitions[
                                        comment.resolution_status as ResolutionStatus
                                      ].map((status) => (
                                        <option key={status} value={status}>
                                          {label(status)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label className="block text-sm font-medium">
                                    Resolution Remark
                                    <textarea
                                      value={resolutionRemark}
                                      onChange={(event) =>
                                        setResolutionRemark(event.target.value)
                                      }
                                      required
                                      minLength={10}
                                      maxLength={2000}
                                      rows={3}
                                      placeholder="Explain the resolution decision..."
                                      className="mt-1 block w-full rounded-lg border border-slate-300 p-3"
                                    />
                                  </label>

                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="submit"
                                      disabled={
                                        busy ||
                                        resolutionRemark.trim().length < 10
                                      }
                                      className="rounded-lg bg-blue-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                                    >
                                      {busy ? "Saving..." : "Save Resolution"}
                                    </button>

                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() => {
                                        setResolvingId(null);
                                        setResolutionRemark("");
                                      }}
                                      className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold"
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

                {selected.is_lead &&
                  selected.lifecycle_status === "UNDER_REVIEW" && (
                    <section
                      aria-label="Review finalization"
                      className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4"
                    >
                      <h4 className="font-semibold text-slate-900">
                        Lead Reviewer Finalization
                      </h4>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs text-slate-500">
                            Total Comments
                          </p>
                          <p className="mt-1 text-2xl font-semibold">
                            {selected.comment_count}
                          </p>
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-xs text-slate-500">
                            Unresolved Comments
                          </p>
                          <p className="mt-1 text-2xl font-semibold">
                            {selected.unresolved_comment_count}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={finalizeReview}
                        disabled={
                          busy ||
                          commentsLoading ||
                          selected.unresolved_comment_count !== 0
                        }
                        className="mt-4 w-full rounded-lg bg-blue-900 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? "Processing..." : "Finalize Review"}
                      </button>

                      {selected.unresolved_comment_count > 0 && (
                        <p className="mt-2 text-sm text-amber-800">
                          Resolve all outstanding review comments before
                          finalization.
                        </p>
                      )}
                    </section>
                  )}
                {selected.lifecycle_status === "UNDER_REVIEW" && (
                  <form onSubmit={submitComment} className="mt-6 space-y-4 border-t pt-5">
                    <h4 className="font-semibold">Add Review Comment</h4>

                    <label className="block text-sm font-medium">
                      Comment Type
                      <select
                        value={commentType}
                        onChange={(event) =>
                          setCommentType(event.target.value as CommentType)
                        }
                        className="mt-1 block w-full rounded-lg border border-slate-300 p-2"
                      >
                        {commentTypes.map((type) => (
                          <option key={type} value={type}>
                            {label(type)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-sm font-medium">
                      Review Comment
                      <textarea
                        value={commentText}
                        onChange={(event) => setCommentText(event.target.value)}
                        required
                        maxLength={10000}
                        rows={4}
                        className="mt-1 block w-full rounded-lg border border-slate-300 p-3"
                        placeholder="Enter findings or recommendations..."
                      />
                    </label>

                    <button
                      type="submit"
                      disabled={busy || !commentText.trim()}
                      className="rounded-lg bg-blue-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "Submitting..." : "Submit Comment"}
                    </button>
                  </form>
                )}

                {notice && (
                  <p role="status" className="mt-3 text-sm text-green-700">
                    {notice}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
