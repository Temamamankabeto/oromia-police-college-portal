"use client";

import { useCallback, useEffect, useState } from "react";
import ProjectRequirementForm from "@/components/portal/project-requirement-form";
import ActionMenu from "@/components/portal/action-menu";
import RequirementAssignmentForm from "@/components/portal/requirement-assignment-form";

type Activity = {
  id: string;
  activity_code: string | null;
  title: string;
  is_active: boolean;
};

type Requirement = {
  id: string;
  activity_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
  display_order: number;
  is_active: boolean;
};

type RequirementRow = Requirement & {
  activityTitle: string;
  activityCode: string | null;
};

type Props = {
  moduleId: string;
  moduleTitle: string;
};

export default function ModuleFunctionalRequirements({
  moduleId,
  moduleTitle,
}: Props) {
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRequirementForm, setShowRequirementForm] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<RequirementRow | null>(null);
  const [deletingRequirement, setDeletingRequirement] = useState<RequirementRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [assigningRequirement, setAssigningRequirement] = useState<RequirementRow | null>(null);

  const refreshRequirements = useCallback(async () => {
    setRefreshKey(current => current + 1);
  }, []);

  function openAssignment(requirement: RequirementRow) {
    closeRequirementForm();
    setDeletingRequirement(null);
    setDeleteError("");
    setNotice("");
    setAssigningRequirement(requirement);
  }
  function openDeleteRequirement(requirement: RequirementRow) {
    if (requirement.status !== "DRAFT") return;

    closeRequirementForm();
    setNotice("");
    setDeleteError("");
    setDeletingRequirement(requirement);
  }

  async function confirmDeleteRequirement() {
    if (
      !deletingRequirement ||
      deletingRequirement.status !== "DRAFT" ||
      deleteBusy
    ) {
      return;
    }

    setDeleteBusy(true);
    setDeleteError("");

    try {
      const response = await fetch(
        `/api/modules/${encodeURIComponent(moduleId)}/activities/${encodeURIComponent(deletingRequirement.activity_id)}/requirements/${encodeURIComponent(deletingRequirement.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            result.error ||
            "Unable to delete functional requirement."
        );
      }

      await refreshRequirements();

      setDeletingRequirement(null);
      setNotice("Functional requirement deleted successfully.");
    } catch (caught) {
      setDeleteError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete functional requirement."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  function closeRequirementForm() {
    setShowRequirementForm(false);
    setEditingRequirement(null);
  }

  function openEditRequirement(requirement: RequirementRow) {
    if (requirement.status !== "DRAFT") return;

    setNotice("");
    setEditingRequirement(requirement);
    setShowRequirementForm(true);
  }

  async function handleRequirementSaved() {
    const wasEditing = Boolean(editingRequirement);

    await refreshRequirements();
    closeRequirementForm();

    setNotice(
      wasEditing
        ? "Functional requirement updated successfully."
        : "Functional requirement created successfully."
    );
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const activityResponse = await fetch(
          `/api/modules/${encodeURIComponent(moduleId)}/activities`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          }
        );

        const activityResult = await activityResponse.json();

        if (!activityResponse.ok || !activityResult.success) {
          throw new Error(
            activityResult.error ||
              activityResult.message ||
              "Unable to load activities."
          );
        }

        const loadedActivities: Activity[] = activityResult.data;

        const grouped = await Promise.all(
          loadedActivities.map(async activity => {
            const response = await fetch(
              `/api/modules/${encodeURIComponent(moduleId)}/activities/${encodeURIComponent(activity.id)}/requirements`,
              {
                cache: "no-store",
                credentials: "same-origin",
                signal: controller.signal,
              }
            );

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(
                result.error ||
                  result.message ||
                  `Unable to load requirements for ${activity.title}.`
              );
            }

            const rows: Requirement[] = result.data;

            return rows.map(requirement => ({
              ...requirement,
              activityTitle: activity.title,
              activityCode: activity.activity_code,
            }));
          })
        );

        if (controller.signal.aborted) return;

        setActivities(loadedActivities);
        setRequirements(
          grouped.flat().sort(
            (a, b) =>
              a.display_order - b.display_order ||
              a.requirement_code.localeCompare(b.requirement_code)
          )
        );
        setError("");
      } catch (caught) {
        if (controller.signal.aborted) return;

        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load functional requirements."
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [moduleId, refreshKey]);

  return (
    <section
      aria-label={`Functional requirements for ${moduleTitle}`}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-slate-900">
            Functional Requirements
          </h4>
          <p className="text-xs text-slate-500">
            {activities.length} activities / {requirements.length} requirements
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setNotice("");
            setEditingRequirement(null);
            setShowRequirementForm(true);
          }}
          disabled={loading || Boolean(error)}
          className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add Functional Requirement
        </button>
      </div>

      {notice && (
        <p role="status" className="text-sm text-green-700">
          {notice}
        </p>
      )}

      {deletingRequirement && (
        <section
          aria-labelledby="delete-requirement-title"
          className="rounded-xl border border-red-200 bg-red-50 p-5"
        >
          <h5
            id="delete-requirement-title"
            className="font-semibold text-red-900"
          >
            Delete Functional Requirement
          </h5>

          <p className="mt-2 text-sm text-slate-700">
            Delete {deletingRequirement.requirement_code} -{" "}
            {deletingRequirement.title}?
          </p>

          <p className="mt-2 text-sm text-slate-600">
            Only draft requirements can be deleted.
            This operation will be recorded in the audit history.
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
              onClick={confirmDeleteRequirement}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {deleteBusy ? "Deleting..." : "Confirm Delete"}
            </button>

            <button
              type="button"
              disabled={deleteBusy}
              onClick={() => {
                setDeletingRequirement(null);
                setDeleteError("");
              }}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {assigningRequirement && (
        <RequirementAssignmentForm
          key={assigningRequirement.id}
          requirementId={assigningRequirement.id}
          requirementTitle={`${assigningRequirement.requirement_code} - ${assigningRequirement.title}`}
          onClose={() => setAssigningRequirement(null)}
        />
      )}
      {showRequirementForm && !loading && !error && (
        <ProjectRequirementForm
          key={editingRequirement?.id ?? "create"}
          moduleId={moduleId}
          activities={activities}
          requirement={editingRequirement ?? undefined}
          onSaved={handleRequirementSaved}
          onCancel={closeRequirementForm}
        />
      )}

      {loading && (
        <p role="status" className="text-sm text-slate-500">
          Loading functional requirements...
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {!loading && !error && requirements.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No functional requirements registered for this module.
        </p>
      )}

      {!loading && !error && requirements.length > 0 && (
        <div className="space-y-2">
          {requirements.map(requirement => (
            <details
              key={requirement.id}
              className="relative rounded-lg border border-slate-200 bg-white p-3"
            >
              <summary className="cursor-pointer pr-12 font-medium text-slate-900">
                  {requirement.requirement_code} - {requirement.title}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    ({requirement.status})
                  </span>
                </summary>

              <div className="absolute right-3 top-3">
                <ActionMenu
                  label={`Actions for requirement ${requirement.requirement_code}`}
                  items={[
                    {
                      label: "Assign User",
                      onSelect: () => openAssignment(requirement),
                    },
                    {
                      label: "Edit Requirement",
                      disabled: requirement.status !== "DRAFT",
                      onSelect: () => openEditRequirement(requirement),
                    },
                    {
                      label: "Delete Requirement",
                      destructive: true,
                      disabled: requirement.status !== "DRAFT",
                      onSelect: () => openDeleteRequirement(requirement),
                    },
                  ]}
                />
              </div>

              <div className="mt-3 space-y-3 text-sm text-slate-700">
                <p>
                  <strong>Activity:</strong>{" "}
                  {requirement.activityCode
                    ? `${requirement.activityCode} - `
                    : ""}
                  {requirement.activityTitle}
                </p>

                <p>
                  <strong>Priority:</strong> {requirement.priority}
                </p>

                <p className="whitespace-pre-wrap">
                  {requirement.description}
                </p>

                <div>
                  <strong>Acceptance Criteria</strong>
                  <p className="mt-1 whitespace-pre-wrap">
                    {requirement.acceptance_criteria || "Not specified"}
                  </p>
                </div>

                <p className="text-xs text-slate-500">
                  Display Order: {requirement.display_order} |
                  {requirement.is_active ? " Active" : " Inactive"}
                </p>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}