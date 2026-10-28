"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Role = "ADMIN" | "REVIEWER" | "APPROVER";

type User = {
  id: string;
  full_name: string;
  email: string;
  role_code: Role;
  role_name: string;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

type Form = {
  full_name: string;
  email: string;
  password: string;
  role_code: Role;
  is_active: boolean;
};

const emptyForm: Form = {
  full_name: "",
  email: "",
  password: "",
  role_code: "REVIEWER",
  is_active: true,
};

export default function UsersManager({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    const response = await fetch("/api/users", {
      cache: "no-store",
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load users");
    }

    setUsers(result.data);
  }, []);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        const response = await fetch("/api/users", {
          cache: "no-store",
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load users");
        }

        if (active) setUsers(result.data);
      } catch (cause) {
        if (active) {
          setError(
            cause instanceof Error ? cause.message : "Unable to load users"
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return users.filter(
      user =>
        user.full_name.toLowerCase().includes(term) ||
        user.email.toLowerCase().includes(term) ||
        user.role_code.toLowerCase().includes(term)
    );
  }, [users, search]);

  function editUser(user: User) {
    setEditingId(user.id);
    setForm({
      full_name: user.full_name,
      email: user.email,
      password: "",
      role_code: user.role_code,
      is_active: user.is_active,
    });
    setError("");
    setMessage("");
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name,
        email: form.email,
        role_code: form.role_code,
      };

      if (editingId) {
        payload.is_active = form.is_active;
        if (form.password) payload.password = form.password;
      } else {
        payload.password = form.password;
      }

      const response = await fetch(
        editingId ? `/api/users/${editingId}` : "/api/users",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to save user");
      }

      await loadUsers();
      resetForm();
      setMessage(
        editingId
          ? "User updated successfully."
          : "User created successfully."
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to save user"
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: User) {
    if (saving || user.id === currentUserId) return;

    const action = user.is_active ? "deactivate" : "activate";

    if (!window.confirm(`Are you sure you want to ${action} ${user.full_name}?`)) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to change account status");
      }

      await loadUsers();
      setMessage(`Account ${action}d successfully.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to change account status"
      );
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          User Management
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage staff accounts, roles and system access.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {message && (
        <div role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-700">
          {message}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Staff Accounts
              </h2>
              <p className="text-xs text-slate-500">
                {users.length} total accounts
              </p>
            </div>

            <input
              aria-label="Search users"
              className={`${inputClass} max-w-xs`}
              placeholder="Search name, email or role"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">Loading users...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-500">No users found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th className="p-3">Name / Email</th>
                    <th className="p-3">Role</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(user => (
                    <tr key={user.id} className="border-b">
                      <td className="p-3">
                        <div className="font-medium text-slate-900">
                          {user.full_name}
                          {user.id === currentUserId ? " (You)" : ""}
                        </div>
                        <div className="text-xs text-slate-500">
                          {user.email}
                        </div>
                      </td>
                      <td className="p-3">{user.role_code}</td>
                      <td className="p-3">
                        <span className={
                          user.is_active
                            ? "font-medium text-green-700"
                            : "font-medium text-red-700"
                        }>
                          {user.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => editUser(user)}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            Edit
                          </button>
                          {user.id !== currentUserId && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void toggleActive(user)}
                              className="font-medium text-slate-700 hover:underline disabled:opacity-50"
                            >
                              {user.is_active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="h-fit rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            {editingId ? "Edit Staff Account" : "Create Staff Account"}
          </h2>

          <form onSubmit={event => void submit(event)} className="mt-5 space-y-4">
            <label className="block space-y-1 text-sm font-medium">
              <span>Full Name</span>
              <input
                required
                minLength={2}
                maxLength={150}
                className={inputClass}
                value={form.full_name}
                onChange={event =>
                  setForm({ ...form, full_name: event.target.value })
                }
              />
            </label>

            <label className="block space-y-1 text-sm font-medium">
              <span>Email</span>
              <input
                required
                type="email"
                maxLength={255}
                className={inputClass}
                value={form.email}
                onChange={event =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>

            <label className="block space-y-1 text-sm font-medium">
              <span>Role</span>
              <select
                className={inputClass}
                value={form.role_code}
                disabled={
                  editingId === currentUserId
                }
                onChange={event =>
                  setForm({
                    ...form,
                    role_code: event.target.value as Role,
                  })
                }
              >
                <option value="ADMIN">Administrator</option>
                <option value="REVIEWER">Reviewer</option>
                <option value="APPROVER">Approver</option>
              </select>
            </label>

            <label className="block space-y-1 text-sm font-medium">
              <span>
                {editingId
                  ? "New Password (leave blank to keep existing)"
                  : "Password"}
              </span>
              <input
                type="password"
                required={!editingId}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                className={inputClass}
                value={form.password}
                onChange={event =>
                  setForm({ ...form, password: event.target.value })
                }
              />
            </label>

            {editingId && editingId !== currentUserId && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={event =>
                    setForm({
                      ...form,
                      is_active: event.target.checked,
                    })
                  }
                />
                Account Active
              </label>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving..." : editingId ? "Save Changes" : "Create User"}
              </button>

              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border px-4 py-2 text-sm"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
