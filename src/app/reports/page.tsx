import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ReportsDashboard from "@/components/portal/reports-dashboard";
import DataTableManager from "@/components/portal/data-table-manager";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <DashboardShell>
      <div className="space-y-8">
        <ReportsDashboard />

        <section
          aria-label="Detailed institutional reports"
          className="border-t border-slate-200 pt-8"
        >
          <DataTableManager mode="reports" />
        </section>
      </div>
    </DashboardShell>
  );
}