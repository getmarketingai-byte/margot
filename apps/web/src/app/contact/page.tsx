import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT, SITE_URL } from "@/lib/marketing";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Contact",
  description: `Get in touch with the Calendar Automations team for support, feedback, security disclosures, or press inquiries.`,
  alternates: { canonical: "/contact" }
};

export default function ContactPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <header className="flex flex-col gap-3">
        <Link href="/" className="text-xs uppercase tracking-widest text-ink-400">
          ← {PRODUCT.name}
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">Contact</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">
          The fastest path to a human is email. We answer support and security disclosures within
          two business days and we read everything else.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <article className="card flex flex-col gap-2">
          <h2 className="text-base font-semibold">Support and feedback</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Bug reports, feature requests, and general questions about how the product works.
          </p>
          <a className="text-sm font-medium text-accent" href={`mailto:${PRODUCT.contactEmail}`}>
            {PRODUCT.contactEmail}
          </a>
        </article>
        <article className="card flex flex-col gap-2">
          <h2 className="text-base font-semibold">Security disclosures</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            If you believe you have found a vulnerability, please email the address below with
            details and a reproduction. We acknowledge within two business days.
          </p>
          <a className="text-sm font-medium text-accent" href={`mailto:${PRODUCT.contactEmail}`}>
            {PRODUCT.contactEmail}
          </a>
        </article>
        <article className="card flex flex-col gap-2">
          <h2 className="text-base font-semibold">Privacy and data requests</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Account deletion is self-serve from the dashboard. For data export or any other request
            covered by your local privacy law, email us and reference the email on file with your
            account.
          </p>
          <a className="text-sm font-medium text-accent" href={`mailto:${PRODUCT.contactEmail}`}>
            {PRODUCT.contactEmail}
          </a>
        </article>
        <article className="card flex flex-col gap-2">
          <h2 className="text-base font-semibold">Press and partnerships</h2>
          <p className="text-sm text-ink-600 dark:text-ink-200">
            Mention requests, integration partnerships, or vendor evaluations. Please include a
            short brief.
          </p>
          <a className="text-sm font-medium text-accent" href={`mailto:${PRODUCT.contactEmail}`}>
            {PRODUCT.contactEmail}
          </a>
        </article>
      </section>

      <section className="card text-sm text-ink-600 dark:text-ink-200">
        <h2 className="text-base font-semibold text-ink-900 dark:text-ink-100">Response times</h2>
        <ul className="mt-2 list-disc pl-5">
          <li>Security disclosures: acknowledged within two business days.</li>
          <li>Support and feedback: typically within three business days.</li>
          <li>Press and partnerships: best effort.</li>
        </ul>
      </section>
    </main>
  );
}
