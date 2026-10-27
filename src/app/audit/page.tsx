import SectionPage from "@/components/portal/section-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <SectionPage
      title="Audit History"
      description="Review recorded system activities and changes."
      allowedRoles={["ADMIN"]}
    />
  );
}
