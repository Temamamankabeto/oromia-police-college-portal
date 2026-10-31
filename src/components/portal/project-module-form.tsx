"use client";

import { useState, type FormEvent } from "react";

type EditableModule = {
  id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type Props = {
  projectId: string;
  projectTitle: string;
  module?: EditableModule;
  onSaved: () => Promise<void>;
  onCancel: () => void;
};

type ModuleForm = {
  module_code: string;
  title: string;
  description: string;
  display_order: string;
  is_active: boolean;
};

const initialForm: ModuleForm = {
  module_code: "",
  title: "",
  description: "",
  display_order: "0",
  is_active: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function ProjectModuleForm({
  projectId,
  projectTitle,
  module,
  onSaved,
  onCancel,
}: Props) {
  const [form, setForm] = useState<ModuleForm>(() =>
    module
      ? {
          module_code: module.module_code,
          title: module.title,
          description: module.description ?? "",
          display_order: String(module.display_order),
          is_active: module.is_active,
        }
      : initialForm
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    const moduleCode = form.module_code.trim().toUpperCase();
    const title = form.title.trim();
    const description = form.description.trim();
    const order = Number(form.display_order);

    if (!/^[A-Z0-9_-]{1,20}$/.test(moduleCode)) {
      setError("Module code must contain 1-20 letters, numbers, underscores or hyphens.");
      return;
    }

    if (!title || title.length > 255) {
      setError("Module title must contain 1-255 characters.");
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
        module ? `/api/modules/${encodeURIComponent(module.id)}` : "/api/modules",
        {
        method: module ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(!module ? { project_id: projectId } : {}),
          module_code: moduleCode,
          title,
          description,
          display_order: order,
          is_active: form.is_active,
        }),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || result.error || "Unable to create module."
        );
      }

      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to create module."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-5">
      <h4 className="text-lg font-semibold text-blue-950">
        {module ? "Edit Module" : "Add Module"}
      </h4>

      <p className="mt-1 text-sm text-slate-600">
        Project: {projectTitle}
      </p>

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm font-medium">
            <span>Module Code *</span>
            <input
              required
              maxLength={20}
              pattern="[A-Za-z0-9_-]+"
              value={form.module_code}
              onChange={event =>
                setForm(current => ({
                  ...current,
                  module_code: event.target.value.toUpperCase(),
                }))
              }
              className={inputClass}
              placeholder="e.g. EXAM"
            />
          </label>

          <label className="space-y-1 text-sm font-medium">
            <span>Module Title *</span>
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
              placeholder="e.g. Examination Management"
            />
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
            Active Module
          </label>
        </div>

        <label className="block space-y-1 text-sm font-medium">
          <span>Description</span>
          <textarea
            rows={3}
            value={form.description}
            onChange={event =>
              setForm(current => ({
                ...current,
                description: event.target.value,
              }))
            }
            className={inputClass}
            placeholder="Describe this module"
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
              : module
                ? "Update Module"
                : "Save Module"}
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
    </section>
  );
}