"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  requirementId: string;
  commentId: string;
  initialTitle: string;
  initialDescription: string;
  initialAcceptanceCriteria: string | null;
};

type ApiResponse = {
  success: boolean;
  message: string;
  data: { id: string; status: string } | null;
};

export default function DeveloperCorrectionForm({
  requirementId,
  commentId,
  initialTitle,
  initialDescription,
  initialAcceptanceCriteria,
}: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [criteria, setCriteria] = useState(
    initialAcceptanceCriteria ?? ""
  );
  const [explanation, setExplanation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (saving || createdId) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/requirements/${requirementId}/corrections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            comment_id: commentId,
            proposed_title: title.trim(),
            proposed_description: description.trim(),
            proposed_acceptance_criteria: criteria.trim() || null,
            correction_explanation: explanation.trim(),
          }),
        }
      );

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success || !result.data?.id) {
        throw new Error(result.message || "Unable to save correction");
      }

      setCreatedId(result.data.id);
      setMessage("Correction draft saved successfully.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save correction"
      );
    } finally {
      setSaving(false);
    }
  }

  async function submitDraft() {
    if (!createdId || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `/api/requirements/${requirementId}/corrections/${createdId}/submit`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );

      const result: ApiResponse = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Unable to submit correction");
      }

      setMessage("Correction submitted to the Lead Reviewer.");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to submit correction"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={saveDraft}
      className="mt-4 space-y-4 rounded-lg border border-blue-200 bg-white p-4"
    >
      <h4 className="font-semibold text-slate-900">
        Prepare Correction
      </h4>

      <div>
        <label
          htmlFor={`title-${commentId}`}
          className="block text-sm font-medium text-slate-700"
        >
          Proposed Title
        </label>
        <input
          id={`title-${commentId}`}
          value={title}
          onChange={event => setTitle(event.target.value)}
          maxLength={255}
          required
          disabled={saving || Boolean(createdId)}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor={`description-${commentId}`}
          className="block text-sm font-medium text-slate-700"
        >
          Proposed Description
        </label>
        <textarea
          id={`description-${commentId}`}
          value={description}
          onChange={event => setDescription(event.target.value)}
          maxLength={20000}
          rows={5}
          required
          disabled={saving || Boolean(createdId)}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor={`criteria-${commentId}`}
          className="block text-sm font-medium text-slate-700"
        >
          Proposed Acceptance Criteria
        </label>
        <textarea
          id={`criteria-${commentId}`}
          value={criteria}
          onChange={event => setCriteria(event.target.value)}
          maxLength={20000}
          rows={3}
          disabled={saving || Boolean(createdId)}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>

      <div>
        <label
          htmlFor={`explanation-${commentId}`}
          className="block text-sm font-medium text-slate-700"
        >
          Correction Explanation
        </label>
        <textarea
          id={`explanation-${commentId}`}
          value={explanation}
          onChange={event => setExplanation(event.target.value)}
          minLength={10}
          maxLength={10000}
          rows={3}
          required
          disabled={saving || Boolean(createdId)}
          className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {message && (
        <p role="status" className="text-sm text-green-700">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {!createdId ? (
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
        ) : (
          <button
            type="button"
            onClick={submitDraft}
            disabled={saving}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Submitting..." : "Submit to Lead Reviewer"}
          </button>
        )}
      </div>
    </form>
  );
}