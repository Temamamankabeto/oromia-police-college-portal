import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ModulesManager from "@/components/portal/modules-manager";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <ModulesManager canManage={user.role_code === "ADMIN"} />
    </DashboardShell>
  );
}
