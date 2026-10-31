import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import ReviewsManager from "@/components/portal/reviews-manager";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role_code !== "ADMIN" && user.role_code !== "REVIEWER") {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <ReviewsManager role={user.role_code} />
    </DashboardShell>
  );
}
