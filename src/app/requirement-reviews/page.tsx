import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import RequirementReviewsManager from "@/components/portal/requirement-reviews-manager";

export const dynamic = "force-dynamic";

export default async function RequirementReviewsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (
    user.role_code !== "ADMIN" &&
    user.role_code !== "REVIEWER"
  ) {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <RequirementReviewsManager />
    </DashboardShell>
  );
}