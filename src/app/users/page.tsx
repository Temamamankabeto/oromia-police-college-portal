import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";
import UsersManager from "@/components/portal/users-manager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();

  if (!user) redirect("/login");

  if (user.role_code !== "ADMIN") {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <UsersManager currentUserId={user.id} />
    </DashboardShell>
  );
}
