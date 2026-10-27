import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="Institutional Modules"
      description="Manage the 32 institutional modules and their activities."
      allowedRoles={["ADMIN", "REVIEWER", "APPROVER"]}
    />
  );
}
