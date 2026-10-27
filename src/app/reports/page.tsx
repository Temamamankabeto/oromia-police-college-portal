import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="Reports"
      description="Monitor institutional modules and proposal review progress."
      allowedRoles={["ADMIN", "REVIEWER", "APPROVER"]}
    />
  );
}
