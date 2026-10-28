"use client";

import { useCallback, useEffect, useState } from "react";

type Role = "ADMIN" | "REVIEWER" | "APPROVER";

type Comment = {
  id: string;
  author_name: string;
  comment_text: string;
  resolution_status: string;
  created_at: string;
};

type Props = {
  moduleId: string;
  status: string;
  role: Role;
  onChanged: () => void;
};

const resolutionOptions: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "RESOLVED"],
  IN_PROGRESS: ["RESOLVED", "REOPENED"],
  RESOLVED: ["REOPENED"],
  REOPENED: ["IN_PROGRESS", "RESOLVED"],
};

export default function ReviewActions({
  moduleId,
  status,
  role,
  onChanged,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [remarks, setRemarks] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canReview = role === "ADMIN" || role === "REVIEWER";
  const underReview = status === "UNDER_REVIEW";

  const loadComments = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/reviews/${moduleId}/comments`,
      { cache: "no-store", signal }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load comments");
    }

    if (!signal?.aborted) {
      setComments(result.data ?? []);
    }
  }, [moduleId]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/reviews/${moduleId}/comments`,
          {
            cache: "no-store",
            signal: controller.signal,
          }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(
            result.error || "Unable to load comments"
          );
        }

        if (!controller.signal.aborted) {
          setComments(result.data ?? []);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load comments"
          );
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [moduleId]);

  async function perform(
    path: string,
    method: "POST" | "PATCH",
    body?: Record<string, string>
  ) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(path, {
        method,
        headers: body
          ? { "Content-Type": "application/json" }
          : undefined,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Action failed");
      }

      setMessage(result.message || "Action completed");
      setCommentText("");
      setRemarks("");
      setChangeSummary("");

      await loadComments();
      onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Action failed"
      );
    } finally {
      setBusy(false);
    }
  }

  const base = `/api/reviews/${moduleId}`;

  return (
    <div className="mt-6 space-y-5 border-t border-slate-200 pt-5">
      <h4 className="text-lg font-bold">Review Actions & Comments</h4>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {message && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
          {message}
        </p>
      )}

      {canReview && status === "PENDING" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void perform(`${base}/start`, "POST")}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Start Review
        </button>
      )}

      {canReview && underReview && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              htmlFor="review-comment"
              className="block text-sm font-semibold"
            >
              Add Review Comment
            </label>
            <textarea
              id="review-comment"
              value={commentText}
              onChange={(event) =>
                setCommentText(event.target.value)
              }
              rows={3}
              maxLength={10000}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              placeholder="Enter your review comment"
            />
            <button
              type="button"
              disabled={busy || !commentText.trim()}
              onClick={() =>
                void perform(`${base}/comments`, "POST", {
                  comment_text: commentText.trim(),
                })
              }
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              Add Comment
            </button>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="revision-remarks"
              className="block text-sm font-semibold"
            >
              Revision Request Remarks
            </label>
            <textarea
              id="revision-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={2}
              maxLength={5000}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
            <button
              type="button"
              disabled={busy || !remarks.trim()}
              onClick={() =>
                void perform(`${base}/request-revision`, "POST", {
                  remarks: remarks.trim(),
                })
              }
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Request Revision
            </button>
          </div>

          <button
            type="button"
            disabled={
              busy ||
              comments.some(
                (comment) =>
                  comment.resolution_status !== "RESOLVED"
              )
            }
            onClick={() =>
              void perform(
                `${base}/submit-for-approval`,
                "POST"
              )
            }
            className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit for Approval
          </button>
        </div>
      )}

      {role === "ADMIN" &&
        status === "REVISION_REQUESTED" && (
          <div className="space-y-2">
            <label
              htmlFor="change-summary"
              className="block text-sm font-semibold"
            >
              Change Summary
            </label>
            <textarea
              id="change-summary"
              value={changeSummary}
              onChange={(event) =>
                setChangeSummary(event.target.value)
              }
              rows={3}
              maxLength={5000}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
              placeholder="Describe the corrections made"
            />
            <p className="text-xs text-slate-500">
              Update the proposal and its activities in
              Institutional Modules before resubmitting.
            </p>
            <button
              type="button"
              disabled={busy || !changeSummary.trim()}
              onClick={() =>
                void perform(`${base}/resubmit`, "POST", {
                  change_summary: changeSummary.trim(),
                })
              }
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Resubmit Proposal
            </button>
          </div>
        )}

      <div>
        <h5 className="mb-3 font-semibold">
          Review Comments ({comments.length})
        </h5>

        {comments.length === 0 ? (
          <p className="text-sm text-slate-500">
            No review comments yet.
          </p>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => (
              <div
                key={comment.id}
                className="rounded-lg border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">
                    {comment.author_name}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">
                    {comment.resolution_status.replaceAll("_", " ")}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                  {comment.comment_text}
                </p>

                {canReview && underReview && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(resolutionOptions[
                      comment.resolution_status
                    ] ?? []).map((nextStatus) => (
                      <button
                        key={nextStatus}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void perform(
                            `${base}/comments/${comment.id}/resolve`,
                            "PATCH",
                            { resolution_status: nextStatus }
                          )
                        }
                        className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
                      >
                        {nextStatus.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
