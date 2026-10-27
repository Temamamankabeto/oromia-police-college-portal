import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";

export const dynamic = "force-dynamic";

const roleTitles = {
  ADMIN: "Administration Dashboard",
  REVIEWER: "Reviewer Dashboard",
  APPROVER: "Approver Dashboard",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <div className="space-y-8">
        <div>
          <p className="text-sm font-semibold text-blue-900">
            Welcome, {user.full_name}
          </p>
          <h2 className="mt-2 text-3xl font-bold text-slate-900">
            {roleTitles[user.role_code]}
          </h2>
          <p className="mt-2 text-slate-500">
            Manage institutional proposals, review progress,
            and monitor approval activities.
          </p>
        </div>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {[
            "Institutional Modules",
            "Activities",
            "Pending Reviews",
            "Pending Approvals",
          ].map((label) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm text-slate-500">{label}</p>
              <p className="mt-3 text-3xl font-bold text-blue-950">
                —
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Awaiting database connection
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold">
              Proposal Management
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Access institutional modules, review their
              activities, and track requested revisions.
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold">
              Review and Approval Workflow
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              Reviewers submit feedback and approvers record
              decisions. Workflow data will appear after
              database configuration.
            </p>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
