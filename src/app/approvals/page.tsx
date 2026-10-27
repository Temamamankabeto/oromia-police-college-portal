import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="Proposal Approvals"
      description="Review decisions and approve or return proposals."
      allowedRoles={["ADMIN", "APPROVER"]}
    />
  );
}
