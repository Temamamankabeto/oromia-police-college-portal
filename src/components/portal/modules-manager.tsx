"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ActivitiesManager from "./activities-manager";
import ObjectivesManager from "./objectives-manager";

type Module = {
  id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type FormData = {
  module_code: string;
  title: string;
  description: string;
  display_order: string;
  is_active: boolean;
};

const emptyForm: FormData = {
  module_code: "",
  title: "",
  description: "",
  display_order: "0",
  is_active: true,
};

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";

export default function ModulesManager({
  canManage,
}: {
  canManage: boolean;
}) {
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<Module | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadModules = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/modules", {
        cache: "no-store",
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to load modules");
      }

      setModules(result.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load modules"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchInitialModules() {
      try {
        const response = await fetch("/api/modules", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load modules");
        }

        if (!controller.signal.aborted) {
          setModules(result.data);
          setLoading(false);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err instanceof Error ? err.message : "Unable to load modules"
          );
          setLoading(false);
        }
      }
    }

    void fetchInitialModules();

    return () => controller.abort();
  }, []);

  const filteredModules = useMemo(() => {
    const term = search.trim().toLowerCase();

    return modules.filter((item) => {
      const matchesSearch =
        item.module_code.toLowerCase().includes(term) ||
        item.title.toLowerCase().includes(term) ||
        (item.description || "").toLowerCase().includes(term);

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && item.is_active) ||
        (statusFilter === "inactive" && !item.is_active);

      return matchesSearch && matchesStatus;
    });
  }, [modules, search, statusFilter]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function openEdit(item: Module) {
    setEditing(item);
    setForm({
      module_code: item.module_code,
      title: item.title,
      description: item.description || "",
      display_order: String(item.display_order),
      is_active: item.is_active,
    });
    setError("");
    setNotice("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function saveModule(event: React.FormEvent<HTMLFormElement>) {
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
        module_code: form.module_code.trim().toUpperCase(),
        title: form.title.trim(),
        description: form.description.trim(),
        display_order: order,
        is_active: form.is_active,
      };

      const url = editing
        ? `/api/modules/${editing.id}`
        : "/api/modules";

      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save module");
      }

      closeForm();
      await loadModules();
      setNotice(
        editing
          ? "Module updated successfully."
          : "Module created successfully."
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to save module"
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteModule(item: Module) {
    if (!canManage || saving) return;

    const confirmed = window.confirm(
      `Delete "${item.title}"?\n\nThe module will be hidden, but its historical records will be preserved.`
    );

    if (!confirmed) return;

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/modules/${item.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to delete module");
      }

      await loadModules();
      setNotice("Module deleted successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to delete module"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">
            Institutional Modules
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Register and manage institutional modules and their activities.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
          >
            + Add Module
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Total Modules", modules.length],
          ["Active Modules", modules.filter(m => m.is_active).length],
          ["Inactive Modules", modules.filter(m => !m.is_active).length],
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

      {notice && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {showForm && canManage && (
        <div className="rounded-xl border border-blue-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-xl font-bold text-blue-950">
              {editing ? "Edit Module" : "Add New Module"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
              className="text-sm text-slate-500 hover:text-slate-900"
            >
              Close
            </button>
          </div>

          <form onSubmit={saveModule} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>Module Code *</span>
                <input
                  required
                  maxLength={20}
                  pattern="[A-Za-z0-9_-]+"
                  className={inputClass}
                  value={form.module_code}
                  onChange={e =>
                    setForm({ ...form, module_code: e.target.value.toUpperCase() })
                  }
                  placeholder="e.g. MOD001"
                />
              </label>

              <label className="block space-y-2 text-sm font-medium">
                <span>Module Title *</span>
                <input
                  required
                  maxLength={255}
                  className={inputClass}
                  value={form.title}
                  onChange={e =>
                    setForm({ ...form, title: e.target.value })
                  }
                  placeholder="Enter institutional module name"
                />
              </label>

              <label className="block space-y-2 text-sm font-medium">
                <span>Display Order</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  required
                  className={inputClass}
                  value={form.display_order}
                  onChange={e =>
                    setForm({ ...form, display_order: e.target.value })
                  }
                />
              </label>

              <label className="flex items-center gap-3 self-end rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={e =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                Active Module
              </label>
            </div>

            <label className="block space-y-2 text-sm font-medium">
              <span>Description</span>
              <textarea
                rows={3}
                maxLength={5000}
                className={inputClass}
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Describe the module"
              />
            </label>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : editing
                    ? "Update Module"
                    : "Save Module"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-5">
          <input
            aria-label="Search modules"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search modules..."
            className={`${inputClass} max-w-md`}
          />

          <select
            aria-label="Filter modules by status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            type="button"
            onClick={() => void loadModules()}
            disabled={loading}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-5 py-4">Code</th>
                <th className="px-5 py-4">Module Name</th>
                <th className="px-5 py-4">Description</th>
                <th className="px-5 py-4">Order</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Activities</th>
                {canManage && (
                  <th className="px-5 py-4 text-right">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-5 py-10 text-center text-slate-500">
                    Loading modules...
                  </td>
                </tr>
              ) : filteredModules.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-5 py-10 text-center text-slate-500">
                    No institutional modules found.
                  </td>
                </tr>
              ) : (
                filteredModules.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-semibold text-blue-900">
                      {item.module_code}
                    </td>
                    <td className="px-5 py-4 font-medium">
                      {item.title}
                    </td>
                    <td className="max-w-xs px-5 py-4 text-slate-500">
                      <p className="line-clamp-2">
                        {item.description || "—"}
                      </p>
                    </td>
                    <td className="px-5 py-4">{item.display_order}</td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        item.is_active
                          ? "bg-green-100 text-green-800"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        {item.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedModule(item)}
                        className="font-semibold text-blue-700 hover:underline"
                      >
                        Manage Details
                      </button>
                    </td>
                    {canManage && (
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => openEdit(item)}
                            disabled={saving}
                            className="font-semibold text-blue-700 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteModule(item)}
                            disabled={saving}
                            className="font-semibold text-red-700 hover:underline"
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

        <div className="border-t border-slate-200 px-5 py-4 text-xs text-slate-500">
          Showing {filteredModules.length} of {modules.length} modules
        </div>
      </div>
      {selectedModule && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div>
              <h3 className="text-lg font-bold text-blue-950">
                {selectedModule.module_code} — {selectedModule.title}
              </h3>
              <p className="text-sm text-slate-600">
                Manage objectives, activities, and functional requirements.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedModule(null)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium"
            >
              Close Module Details
            </button>
          </div>

          <ObjectivesManager
            key={`objectives-${selectedModule.id}`}
            moduleId={selectedModule.id}
            moduleTitle={selectedModule.title}
            canManage={canManage}
          />

          <ActivitiesManager
            key={`activities-${selectedModule.id}`}
            moduleId={selectedModule.id}
            moduleTitle={selectedModule.title}
            canManage={canManage}
            onClose={() => setSelectedModule(null)}
          />
        </div>
      )}
    </div>
  );
}
