import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { query } from "@/lib/db";
import DashboardShell from "@/components/portal/dashboard-shell";
import DeveloperCorrectionForm from "@/components/portal/developer-correction-form";
import DeveloperCorrectionSubmit from "@/components/portal/developer-correction-submit";

export const dynamic = "force-dynamic";

type ReviewComment = {
  id: string;
  comment_type: string;
  comment_text: string;
  resolution_status: string;
};

type Correction = {
  id: string;
  comment_id: string;
  proposed_title: string;
  proposed_description: string;
  proposed_acceptance_criteria: string | null;
  correction_explanation: string;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_remarks: string | null;
};

type AssignedRequirement = {
  requirement_id: string;
  requirement_code: string;
  title: string;
  description: string;
  acceptance_criteria: string | null;
  requirement_status: string;
  lifecycle_status: string;
  comments: ReviewComment[];
  corrections: Correction[];
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-700",
    SUBMITTED: "bg-blue-100 text-blue-800",
    ACCEPTED: "bg-green-100 text-green-800",
    RETURNED: "bg-amber-100 text-amber-800",
    OPEN: "bg-amber-100 text-amber-800",
    IN_PROGRESS: "bg-blue-100 text-blue-800",
    REOPENED: "bg-orange-100 text-orange-800",
    RESOLVED: "bg-green-100 text-green-800",
    UNDER_REVIEW: "bg-blue-100 text-blue-800",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
        styles[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function DeveloperCorrectionsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role_code !== "DEVELOPER") {
    redirect("/dashboard");
  }

  const result = await query<AssignedRequirement>(
    `SELECT
       fr.id::text AS requirement_id,
       fr.requirement_code,
       fr.title,
       fr.description,
       fr.acceptance_criteria,
       fr.status AS requirement_status,
       rl.lifecycle_status,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', rc.id::text,
               'comment_type', rc.comment_type,
               'comment_text', rc.comment_text,
               'resolution_status', rc.resolution_status
             )
             ORDER BY rc.created_at, rc.id
           )
           FROM requirement_review_comments rc
           WHERE rc.requirement_id = fr.id
         ),
         '[]'::jsonb
       ) AS comments,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', c.id::text,
               'comment_id', c.comment_id::text,
               'proposed_title', c.proposed_title,
               'proposed_description', c.proposed_description,
               'proposed_acceptance_criteria',
                 c.proposed_acceptance_criteria,
               'correction_explanation', c.correction_explanation,
               'status', c.status,
               'submitted_at', c.submitted_at,
               'reviewed_at', c.reviewed_at,
               'review_remarks', c.review_remarks
             )
             ORDER BY c.created_at DESC, c.id DESC
           )
           FROM requirement_corrections c
           WHERE c.requirement_id = fr.id
             AND (
               c.status <> 'DRAFT'
               OR c.developer_id = $1
             )
         ),
         '[]'::jsonb
       ) AS corrections
     FROM requirement_assignments ra
     JOIN activity_functional_requirements fr
       ON fr.id = ra.requirement_id
     JOIN requirement_lifecycle rl
       ON rl.requirement_id = fr.id
     JOIN institutional_modules m
       ON m.id = fr.module_id
     JOIN projects p
       ON p.id = m.project_id
     WHERE ra.user_id = $1
       AND ra.role_code = 'DEVELOPER'
       AND ra.revoked_at IS NULL
       AND fr.deleted_at IS NULL
       AND fr.is_active = TRUE
       AND m.deleted_at IS NULL
       AND m.is_active = TRUE
       AND p.deleted_at IS NULL
     ORDER BY fr.requirement_code, fr.id`,
    [user.id]
  );

  const requirements = result.rows;
  const findingCount = requirements.reduce(
    (total, requirement) => total + requirement.comments.length,
    0
  );
  const correctionCount = requirements.reduce(
    (total, requirement) => total + requirement.corrections.length,
    0
  );

  return (
    <DashboardShell>
      <section className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900">
            My Corrections
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Review assigned requirements, findings, and correction history.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Assigned Requirements", value: requirements.length },
            { label: "Review Comments", value: findingCount },
            { label: "Corrections", value: correctionCount },
          ].map(item => (
            <div
              key={item.label}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm text-slate-600">{item.label}</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {requirements.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <p className="text-sm text-slate-600">
              No active requirements are assigned to your account.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {requirements.map(requirement => (
              <article
                key={requirement.requirement_id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-800">
                      {requirement.requirement_code}
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-slate-900">
                      {requirement.title}
                    </h2>
                  </div>
                  <StatusBadge status={requirement.lifecycle_status} />
                </div>

                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                  {requirement.description}
                </p>

                <div className="mt-6 space-y-4">
                  <h3 className="font-semibold text-slate-900">
                    Review Comments ({requirement.comments.length})
                  </h3>

                  {requirement.comments.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No review comments recorded.
                    </p>
                  ) : (
                    requirement.comments.map(comment => {
                      const related = requirement.corrections.filter(
                        correction => correction.comment_id === comment.id
                      );

                      const draft = related.find(
                        correction => correction.status === "DRAFT"
                      );

                      const hasSubmitted = related.some(
                        correction => correction.status === "SUBMITTED"
                      );

                      const hasAccepted = related.some(
                        correction => correction.status === "ACCEPTED"
                      );

                      const canPrepare =
                        requirement.requirement_status === "UNDER_REVIEW" &&
                        requirement.lifecycle_status === "UNDER_REVIEW" &&
                        comment.resolution_status !== "RESOLVED" &&
                        !draft &&
                        !hasSubmitted &&
                        !hasAccepted;

                      return (
                        <div
                          key={comment.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              {comment.comment_type.replaceAll("_", " ")} #{comment.id}
                            </p>
                            <StatusBadge status={comment.resolution_status} />
                          </div>

                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            {comment.comment_text}
                          </p>

                          <div className="mt-4 space-y-3">
                            {related.length === 0 ? (
                              <p className="text-sm text-slate-500">
                                No correction submitted for this comment.
                              </p>
                            ) : (
                              related.map(correction => (
                                <div
                                  key={correction.id}
                                  className="rounded-lg border border-slate-200 bg-white p-4"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="font-semibold text-slate-900">
                                      Correction #{correction.id}
                                    </p>
                                    <StatusBadge status={correction.status} />
                                  </div>

                                  <p className="mt-3 text-sm font-medium text-slate-900">
                                    {correction.proposed_title}
                                  </p>

                                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                                    {correction.proposed_description}
                                  </p>

                                  {correction.proposed_acceptance_criteria && (
                                    <div className="mt-3">
                                      <p className="text-xs font-semibold uppercase text-slate-500">
                                        Acceptance Criteria
                                      </p>
                                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                                        {correction.proposed_acceptance_criteria}
                                      </p>
                                    </div>
                                  )}

                                  <p className="mt-3 text-sm text-slate-600">
                                    <span className="font-semibold">
                                      Explanation:
                                    </span>{" "}
                                    {correction.correction_explanation}
                                  </p>

                                  {correction.review_remarks && (
                                    <div className="mt-3 rounded-lg bg-amber-50 p-3">
                                      <p className="text-xs font-semibold text-amber-900">
                                        Lead Reviewer Remarks
                                      </p>
                                      <p className="mt-1 text-sm text-amber-900">
                                        {correction.review_remarks}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>

                          {canPrepare && (
                            <DeveloperCorrectionForm
                              key={`${requirement.requirement_id}-${comment.id}`}
                              requirementId={requirement.requirement_id}
                              commentId={comment.id}
                              initialTitle={requirement.title}
                              initialDescription={requirement.description}
                              initialAcceptanceCriteria={
                                requirement.acceptance_criteria
                              }
                            />
                          )}

                          {draft &&
                            requirement.requirement_status === "UNDER_REVIEW" &&
                            requirement.lifecycle_status === "UNDER_REVIEW" &&
                            comment.resolution_status !== "RESOLVED" && (
                              <div className="mt-3">
                                <p className="text-sm text-blue-800">
                                  Correction #{draft.id} is saved as a draft.
                                </p>

                                <DeveloperCorrectionSubmit
                                  requirementId={requirement.requirement_id}
                                  correctionId={draft.id}
                                />
                              </div>
                            )}
                        </div>
                      );
                    })
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </DashboardShell>
  );
}