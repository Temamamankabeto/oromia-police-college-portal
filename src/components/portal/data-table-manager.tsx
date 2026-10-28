"use client";

import { useEffect, useMemo, useState } from "react";

type RecordRow = Record<string, unknown>;
type Mode = "reports" | "audit";

const statuses = [
  "PENDING",
  "UNDER_REVIEW",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "REVISION_REQUESTED",
  "REJECTED",
];

const reportColumns = [
  ["module_code", "Module Code"],
  ["title", "Module Title"],
  ["approval_status", "Status"],
  ["current_revision", "Revision"],
  ["activity_count", "Activities"],
  ["comment_count", "Comments"],
  ["unresolved_comment_count", "Unresolved"],
  ["decision_count", "Decisions"],
  ["approved_by_name", "Approved By"],
  ["approved_at", "Approved At"],
] as const;

const auditColumns = [
  ["created_at", "Date"],
  ["actor_name", "Actor"],
  ["action", "Action"],
  ["entity_type", "Entity Type"],
  ["entity_id", "Entity ID"],
] as const;

function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvValue(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  // Prevent spreadsheet formula execution on imported CSV files.
  if (/^[\s]*[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replaceAll('"', '""') + '"';
}

export default function DataTableManager({ mode }: { mode: Mode }) {
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<RecordRow | null>(null);

  const limit = 20;
  const columns = mode === "reports" ? reportColumns : auditColumns;
  const title = mode === "reports" ? "Institutional Reports" : "Audit History";

  const url = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });

    if (search) params.set("search", search);
    if (filter) {
      params.set(mode === "reports" ? "status" : "entity_type", filter);
    }

    return `/api/${mode}?${params.toString()}`;
  }, [mode, page, search, filter]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load records");
        }

        if (!controller.signal.aborted) {
          setRows(result.data);
          setTotal(result.total);
          setError("");
          setLoading(false);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Request failed");
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [url]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setPage(1);
    setSearch(searchInput.trim());
    setSelected(null);
  }

  async function exportCsv() {
    if (exporting) return;

    setExporting(true);
    setError("");

    try {
      const exported: RecordRow[] = [];
      let nextPage = 1;
      const batchSize = 100;
      const maxRows = 10000;

      while (exported.length < maxRows) {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: String(batchSize),
        });

        if (search) params.set("search", search);
        if (filter) {
          params.set(mode === "reports" ? "status" : "entity_type", filter);
        }

        const response = await fetch(`/api/${mode}?${params.toString()}`, {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Export request failed");
        }

        const batch = result.data as RecordRow[];
        exported.push(...batch);

        if (exported.length >= result.total || batch.length === 0) break;
        nextPage++;
      }

      if (exported.length >= maxRows && total > maxRows) {
        throw new Error(
          "Export exceeds 10,000 records. Narrow your filters before exporting."
        );
      }

      const csvColumns = mode === "audit"
        ? [
            ...auditColumns,
            ["old_values", "Old Values"],
            ["new_values", "New Values"],
          ] as const
        : reportColumns;

      const content = [
        csvColumns.map(column => csvValue(column[1])).join(","),
        ...exported.map(row =>
          csvColumns.map(column => csvValue(row[column[0]])).join(",")
        ),
      ].join("\r\n");

      const blob = new Blob(["\uFEFF", content], {
        type: "text/csv;charset=utf-8",
      });

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `opc-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {mode === "reports"
              ? "Track institutional modules, reviews and approvals."
              : "Review recorded system actions and changes."}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={exporting || loading}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export CSV"}
        </button>
      </div>

      <form
        onSubmit={applyFilters}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="flex-1 space-y-1 text-sm">
          <span className="font-medium">Search</span>
          <input
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
            maxLength={150}
            placeholder={
              mode === "reports"
                ? "Module code or title"
                : "Action, entity or actor"
            }
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="block font-medium">
            {mode === "reports" ? "Approval Status" : "Entity Type"}
          </span>
          {mode === "reports" ? (
            <select
              value={filter}
              onChange={event => {
                setFilter(event.target.value);
                setPage(1);
                setLoading(true);
              }}
              className="rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">All Statuses</option>
              {statuses.map(status => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={filter}
              onChange={event => setFilter(event.target.value)}
              maxLength={100}
              placeholder="All entity types"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
          )}
        </label>

        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-semibold text-white"
        >
          Apply
        </button>
      </form>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex justify-between border-b p-4 text-sm">
          <span className="font-semibold">{total} records</span>
          <span className="text-slate-500">
            Page {page} of {totalPages}
          </span>
        </div>

        {loading ? (
          <p className="p-6 text-sm text-slate-500">Loading records...</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">No matching records.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {columns.map(column => (
                    <th key={column[0]} className="whitespace-nowrap p-3">
                      {column[1]}
                    </th>
                  ))}
                  {mode === "audit" && <th className="p-3">Details</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={String(row.id ?? row.module_id ?? index)}
                    className="border-t"
                  >
                    {columns.map(column => (
                      <td key={column[0]} className="max-w-xs p-3">
                        <span className="block truncate" title={display(row[column[0]])}>
                          {display(row[column[0]])}
                        </span>
                      </td>
                    ))}
                    {mode === "audit" && (
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => setSelected(row)}
                          className="font-semibold text-blue-700 hover:underline"
                        >
                          View Changes
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t p-4">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => {
              setPage(value => value - 1);
              setLoading(true);
            }}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => {
              setPage(value => value + 1);
              setLoading(true);
            }}
            className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </section>

      {mode === "audit" && selected && (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between gap-3">
            <h2 className="text-lg font-bold">Audit Change Details</h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm font-semibold text-blue-700"
            >
              Close
            </button>
          </div>

          <p className="mt-2 text-sm text-slate-500">
            {display(selected.action)} — {display(selected.actor_name)}
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {(["old_values", "new_values"] as const).map(field => (
              <div key={field}>
                <h3 className="mb-2 text-sm font-semibold">
                  {field === "old_values" ? "Previous Values" : "New Values"}
                </h3>
                <pre className="max-h-80 overflow-auto rounded-lg bg-slate-100 p-4 text-xs">
                  {JSON.stringify(selected[field] ?? {}, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
