import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ApprovalsManager from "@/components/portal/approvals-manager";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  if (
    user.role_code !== "ADMIN" &&
    user.role_code !== "APPROVER"
  ) {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <ApprovalsManager role={user.role_code} />
    </DashboardShell>
  );
}
