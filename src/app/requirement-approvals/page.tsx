import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import RequirementApprovalsManager from "@/components/portal/requirement-approvals-manager";

export const dynamic = "force-dynamic";

export default async function RequirementApprovalsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role_code !== "APPROVER") {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <RequirementApprovalsManager />
    </DashboardShell>
  );
}