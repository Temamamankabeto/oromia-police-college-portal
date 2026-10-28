import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import DataTableManager from "@/components/portal/data-table-manager";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  return (
    <DashboardShell>
      <DataTableManager mode="reports" />
    </DashboardShell>
  );
}
