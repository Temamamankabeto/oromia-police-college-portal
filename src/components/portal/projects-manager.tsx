"use client";

import { useCallback, useEffect, useState } from "react";
import ProjectModuleForm from "@/components/portal/project-module-form";
import ModuleFunctionalRequirements from "@/components/portal/module-functional-requirements";
import ActivitiesManager from "@/components/portal/activities-manager";
import ActionMenu from "@/components/portal/action-menu";

type ProjectStatus =
  | "PLANNED"
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";

type ProjectModule = {
  id: string;
  project_id: string;
  module_code: string;
  title: string;
  description: string | null;
  display_order: number;
  is_active: boolean;
};

type Project = {
  id: string;
  project_code: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
};

type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T;
  meta: { total?: number } | null;
};

type ProjectForm = {
  project_code: string;
  title: string;
  description: string;
  status: ProjectStatus;
};

const statuses: ProjectStatus[] = [
  "PLANNED",
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
];

const emptyForm: ProjectForm = {
  project_code: "",
  title: "",
  description: "",
  status: "ACTIVE",
};

function statusLabel(status: ProjectStatus): string {
  return status.replaceAll("_", " ");
}

function statusClass(status: ProjectStatus): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-800";
    case "PLANNED":
      return "bg-blue-100 text-blue-800";
    case "ON_HOLD":
      return "bg-amber-100 text-amber-800";
    case "COMPLETED":
      return "bg-violet-100 text-violet-800";
    case "CANCELLED":
      return "bg-red-100 text-red-800";
  }
}

