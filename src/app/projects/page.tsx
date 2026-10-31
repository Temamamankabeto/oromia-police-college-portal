import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ProjectsManager from "@/components/portal/projects-manager";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role_code !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <ProjectsManager />
    </DashboardShell>
  );
}