"use client";

import { useState, type FormEvent } from "react";

type ActivityOption = {
  id: string;
  activity_code: string | null;
  title: string;
  is_active: boolean;
};

type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type RequirementForm = {
  activity_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string;
  priority: Priority;
  display_order: string;
  is_active: boolean;
};

type EditableRequirement = {
  id: string;
  activity_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: Priority;
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  display_order: number;
  is_active: boolean;
};

type Props = {
  moduleId: string;
  activities: ActivityOption[];
  requirement?: EditableRequirement;
  onSaved: () => Promise<void>;
  onCancel: () => void;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function ProjectRequirementForm({
  moduleId,
  activities,
  requirement,
  onSaved,
  onCancel,
}: Props) {
  const [form, setForm] = useState<RequirementForm>(() => ({
    activity_id: requirement?.activity_id ?? "",
    requirement_code: requirement?.requirement_code ?? "",
    title: requirement?.title ?? "",
    description: requirement?.description ?? "",
    acceptance_criteria: requirement?.acceptance_criteria ?? "",
    priority: requirement?.priority ?? "MEDIUM",
    display_order: String(requirement?.display_order ?? 0),
    is_active: requirement?.is_active ?? true,
  }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const activeActivities = activities.filter(activity => activity.is_active);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    if (requirement && requirement.status !== "DRAFT") {
      setError("Only draft requirements can be edited.");
      return;
    }

    const activity = activities.find(
      item => item.id === form.activity_id
    );

    if (
      !activity ||
      (requirement
        ? activity.id !== requirement.activity_id
        : !activity.is_active)
    ) {
      setError("Select a valid activity.");
      return;
    }

    const code = form.requirement_code.trim().toUpperCase();
    const title = form.title.trim();
    const description = form.description.trim();
    const criteria = form.acceptance_criteria.trim();
    const order = Number(form.display_order);

    if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
      setError(
        "Requirement code must contain 1-40 letters, numbers, underscores or hyphens."
      );
      return;
    }

    if (!title || title.length > 255) {
      setError("Title must contain 1-255 characters.");
      return;
    }

    if (!description || description.length > 10000) {
      setError("Description must contain 1-10000 characters.");
      return;
    }

    if (criteria.length > 10000) {
      setError("Acceptance criteria cannot exceed 10000 characters.");
      return;
    }

    if (!Number.isSafeInteger(order) || order < 0 || order > 100000) {
      setError("Display order must be between 0 and 100000.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `/api/modules/${encodeURIComponent(moduleId)}/activities/${encodeURIComponent(activity.id)}/requirements${requirement ? `/${encodeURIComponent(requirement.id)}` : ""}`,
        {
          method: requirement ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            requirement_code: code,
            title,
            description,
            acceptance_criteria: criteria,
            priority: form.priority,
            ...(!requirement ? { status: "DRAFT" } : {}),
            display_order: order,
            is_active: form.is_active,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error ||
            result.message ||
            requirement
              ? "Unable to update functional requirement."
              : requirement
            ? "Unable to update functional requirement."
            : "Unable to create functional requirement."
        );
      }

      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : requirement
            ? "Unable to update functional requirement."
            : "Unable to create functional requirement."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <h5 className="text-lg font-semibold text-blue-950">
        {requirement ? "Edit Functional Requirement" : "Add Functional Requirement"}
      </h5>

      <p className="mt-1 text-sm text-slate-600">
        {requirement
          ? "Update the draft requirement. Its assigned activity cannot be changed."
          : "The requirement will be created in Draft status."}
      </p>

      {(requirement
        ? !activities.some(activity => activity.id === requirement.activity_id)
        : activeActivities.length === 0) ? (
        <div className="mt-4 space-y-3">
          <p role="alert" className="text-sm text-amber-800">
            No active activities are available. Create or activate an
            activity before adding functional requirements.
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium">
              <span>Activity *</span>
              <select
                required
                disabled={Boolean(requirement)}
                value={form.activity_id}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    activity_id: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="">Select Activity</option>
                {(requirement ? activities : activeActivities).map(activity => (
                  <option key={activity.id} value={activity.id}>
                    {activity.activity_code
                      ? `${activity.activity_code} - `
                      : ""}
                    {activity.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm font-medium">
              <span>Requirement Code *</span>
              <input
                required
                maxLength={40}
                pattern="[A-Za-z0-9_-]+"
                value={form.requirement_code}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    requirement_code: event.target.value.toUpperCase(),
                  }))
                }
                className={inputClass}
                placeholder="e.g. ACAD-FR-001"
              />
            </label>

            <label className="space-y-1 text-sm font-medium">
              <span>Requirement Title *</span>
              <input
                required
                maxLength={255}
                value={form.title}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                className={inputClass}
                placeholder="e.g. Manage Academic Programs"
              />
            </label>

            <label className="space-y-1 text-sm font-medium">
              <span>Priority *</span>
              <select
                value={form.priority}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    priority: event.target.value as Priority,
                  }))
                }
                className={inputClass}
              >
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
            </label>

            <label className="space-y-1 text-sm font-medium">
              <span>Display Order</span>
              <input
                required
                type="number"
                min={0}
                max={100000}
                step={1}
                value={form.display_order}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    display_order: event.target.value,
                  }))
                }
                className={inputClass}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={event =>
                  setForm(current => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
              />
              Active Requirement
            </label>
          </div>

          <label className="block space-y-1 text-sm font-medium">
            <span>Description *</span>
            <textarea
              required
              rows={4}
              maxLength={10000}
              value={form.description}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              className={inputClass}
              placeholder="Describe the functional requirement"
            />
          </label>

          <label className="block space-y-1 text-sm font-medium">
            <span>Acceptance Criteria</span>
            <textarea
              rows={4}
              maxLength={10000}
              value={form.acceptance_criteria}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  acceptance_criteria: event.target.value,
                }))
              }
              className={inputClass}
              placeholder="Define the conditions for acceptance"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving
                ? "Saving..."
                : requirement
                  ? "Update Requirement"
                  : "Save Requirement"}
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}