export default function ProjectsManager() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [modules, setModules] = useState<ProjectModule[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [modulesError, setModulesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [projectDeleteBusy, setProjectDeleteBusy] = useState(false);
  const [projectDeleteError, setProjectDeleteError] = useState("");

  const loadModules = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/modules", {
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });

    const result = await response.json();

    if (!response.ok || !result.success || !Array.isArray(result.data)) {
      throw new Error(
        result.message || result.error || "Unable to load modules"
      );
    }

    if (!signal?.aborted) {
      setModules(result.data);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);

      const response = await fetch("/api/projects", {
        cache: "no-store",
      });

      const result: ApiResponse<Project[]> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to load projects");
      }

      setProjects(result.data);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load projects"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchInitialProjects() {
      try {
        const response = await fetch("/api/projects", {
          cache: "no-store",
          signal: controller.signal,
        });

        const result: ApiResponse<Project[]> = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Unable to load projects");
        }

        if (!controller.signal.aborted) {
          setProjects(result.data);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load projects"
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void fetchInitialProjects();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function initialLoadModules() {
      try {
        await loadModules(controller.signal);
      } catch (caught) {
        if (!controller.signal.aborted) {
          setModulesError(
            caught instanceof Error
              ? caught.message
              : "Unable to load modules"
          );
        }
      }
    }

    void initialLoadModules();

    return () => controller.abort();
  }, [loadModules]);

  function openDeleteProject(project: Project) {
    setDeletingProject(project);
    setProjectDeleteError("");
    setSuccess("");
  }

  async function confirmDeleteProject() {
    if (!deletingProject || projectDeleteBusy) return;

    setProjectDeleteBusy(true);
    setProjectDeleteError("");

    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(deletingProject.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      const result: ApiResponse<Project> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || "Unable to delete project."
        );
      }

      setDeletingProject(null);
      setSuccess("Project deleted successfully.");
      await loadProjects();
      await loadModules();
    } catch (caught) {
      setProjectDeleteError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete project."
      );
    } finally {
      setProjectDeleteBusy(false);
    }
  }

  function toggleProject(projectId: string) {
    setExpandedProjects(current =>
      current.includes(projectId)
        ? current.filter(id => id !== projectId)
        : [...current, projectId]
    );
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  function openEdit(project: Project) {
    setEditingId(project.id);
    setForm({
      project_code: project.project_code,
      title: project.title,
      description: project.description ?? "",
      status: project.status,
    });
    setError("");
    setSuccess("");
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving) return;

    setError("");
    setSuccess("");

    const title = form.title.trim();
    const description = form.description.trim();
    const projectCode = form.project_code.trim().toUpperCase();

    if (title.length < 2 || title.length > 255) {
      setError("Project title must contain 2-255 characters.");
      return;
    }

    if (description.length > 5000) {
      setError("Description cannot exceed 5000 characters.");
      return;
    }

    if (!editingId && !/^[A-Z0-9_-]{2,40}$/.test(projectCode)) {
      setError("Project code must contain 2-40 valid characters.");
      return;
    }

    const payload = editingId
      ? {
          title,
          description: description || null,
          status: form.status,
        }
      : {
          project_code: projectCode,
          title,
          description: description || null,
          status: form.status,
        };

    try {
      setSaving(true);

      const response = await fetch(
        editingId
          ? `/api/projects/${encodeURIComponent(editingId)}`
          : "/api/projects",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result: ApiResponse<Project> = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to save project");
      }

      setFormOpen(false);
      setEditingId(null);
      setSuccess(result.message);
      await loadProjects();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save project"
      );
    } finally {
      setSaving(false);
    }
  }

  const filtered = projects.filter(project => {
    const term = search.trim().toLowerCase();

    return (
      project.project_code.toLowerCase().includes(term) ||
      project.title.toLowerCase().includes(term) ||
      (project.description ?? "").toLowerCase().includes(term) ||
      project.status.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            Project Management
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Manage projects and their implementation status.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-blue-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
        >
          + Create Project
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Total Projects</p>
          <p className="mt-2 text-3xl font-bold">{projects.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Active Projects</p>
          <p className="mt-2 text-3xl font-bold">
            {projects.filter(p => p.status === "ACTIVE").length}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm text-slate-500">Completed Projects</p>
          <p className="mt-2 text-3xl font-bold">
            {projects.filter(p => p.status === "COMPLETED").length}
          </p>
        </div>
      </div>

      {success && (
        <div role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800">
          {success}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {modulesError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {modulesError}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <label htmlFor="project-search" className="sr-only">
            Search projects
          </label>
          <input
            id="project-search"
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search projects..."
            className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm sm:max-w-md"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="w-10 px-3 py-3">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col" className="px-5 py-3">Code</th>
                <th scope="col" className="px-5 py-3">Project</th>
                <th scope="col" className="px-5 py-3">Status</th>
                <th scope="col" className="px-5 py-3">Created</th>
                <th scope="col" className="px-5 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center">
                    Loading projects...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-slate-500">
                    No projects found.
                  </td>
                </tr>
              ) : (
                filtered.map(project => (
                  <ProjectTreeRow
                    key={project.id}
                    project={project}
                    modules={modules.filter(
                      item => item.project_id === project.id
                    )}
                    expanded={expandedProjects.includes(project.id)}
                    onToggle={() => toggleProject(project.id)}
                    onEdit={() => openEdit(project)}
                    onDelete={() => openDeleteProject(project)}
                  onModulesChanged={() => loadModules()}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deletingProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-project-title"
            aria-describedby="delete-project-description"
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <h3
              id="delete-project-title"
              className="text-lg font-bold text-red-800"
            >
              Delete Project
            </h3>

            <p
              id="delete-project-description"
              className="mt-3 text-sm text-slate-700"
            >
              Delete {deletingProject.project_code} -{" "}
              {deletingProject.title}?
            </p>

            <p className="mt-2 text-sm text-slate-600">
              Projects containing modules or membership history cannot
              be deleted. Successful deletion is recorded in the audit log.
            </p>

            {projectDeleteError && (
              <p role="alert" className="mt-3 text-sm text-red-700">
                {projectDeleteError}
              </p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                disabled={projectDeleteBusy}
                onClick={() => {
                  setDeletingProject(null);
                  setProjectDeleteError("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={projectDeleteBusy}
                onClick={confirmDeleteProject}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {projectDeleteBusy ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </section>
        </div>
      )}

      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-form-title"
            className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 id="project-form-title" className="text-xl font-bold">
                {editingId ? "Edit Project" : "Create Project"}
              </h3>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                aria-label="Close project form"
                className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form onSubmit={saveProject} className="space-y-4">
              <div>
                <label htmlFor="project-code" className="mb-1 block text-sm font-medium">
                  Project Code
                </label>
                <input
                  id="project-code"
                  value={form.project_code}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      project_code: event.target.value.toUpperCase(),
                    }))
                  }
                  disabled={Boolean(editingId)}
                  required
                  maxLength={40}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-100"
                />
              </div>

              <div>
                <label htmlFor="project-title" className="mb-1 block text-sm font-medium">
                  Project Title
                </label>
                <input
                  id="project-title"
                  value={form.title}
                  onChange={event =>
                    setForm(current => ({ ...current, title: event.target.value }))
                  }
                  required
                  minLength={2}
                  maxLength={255}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="project-description" className="mb-1 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  id="project-description"
                  value={form.description}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  rows={4}
                  maxLength={5000}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>

              <div>
                <label htmlFor="project-status" className="mb-1 block text-sm font-medium">
                  Status
                </label>
                <select
                  id="project-status"
                  value={form.status}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      status: event.target.value as ProjectStatus,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                >
                  {statuses.map(status => (
                    <option key={status} value={status}>
                      {statusLabel(status)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="rounded-lg border border-slate-300 px-4 py-2"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-blue-900 px-5 py-2 font-semibold text-white disabled:opacity-50"
                >
                  {saving
                    ? "Saving..."
                    : editingId
                      ? "Update Project"
                      : "Create Project"}
                </button>
              </div>
            </form>

            {error && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function ProjectTreeRow({
  project,
  modules,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onModulesChanged,
}: {
  project: Project;
  modules: ProjectModule[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onModulesChanged: () => Promise<void>;
}) {
  const [showModuleForm, setShowModuleForm] = useState(false);
  const [editingModule, setEditingModule] = useState<ProjectModule | null>(null);
  const [deletingModule, setDeletingModule] = useState<ProjectModule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [expandedModules, setExpandedModules] = useState<string[]>([]);
  const [managingActivities, setManagingActivities] = useState<string[]>([]);
  const [activityRefreshKeys, setActivityRefreshKeys] = useState<Record<string, number>>({});

  function openModuleForm() {
    if (!expanded) onToggle();
    setEditingModule(null);
    setShowModuleForm(true);
  }

  function openEditModule(module: ProjectModule) {
    if (!expanded) onToggle();
    setEditingModule(module);
    setShowModuleForm(true);
  }

  function openDeleteModule(module: ProjectModule) {
    setDeleteError("");
    setDeletingModule(module);
  }

  async function confirmDeleteModule() {
    if (!deletingModule || deleteBusy) return;

    setDeleteBusy(true);
    setDeleteError("");

    try {
      const response = await fetch(
        `/api/modules/${encodeURIComponent(deletingModule.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message || result.error || "Unable to delete module."
        );
      }

      await onModulesChanged();
      setDeletingModule(null);
    } catch (caught) {
      setDeleteError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete module."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  function closeModuleForm() {
    setShowModuleForm(false);
    setEditingModule(null);
  }

  async function handleModuleSaved() {
    await onModulesChanged();
    closeModuleForm();
  }

  function toggleActivityManager(moduleId: string) {
    setManagingActivities(current =>
      current.includes(moduleId)
        ? current.filter(id => id !== moduleId)
        : [...current, moduleId]
    );
  }

  function closeActivityManager(moduleId: string) {
    setManagingActivities(current =>
      current.filter(id => id !== moduleId)
    );

    setActivityRefreshKeys(current => ({
      ...current,
      [moduleId]: (current[moduleId] ?? 0) + 1,
    }));
  }

  function toggleModule(moduleId: string) {
    setExpandedModules(current =>
      current.includes(moduleId)
        ? current.filter(id => id !== moduleId)
        : [...current, moduleId]
    );
  }

  return (
    <>
      <tr>
        <td className="px-3 py-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${project.title}`}
            className="rounded p-2 hover:bg-slate-100"
          >
            <span aria-hidden="true" className={`inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-800 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}>&#9654;</span>
          </button>
        </td>
        <td className="px-5 py-4 font-mono font-semibold">
          {project.project_code}
        </td>
        <td className="px-5 py-4">
          <p className="font-semibold text-slate-900">{project.title}</p>
          {project.description && (
            <p className="mt-1 max-w-lg text-xs text-slate-500">
              {project.description}
            </p>
          )}
        </td>
        <td className="px-5 py-4">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(project.status)}`}
          >
            {statusLabel(project.status)}
          </span>
        </td>
        <td className="px-5 py-4 text-slate-600">
          {new Date(project.created_at).toLocaleDateString()}
        </td>
        <td className="px-5 py-4">
          <ActionMenu
            label={`Actions for project ${project.project_code}`}
            items={[
              {
                label: "Add Module",
                onSelect: openModuleForm,
              },
              {
                label: "Edit Project",
                onSelect: onEdit,
              },
              {
                label: "Delete Project",
                destructive: true,
                onSelect: onDelete,
              },
            ]}
          />
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} className="bg-slate-50 px-6 py-5">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="mb-3 font-semibold text-slate-900">
                Modules - {project.title}
              </h3>

              {deletingModule && (
                <div
                  role="alertdialog"
                  aria-labelledby={`delete-module-title-${deletingModule.id}`}
                  aria-describedby={`delete-module-description-${deletingModule.id}`}
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 p-5"
                >
                  <h4
                    id={`delete-module-title-${deletingModule.id}`}
                    className="font-semibold text-red-900"
                  >
                    Delete Module
                  </h4>
                  <p
                    id={`delete-module-description-${deletingModule.id}`}
                    className="mt-2 text-sm text-slate-700"
                  >
                    Delete {deletingModule.module_code} - {deletingModule.title}?
                    This action is allowed only when the module has no
                    protected dependent records.
                  </p>

                  {deleteError && (
                    <p role="alert" className="mt-3 text-sm text-red-700">
                      {deleteError}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={confirmDeleteModule}
                      className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {deleteBusy ? "Deleting..." : "Confirm Delete"}
                    </button>
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => {
                        setDeletingModule(null);
                        setDeleteError("");
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {showModuleForm && (
                <div className="mb-4">
                  <ProjectModuleForm
                    key={editingModule?.id ?? "create"}
                    projectId={project.id}
                    projectTitle={project.title}
                    module={editingModule ?? undefined}
                    onSaved={handleModuleSaved}
                    onCancel={closeModuleForm}
                  />
                </div>
              )}

              {modules.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No modules registered for this project.
                </p>
              ) : (
                <div className="space-y-2">
                  {modules.map(item => {
                    const moduleExpanded = expandedModules.includes(item.id);

                    return (
                      <div
                        key={item.id}
                        className="rounded-lg border border-slate-200"
                      >
                        <div className="flex items-center gap-3 p-3">
                          <button
                            type="button"
                            onClick={() => toggleModule(item.id)}
                            aria-expanded={moduleExpanded}
                            aria-label={`${moduleExpanded ? "Collapse" : "Expand"} ${item.title}`}
                            className="rounded p-2 hover:bg-slate-100"
                          >
                            <span aria-hidden="true" className={`inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-blue-800 transition-transform duration-200 ${moduleExpanded ? "rotate-90" : ""}`}>&#9654;</span>
                          </button>

                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-900">
                              {item.module_code} - {item.title}
                            </p>
                            <p className="text-xs text-slate-500">
                              {item.is_active ? "Active" : "Inactive"}
                            </p>
                          </div>

                          <ActionMenu
                            label={`Actions for module ${item.module_code}`}
                            items={[
                              {
                                label: "Edit Module",
                                onSelect: () => openEditModule(item),
                              },
                              {
                                label: "Delete Module",
                                destructive: true,
                                onSelect: () => openDeleteModule(item),
                              },
                            ]}
                          />
                        </div>

                        {moduleExpanded && (
                          <div className="space-y-4 border-t border-slate-200 p-4">
                            <div className="flex flex-wrap justify-end">
                              <button
                                type="button"
                                onClick={() => toggleActivityManager(item.id)}
                                aria-expanded={managingActivities.includes(item.id)}
                                className="rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-900 hover:bg-blue-50"
                              >
                                {managingActivities.includes(item.id)
                                  ? "Hide Activity Management"
                                  : "Manage Activities"}
                              </button>
                            </div>

                            {managingActivities.includes(item.id) && (
                              <ActivitiesManager
                                moduleId={item.id}
                                moduleTitle={item.title}
                                canManage={true}
                                onClose={() => closeActivityManager(item.id)}
                              />
                            )}

                            <ModuleFunctionalRequirements
                              key={`${item.id}-${activityRefreshKeys[item.id] ?? 0}`}
                              moduleId={item.id}
                              moduleTitle={item.title}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}