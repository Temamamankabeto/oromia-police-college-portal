import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ModulesManager from "@/components/portal/modules-manager";

export const dynamic = "force-dynamic";

type ModulesPageProps = {
  searchParams: Promise<{
    projectId?: string | string[];
    action?: string | string[];
  }>;
};

export default async function ModulesPage({
  searchParams,
}: ModulesPageProps) {
  const user = await getCurrentUser();
  const params = await searchParams;

  const projectId =
    typeof params.projectId === "string" &&
    /^[1-9]\d*$/.test(params.projectId)
      ? params.projectId
      : "";

  const createRequested = params.action === "create";

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell>
      <ModulesManager
          canManage={user.role_code === "ADMIN"}
          initialProjectId={projectId}
          initialCreate={createRequested}
        />
    </DashboardShell>
  );
}
