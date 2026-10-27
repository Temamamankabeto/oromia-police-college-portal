import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="User Management"
      description="Manage staff accounts and access roles."
      allowedRoles={["ADMIN"]}
    />
  );
}
