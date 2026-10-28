"use client";

import { useCallback, useEffect, useState } from "react";
import ReviewActions from "./review-actions";

type Role = "ADMIN" | "REVIEWER" | "APPROVER";

type Review = {
  module_id: string;
  module_code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  approval_status: string;
  current_revision: number;
  activity_count: number;
  comment_count: number;
  unresolved_comment_count: number;
  last_updated: string;
};

type Props = {
  role: Role;
};

const statuses = [
  "ALL",
  "PENDING",
  "UNDER_REVIEW",
  "READY_FOR_APPROVAL",
  "REVISION_REQUESTED",
  "APPROVED",
  "REJECTED",
];

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

function statusClass(status: string) {
  switch (status) {
    case "APPROVED":
      return "bg-green-100 text-green-800";
    case "UNDER_REVIEW":
      return "bg-blue-100 text-blue-800";
    case "READY_FOR_APPROVAL":
      return "bg-purple-100 text-purple-800";
    case "REVISION_REQUESTED":
      return "bg-amber-100 text-amber-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export default function ReviewsManager({ role }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReviews = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/reviews", {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "Unable to load proposal reviews"
        );
      }

      const rows: Review[] = result.data ?? [];

      setReviews(rows);
      setSelectedId((current) =>
        current && rows.some((row) => row.module_id === current)
          ? current
          : null
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load proposal reviews"
      );
    } finally {
      setLoading(false);
    }
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
          throw new Error(
            result.error || "Unable to load proposal reviews"
          );
        }

        if (!controller.signal.aborted) {
          setReviews(result.data ?? []);
          setLoading(false);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Unable to load proposal reviews"
          );
          setLoading(false);
        }
      }
    }

    void initialLoad();

    return () => controller.abort();
  }, []);

  const filtered = reviews.filter((review) => {
    const matchesStatus =
      filter === "ALL" || review.approval_status === filter;

    const term = search.trim().toLowerCase();

    const matchesSearch =
      !term ||
      review.title.toLowerCase().includes(term) ||
      review.module_code.toLowerCase().includes(term);

    return matchesStatus && matchesSearch;
  });

  const selected = reviews.find(
    (review) => review.module_id === selectedId
  );

  const underReview = reviews.filter(
    (review) => review.approval_status === "UNDER_REVIEW"
  ).length;

  const awaitingApproval = reviews.filter(
    (review) =>
      review.approval_status === "READY_FOR_APPROVAL"
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            Proposal Reviews
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Review institutional proposals and track corrections.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadReviews()}
          disabled={loading}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Total Proposals", reviews.length],
          ["Under Review", underReview],
          ["Awaiting Approval", awaitingApproval],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-bold text-blue-950">
              {value}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by proposal title or code"
            aria-label="Search proposals"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />

          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="Filter by review status"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-8 text-center text-slate-500">
            Loading proposals...
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-slate-500">
            No matching proposals found.
          </p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Proposal</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Revision</th>
                  <th className="px-3 py-3">Comments</th>
                  <th className="px-3 py-3">Action</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((review) => (
                  <tr
                    key={review.module_id}
                    className="border-b border-slate-100"
                  >
                    <td className="px-3 py-3 font-medium">
                      {review.module_code}
                    </td>
                    <td className="px-3 py-3">
                      {review.title}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusClass(review.approval_status)}`}
                      >
                        {statusLabel(review.approval_status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {review.current_revision}
                    </td>
                    <td className="px-3 py-3">
                      {review.unresolved_comment_count} unresolved
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedId(review.module_id)
                        }
                        className="font-medium text-blue-800 hover:underline"
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold">
                {selected.title}
              </h3>
              <p className="text-sm text-slate-500">
                {selected.module_code}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-sm text-slate-600 hover:underline"
            >
              Close
            </button>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">
            {selected.description || "No description provided."}
          </p>

          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <p>
              <strong>Status:</strong>{" "}
              {statusLabel(selected.approval_status)}
            </p>
            <p>
              <strong>Activities:</strong>{" "}
              {selected.activity_count}
            </p>
            <p>
              <strong>Revision:</strong>{" "}
              {selected.current_revision}
            </p>
          </div>

          <ReviewActions
            key={selected.module_id}
            moduleId={selected.module_id}
            status={selected.approval_status}
            role={role}
            onChanged={() => void loadReviews()}
          />
        </section>
      )}
    </div>
  );
}
