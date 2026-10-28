"use client";

import { useCallback, useEffect, useState } from "react";

type Objective = {
  id: string;
  objective_code: string | null;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type ObjectiveForm = {
  objective_code: string;
  title: string;
  description: string;
  display_order: string;
  is_active: boolean;
};

const emptyForm: ObjectiveForm = {
  objective_code: "",
  title: "",
  description: "",
  display_order: "0",
  is_active: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900";

export default function ObjectivesManager({
  moduleId,
  moduleTitle,
  canManage,
}: {
  moduleId: string;
  moduleTitle: string;
  canManage: boolean;
}) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [editing, setEditing] = useState<Objective | null>(null);
  const [form, setForm] = useState<ObjectiveForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const baseUrl = `/api/modules/${moduleId}/objectives`;

  const loadObjectives = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/modules/${moduleId}/objectives`,
      { credentials: "same-origin", cache: "no-store", signal }
    );

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load objectives");
    }

    setObjectives(result.data);
  }, [moduleId]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        await loadObjectives(controller.signal);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unable to load objectives"
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [loadObjectives]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
    setError("");
    setNotice("");
  }

  function openEdit(item: Objective) {
    setEditing(item);
    setForm({
      objective_code: item.objective_code || "",
      title: item.title,
      description: item.description || "",
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
            objective_code: form.objective_code.trim().toUpperCase() || null,
            title: form.title.trim(),
            description: form.description.trim(),
            display_order: order,
            is_active: form.is_active,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save objective");
      }

      setShowForm(false);
      setEditing(null);
      await loadObjectives();
      setNotice("Objective saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Objective) {
    if (!canManage || saving) return;
    if (!window.confirm(`Delete objective "${item.title}"?`)) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${baseUrl}/${item.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to delete objective");
      }

      await loadObjectives();
      setNotice("Objective deleted successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-blue-950">
            Module Objectives — {moduleTitle}
          </h3>
          <p className="text-sm text-slate-500">
            Define the goals and expected outcomes of this module.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white"
          >
            + Add Objective
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
        <form onSubmit={save} className="mb-5 space-y-3 rounded-lg bg-slate-50 p-4">
          <h4 className="font-semibold">
            {editing ? "Edit Objective" : "New Objective"}
          </h4>

          <input
            className={inputClass}
            placeholder="Objective Code (e.g. OBJ-HRM-001)"
            value={form.objective_code}
            onChange={e => setForm({
              ...form, objective_code: e.target.value
            })}
          />

          <input
            required
            maxLength={255}
            className={inputClass}
            placeholder="Objective Title"
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
          />

          <textarea
            className={inputClass}
            rows={4}
            maxLength={10000}
            placeholder="Detailed objective description"
            value={form.description}
            onChange={e => setForm({
              ...form, description: e.target.value
            })}
          />

          <input
            type="number"
            min={0}
            max={100000}
            className={inputClass}
            value={form.display_order}
            onChange={e => setForm({
              ...form, display_order: e.target.value
            })}
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm({
                ...form, is_active: e.target.checked
              })}
            />
            Active
          </label>

          <div className="flex gap-3">
            <button
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Objective"}
            </button>

            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading objectives...</p>
      ) : objectives.length === 0 ? (
        <p className="text-sm text-slate-500">
          No objectives registered for this module.
        </p>
      ) : (
        <div className="space-y-3">
          {objectives.map(item => (
            <details key={item.id} className="rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer font-semibold text-slate-900">
                {item.objective_code ? `${item.objective_code} — ` : ""}
                {item.title}
                {!item.is_active && " (Inactive)"}
              </summary>

              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">
                {item.description || "No description provided."}
              </p>

              {canManage && (
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="rounded-lg border px-3 py-1.5 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(item)}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700"
                  >
                    Delete
                  </button>
                </div>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
