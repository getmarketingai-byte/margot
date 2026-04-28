"use client";

import { useState, type FormEvent } from "react";

interface FeedbackFormProps {
  contactEmail: string;
  userEmail?: string | null;
}

type Kind = "bug" | "feature" | "other";

const KIND_LABEL: Record<Kind, string> = {
  bug: "Bug report",
  feature: "Feature request",
  other: "Other feedback"
};

const KIND_TAG: Record<Kind, string> = {
  bug: "[Bug]",
  feature: "[Feature]",
  other: "[Feedback]"
};

/**
 * Bug / feature request form. On submit, opens the user's mail client via a
 * `mailto:` link prefilled with a tagged subject, the description they typed,
 * and a small triage footer (account email, current URL, user agent). We don't
 * post to a server — we lean on the OS mail handler so users get a copy in
 * their Sent folder and we don't need transactional email infra.
 */
export function FeedbackForm({ contactEmail, userEmail }: FeedbackFormProps) {
  const [kind, setKind] = useState<Kind>("bug");
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [opened, setOpened] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const finalSubject = `${KIND_TAG[kind]} ${subject.trim() || "(no subject)"}`;
    const meta = [
      userEmail ? `Account: ${userEmail}` : null,
      typeof window !== "undefined" ? `URL: ${window.location.href}` : null,
      typeof navigator !== "undefined" ? `User agent: ${navigator.userAgent}` : null
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n");
    const body = `${details.trim()}\n\n---\n${meta}`;
    const href = `mailto:${contactEmail}?subject=${encodeURIComponent(
      finalSubject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    setOpened(true);
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs">
        Type
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="field"
        >
          <option value="bug">{KIND_LABEL.bug}</option>
          <option value="feature">{KIND_LABEL.feature}</option>
          <option value="other">{KIND_LABEL.other}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Subject
        <input
          name="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Short summary"
          maxLength={120}
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        Details
        <textarea
          name="details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={5}
          required
          placeholder="What happened, what you expected, and any steps to reproduce."
          className="field"
        />
        <span className="text-[11px] text-ink-400">
          We&apos;ll include your account email and current page so we can follow up.
        </span>
      </label>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <button type="submit" className="btn-primary w-full">
          Open in mail client
        </button>
        <p className="text-[11px] text-ink-400">
          Doesn&apos;t open your mail app? Email us directly at{" "}
          <a className="text-accent" href={`mailto:${contactEmail}`}>
            {contactEmail}
          </a>
          .
        </p>
        {opened ? (
          <p className="text-[11px] text-ink-400" role="status">
            Mail client opened — send the message from there to finish.
          </p>
        ) : null}
      </div>
    </form>
  );
}
