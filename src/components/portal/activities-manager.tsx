"use client";

import { useCallback, useEffect, useState } from "react";

type Activity = {
  id: string;
  module_id: string;
  activity_code: string | null;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type ActivityForm = {
  activity_code: string;
  title: string;
  description: string;
  display_order: string;
  is_active: boolean;
};

const emptyForm: ActivityForm = {
  activity_code: "",
  title: "",
  description: "",
  display_order: "0",
  is_active: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function ActivitiesManager({
  moduleId,
  moduleTitle,
  canManage,
  onClose,
}: {
  moduleId: string;
  moduleTitle: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ActivityForm>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const baseUrl = `/api/modules/${moduleId}/activities`;

  const loadActivities = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/modules/${moduleId}/activities`,
        { cache: "no-store", credentials: "same-origin" }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to load activities");
      }

      setActivities(result.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load activities"
      );
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => {
    const controller = new AbortController();

    async function initialLoad() {
      try {
        const response = await fetch(
          `/api/modules/${moduleId}/activities`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load activities");
        }

        if (!controller.signal.aborted) {
          setActivities(result.data);
          setLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unable to load activities"
          );
          setLoading(false);
        }
      }
    }

    void initialLoad();
    return () => controller.abort();
  }, [moduleId]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEdit(activity: Activity) {
    setEditing(activity);
    setForm({
      activity_code: activity.activity_code || "",
      title: activity.title,
      description: activity.description || "",
      display_order: String(activity.display_order),
      is_active: activity.is_active,
    });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  async function saveActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage || saving) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const order = Number(form.display_order);

      if (
        !Number.isSafeInteger(order) ||
        order < 0 ||
        order > 100000
      ) {
        throw new Error("Display order must be between 0 and 100000");
      }

      const payload = {
        activity_code: form.activity_code.trim().toUpperCase() || null,
        title: form.title.trim(),
        description: form.description.trim(),
        display_order: order,
        is_active: form.is_active,
      };

      const response = await fetch(
        editing ? `${baseUrl}/${editing.id}` : baseUrl,
        {
          method: editing ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save activity");
      }

      setShowForm(false);
      setEditing(null);
      await loadActivities();
      setNotice(
        editing
          ? "Activity updated successfully."
          : "Activity created successfully."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save activity"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteActivity(activity: Activity) {
    if (!canManage || saving) return;

    if (!window.confirm(`Delete "${activity.title}"?`)) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${baseUrl}/${activity.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to delete activity");
      }

      await loadActivities();
      setNotice("Activity deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete activity"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-blue-950">
            Activities — {moduleTitle}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Manage activities belonging to this institutional module.
          </p>
        </div>

        <div className="flex gap-2">
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white"
            >
              + Add Activity
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
          {notice}
        </p>
      )}

      {showForm && canManage && (
        <form
          onSubmit={saveActivity}
          className="mb-6 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <h3 className="font-semibold">
            {editing ? "Edit Activity" : "Create Activity"}
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="block font-medium">Activity Code</span>
              <input
                className={inputClass}
                maxLength={30}
                value={form.activity_code}
                onChange={e =>
                  setForm({ ...form, activity_code: e.target.value })
                }
                placeholder="ACT-001"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="block font-medium">Activity Title *</span>
              <input
                className={inputClass}
                required
                maxLength={255}
                value={form.title}
                onChange={e =>
                  setForm({ ...form, title: e.target.value })
                }
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="block font-medium">Display Order</span>
              <input
                type="number"
                min="0"
                max="100000"
                required
                className={inputClass}
                value={form.display_order}
                onChange={e =>
                  setForm({ ...form, display_order: e.target.value })
                }
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={e =>
                  setForm({ ...form, is_active: e.target.checked })
                }
              />
              Active Activity
            </label>
          </div>

          <label className="block space-y-2 text-sm">
            <span className="block font-medium">Description</span>
            <textarea
              rows={3}
              maxLength={5000}
              className={inputClass}
              value={form.description}
              onChange={e =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </label>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Update Activity" : "Save Activity"}
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Activity</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Status</th>
              {canManage && <th className="px-4 py-3">Actions</th>}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="p-6 text-center">
                  Loading activities...
                </td>
              </tr>
            ) : activities.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="p-6 text-center text-slate-500">
                  No activities found.
                </td>
              </tr>
            ) : (
              activities.map(activity => (
                <tr key={activity.id}>
                  <td className="px-4 py-3 font-semibold">
                    {activity.activity_code || "—"}
                  </td>
                  <td className="px-4 py-3">{activity.title}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {activity.description || "—"}
                  </td>
                  <td className="px-4 py-3">{activity.display_order}</td>
                  <td className="px-4 py-3">
                    {activity.is_active ? "Active" : "Inactive"}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => openEdit(activity)}
                          className="font-semibold text-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteActivity(activity)}
                          className="font-semibold text-red-700"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
