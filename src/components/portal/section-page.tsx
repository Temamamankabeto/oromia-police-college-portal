import { redirect } from "next/navigation";
import { getCurrentUser, type UserRole } from "@/lib/auth/current-user";
import DashboardShell from "@/components/portal/dashboard-shell";



type Props = {
  title: string;
  description: string;
  allowedRoles: UserRole[];
};

export default async function SectionPage({
  title,
  description,
  allowedRoles,
}: Props) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (!allowedRoles.includes(user.role_code)) {
    redirect("/dashboard");
  }

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">
            {title}
          </h2>
          <p className="mt-2 text-slate-500">
            {description}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <h3 className="text-lg font-semibold text-blue-950">
            {title} Workspace
          </h3>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            This section is ready for its database-backed
            management forms, tables, and workflow actions.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
