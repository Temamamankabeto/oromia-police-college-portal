"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  requirementId: string;
  correctionId: string;
};

type ApiResponse = {
  success: boolean;
  message: string;
  data: {
    id: string;
    status: string;
  } | null;
};

export default function DeveloperCorrectionSubmit({
  requirementId,
  correctionId,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (submitting || submitted) return;

    setSubmitting(true);
    setError("");

    try {
      const response = await fetch(
        `/api/requirements/${requirementId}/corrections/${correctionId}/submit`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result: ApiResponse = await response.json();

      if (
        !response.ok ||
        !result.success ||
        result.data?.status !== "SUBMITTED"
      ) {
        throw new Error(
          result.message || "Unable to submit correction"
        );
      }

      setSubmitted(true);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to submit correction"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || submitted}
        className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting
          ? "Submitting..."
          : submitted
            ? "Submitted to Lead Reviewer"
            : "Submit to Lead Reviewer"}
      </button>

      {submitted && (
        <p role="status" className="text-sm text-green-700">
          Correction submitted successfully.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}