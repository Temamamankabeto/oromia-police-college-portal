"use client";

import { useEffect, useMemo, useState } from "react";

type Role = "REVIEWER" | "DEVELOPER" | "APPROVER" | "TESTER";

type User = {
  id: string;
  full_name: string;
  email: string;
  role_code: string;
  is_active: boolean;
};

type Assignment = {
  id: string;
  requirement_id: string;
  user_id: string;
  full_name: string;
  email: string;
  role_code: Role;
  assigned_at: string;
  revoked_at: string | null;
  is_lead: boolean;
};

type Props = {
  requirementId: string;
  requirementTitle: string;
  onClose: () => void;
};

const roles: Role[] = ["REVIEWER", "DEVELOPER", "APPROVER", "TESTER"];

export default function RequirementAssignmentForm({
  requirementId,
  requirementTitle,
  onClose,
}: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [role, setRole] = useState<Role>("REVIEWER");
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const endpoint = `/api/requirements/${encodeURIComponent(requirementId)}/assignments`;

  const eligibleUsers = useMemo(
    () =>
      users.filter(
        (user) => user.is_active && user.role_code === role
      ),
    [users, role]
  );

  async function loadAssignments() {
    const response = await fetch(endpoint, {
      credentials: "same-origin",
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || result.error || "Unable to load assignments.");
    }

    setAssignments(result.data ?? []);
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const [usersResponse, assignmentsResponse] = await Promise.all([
          fetch("/api/users", {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          }),
          fetch(
            `/api/requirements/${encodeURIComponent(requirementId)}/assignments`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: controller.signal,
            }
          ),
        ]);

        const [usersResult, assignmentsResult] = await Promise.all([
          usersResponse.json(),
          assignmentsResponse.json(),
        ]);

        if (!usersResponse.ok || !usersResult.success) {
          throw new Error(usersResult.message || usersResult.error || "Unable to load users.");
        }

        if (!assignmentsResponse.ok || !assignmentsResult.success) {
          throw new Error(
            assignmentsResult.message ||
              assignmentsResult.error ||
              "Unable to load assignments."
          );
        }

        if (!controller.signal.aborted) {
          setUsers(usersResult.data ?? []);
          setAssignments(assignmentsResult.data ?? []);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setError(
            caught instanceof Error ? caught.message : "Unable to load assignment data."
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [requirementId]);

  async function assign() {
    if (!userId || busy) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, role_code: role }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || "Assignment failed.");
      }

      await loadAssignments();
      setUserId("");
      setNotice("User assigned successfully.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  async function setLeadReviewer(assignment: Assignment) {
    if (
      busy ||
      assignment.revoked_at ||
      assignment.role_code !== "REVIEWER" ||
      assignment.is_lead
    ) {
      return;
    }

    const currentLead = assignments.find(
      (item) =>
        item.role_code === "REVIEWER" &&
        item.is_lead &&
        !item.revoked_at
    );

    const confirmation = currentLead
      ? `Transfer Lead Reviewer responsibility from ${currentLead.full_name} to ${assignment.full_name}?`
      : `Designate ${assignment.full_name} as Lead Reviewer?`;

    if (!window.confirm(confirmation)) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assignment_id: assignment.id,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
            result.error ||
            "Unable to update Lead Reviewer."
        );
      }

      await loadAssignments();

      setNotice(
        `${assignment.full_name} is now the Lead Reviewer.`
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update Lead Reviewer."
      );
    } finally {
      setBusy(false);
    }
  }
  async function revoke(assignment: Assignment) {
    if (busy || assignment.revoked_at) return;

    if (!window.confirm(`Revoke ${assignment.role_code} assignment for ${assignment.full_name}?`)) {
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        `${endpoint}?assignmentId=${encodeURIComponent(assignment.id)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || result.error || "Unable to revoke assignment.");
      }

      await loadAssignments();
      setNotice("Assignment revoked successfully.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to revoke assignment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-blue-200 bg-blue-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-base font-semibold text-slate-900">
            Requirement Assignment
          </h5>
          <p className="mt-1 text-sm text-slate-600">{requirementTitle}</p>
        </div>

        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
        >
          Close
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}

      {loading ? (
        <p role="status" className="text-sm text-slate-500">
          Loading assignment information...
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Assignment Role</span>
              <select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as Role);
                  setUserId("");
                }}
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {roles.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1 text-sm font-medium text-slate-700">
              <span>Responsible User</span>
              <select
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Select a user</option>
                {eligibleUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name} ({user.email})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={assign}
            disabled={busy || !userId}
            className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Processing..." : "Assign User"}
          </button>

          <div className="space-y-3">
            <h6 className="font-semibold text-slate-900">
              Assignment History
            </h6>

            {assignments.length === 0 ? (
              <p className="text-sm text-slate-500">
                No assignments recorded.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th scope="col" className="p-3">User</th>
                      <th scope="col" className="p-3">Role</th>
                      <th scope="col" className="p-3">Status</th>
                      <th scope="col" className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignments.map((assignment) => (
                      <tr key={assignment.id} className="border-t border-slate-100">
                        <td className="p-3">{assignment.full_name}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{assignment.role_code}</span>
                            {assignment.is_lead && !assignment.revoked_at && (
                              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                Lead Reviewer
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          {assignment.revoked_at ? "Revoked" : "Active"}
                        </td>
                        <td className="p-3">
                          {!assignment.revoked_at && (
                            <div className="flex flex-wrap items-center gap-3">
                              {assignment.role_code === "REVIEWER" &&
                                !assignment.is_lead && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => setLeadReviewer(assignment)}
                                    className="text-sm font-semibold text-blue-800 hover:underline disabled:opacity-50"
                                    aria-label={`Set ${assignment.full_name} as Lead Reviewer`}
                                  >
                                    Set as Lead
                                  </button>
                                )}

                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => revoke(assignment)}
                                className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50"
                              >
                                Revoke
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}