import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="Proposal Reviews"
      description="Review proposals, submit comments, and track corrections."
      allowedRoles={["ADMIN", "REVIEWER", "APPROVER"]}
    />
  );
}
