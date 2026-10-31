import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import DeveloperRequirementsManager from "@/components/portal/developer-requirements-manager";

export const dynamic = "force-dynamic";
export default async function DeveloperRequirementsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role_code !== "DEVELOPER") redirect("/dashboard");
  return <DashboardShell><DeveloperRequirementsManager /></DashboardShell>;
}