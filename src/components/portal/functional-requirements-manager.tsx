"use client";

import { useCallback, useEffect, useState } from "react";

type Requirement = {
  id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  display_order: number;
  is_active: boolean;
};

type RequirementForm = {
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  priority: Requirement["priority"];
  display_order: string;
  is_active: boolean;
};

const emptyForm: RequirementForm = {
  requirement_code: "",
  title: "",
  description: "",
  acceptance_criteria: "",
  priority: "MEDIUM",
  display_order: "0",
  is_active: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";

export default function FunctionalRequirementsManager({
  moduleId,
  activityId,
  activityTitle,
  canManage,
}: {
  moduleId: string;
  activityId: string;
  activityTitle: string;
  canManage: boolean;
}) {
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [editing, setEditing] = useState<Requirement | null>(null);
  const [form, setForm] = useState<RequirementForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const baseUrl =
    `/api/modules/${moduleId}/activities/${activityId}/requirements`;

  const loadRequirements = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/modules/${moduleId}/activities/${activityId}/requirements`,
      { cache: "no-store", credentials: "same-origin", signal }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load requirements");
    }

    setRequirements(result.data);
  }, [moduleId, activityId]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        await loadRequirements(controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unable to load requirements"
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [loadRequirements]);

  function create() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function edit(item: Requirement) {
    if (item.status !== "DRAFT") return;

    setEditing(item);
    setForm({
      requirement_code: item.requirement_code,
      title: item.title,
      description: item.description,
      acceptance_criteria: item.acceptance_criteria || "",
      priority: item.priority,
      display_order: String(item.display_order),
      is_active: item.is_active,
    });
    setShowForm(true);
    setError("");
    setNotice("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const order = Number(form.display_order);

      if (!Number.isSafeInteger(order) || order < 0 || order > 100000) {
        throw new Error("Invalid display order");
      }

      const response = await fetch(
        editing ? `${baseUrl}/${editing.id}` : baseUrl,
        {
          method: editing ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirement_code: form.requirement_code.trim().toUpperCase(),
            title: form.title.trim(),
            description: form.description.trim(),
            acceptance_criteria: form.acceptance_criteria.trim(),
            priority: form.priority,
            display_order: order,
            is_active: form.is_active,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save requirement");
      }

      setShowForm(false);
      setEditing(null);
      await loadRequirements();
      setNotice("Functional requirement saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Requirement) {
    if (!canManage || saving || item.status !== "DRAFT") return;

    if (!window.confirm(`Delete requirement "${item.title}"?`)) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${baseUrl}/${item.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to delete requirement");
      }

      await loadRequirements();
      setNotice("Functional requirement deleted successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-bold text-indigo-950">
            Functional Requirements — {activityTitle}
          </h4>
          <p className="text-sm text-slate-500">
            Define system functions and acceptance criteria for this activity.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={create}
            className="rounded-lg bg-indigo-900 px-3 py-2 text-sm font-semibold text-white"
          >
            + Add Requirement
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>
      )}

      {notice && (
        <p role="status" className="mb-3 text-sm text-green-700">{notice}</p>
      )}

      {showForm && canManage && (
        <form onSubmit={save} className="mb-4 space-y-3 rounded-lg border bg-white p-4">
          <h5 className="font-semibold">
            {editing ? "Edit Requirement" : "New Functional Requirement"}
          </h5>

          <label className="block space-y-1 text-sm">
            <span>Requirement Code *</span>
            <input
              required
              maxLength={40}
              pattern="[A-Za-z0-9_-]+"
              className={inputClass}
              placeholder="FR-HRM-001"
              value={form.requirement_code}
              onChange={e => setForm({
                ...form, requirement_code: e.target.value
              })}
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Requirement Title *</span>
            <input
              required
              maxLength={255}
              className={inputClass}
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Detailed Functional Requirement *</span>
            <textarea
              required
              rows={4}
              maxLength={10000}
              className={inputClass}
              value={form.description}
              onChange={e => setForm({
                ...form, description: e.target.value
              })}
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Acceptance Criteria</span>
            <textarea
              rows={3}
              maxLength={10000}
              className={inputClass}
              value={form.acceptance_criteria}
              onChange={e => setForm({
                ...form, acceptance_criteria: e.target.value
              })}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span>Priority</span>
              <select
                className={inputClass}
                value={form.priority}
                onChange={e => setForm({
                  ...form,
                  priority: e.target.value as Requirement["priority"]
                })}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>

            <label className="block space-y-1 text-sm">
              <span>Display Order</span>
              <input
                required
                type="number"
                min={0}
                max={100000}
                step={1}
                className={inputClass}
                value={form.display_order}
                onChange={e => setForm({
                  ...form, display_order: e.target.value
                })}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm({
                ...form, is_active: e.target.checked
              })}
            />
            Active Requirement
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-indigo-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Requirement"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading requirements...</p>
      ) : requirements.length === 0 ? (
        <p className="text-sm text-slate-500">
          No functional requirements registered for this activity.
        </p>
      ) : (
        <div className="space-y-3">
          {requirements.map(item => (
            <details key={item.id} className="rounded-lg border bg-white p-4">
              <summary className="cursor-pointer font-semibold text-slate-900">
                {item.requirement_code} — {item.title}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  ({item.priority} / {item.status})
                </span>
              </summary>

              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <p className="whitespace-pre-wrap">{item.description}</p>

                <div>
                  <strong>Acceptance Criteria</strong>
                  <p className="mt-1 whitespace-pre-wrap">
                    {item.acceptance_criteria || "Not specified"}
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  Display Order: {item.display_order} |
                  {item.is_active ? " Active" : " Inactive"}
                </p>

                {canManage && item.status === "DRAFT" && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => edit(item)}
                      className="rounded-lg border px-3 py-1.5"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void remove(item)}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
