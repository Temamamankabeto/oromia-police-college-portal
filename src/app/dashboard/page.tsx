import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import DashboardShell from "@/components/portal/dashboard-shell";

export const dynamic = "force-dynamic";

type Stats = {
  total_modules: number;
  total_activities: number;
  pending_reviews: number;
  under_review: number;
  pending_approvals: number;
  approved: number;
  revision_requested: number;
  rejected: number;
  active_users: number;
};

const roleTitles = {
  ADMIN: "Administration Dashboard",
  REVIEWER: "Reviewer Dashboard",
  APPROVER: "Approver Dashboard",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  const result = await query<Stats>(
    `SELECT
       (SELECT COUNT(*)::integer FROM institutional_modules
        WHERE deleted_at IS NULL) AS total_modules,

       (SELECT COUNT(*)::integer
        FROM module_activities a
        JOIN institutional_modules m ON m.id = a.module_id
        WHERE a.deleted_at IS NULL
          AND m.deleted_at IS NULL) AS total_activities,

       (SELECT COUNT(*)::integer
        FROM institutional_modules m
        LEFT JOIN module_reviews r ON r.module_id = m.id
        WHERE m.deleted_at IS NULL
          AND COALESCE(r.approval_status, 'PENDING') = 'PENDING')
        AS pending_reviews,

       (SELECT COUNT(*)::integer
        FROM module_reviews r
        JOIN institutional_modules m ON m.id = r.module_id
        WHERE m.deleted_at IS NULL
          AND r.approval_status = 'UNDER_REVIEW')
        AS under_review,

       (SELECT COUNT(*)::integer
        FROM module_reviews r
        JOIN institutional_modules m ON m.id = r.module_id
        WHERE m.deleted_at IS NULL
          AND r.approval_status = 'READY_FOR_APPROVAL')
        AS pending_approvals,

       (SELECT COUNT(*)::integer
        FROM module_reviews r
        JOIN institutional_modules m ON m.id = r.module_id
        WHERE m.deleted_at IS NULL
          AND r.approval_status = 'APPROVED')
        AS approved,

       (SELECT COUNT(*)::integer
        FROM module_reviews r
        JOIN institutional_modules m ON m.id = r.module_id
        WHERE m.deleted_at IS NULL
          AND r.approval_status = 'REVISION_REQUESTED')
        AS revision_requested,

       (SELECT COUNT(*)::integer
        FROM module_reviews r
        JOIN institutional_modules m ON m.id = r.module_id
        WHERE m.deleted_at IS NULL
          AND r.approval_status = 'REJECTED')
        AS rejected,

       (SELECT COUNT(*)::integer FROM app_users
        WHERE is_active = TRUE AND deleted_at IS NULL)
        AS active_users`
  );

  const stats = result.rows[0];

  const cards = [
    { label: "Institutional Modules", value: stats.total_modules, href: "/modules" },
    { label: "Module Activities", value: stats.total_activities, href: "/modules" },
    { label: "Pending Reviews", value: stats.pending_reviews, href: "/reviews" },
    { label: "Under Review", value: stats.under_review, href: "/reviews" },
    { label: "Pending Approvals", value: stats.pending_approvals, href: "/approvals" },
    { label: "Approved Proposals", value: stats.approved, href: "/approvals" },
    { label: "Revision Requested", value: stats.revision_requested, href: "/reviews" },
    { label: "Rejected Proposals", value: stats.rejected, href: "/approvals" },
  ];

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div>
          <p className="text-sm font-semibold text-blue-900">
            Welcome, {user.full_name}
          </p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">
            {roleTitles[user.role_code]}
          </h1>
          <p className="mt-2 text-slate-500">
            Live institutional proposal, review and approval statistics.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map(card => (
            <Link
              key={card.label}
              href={card.href}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-400"
            >
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-3 text-3xl font-bold text-blue-950">
                {card.value}
              </p>
              <p className="mt-2 text-xs text-blue-700">
                View details
              </p>
            </Link>
          ))}
        </div>

        {user.role_code === "ADMIN" && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">
              Staff Accounts
            </h2>
            <p className="mt-3 text-3xl font-bold text-blue-950">
              {stats.active_users}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Active system users
            </p>
            <Link
              href="/users"
              className="mt-4 inline-block text-sm font-semibold text-blue-700 hover:underline"
            >
              Manage Users
            </Link>
          </section>
        )}
      </div>
    </DashboardShell>
  );
}
