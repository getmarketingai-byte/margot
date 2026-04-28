import Link from "next/link";
import { JsonLd } from "./json-ld";
import { articleLd } from "@/lib/json-ld";
import type { Article } from "@/lib/marketing";

export function ArticleLayout({
  article,
  answer,
  children
}: {
  article: Article;
  answer: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-16 pt-10 sm:max-w-3xl">
      <JsonLd data={articleLd(article)} />
      <header className="flex flex-col gap-3">
        <Link href="/learn" className="text-xs uppercase tracking-widest text-ink-400">
          ← Learn
        </Link>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{article.title}</h1>
        <p className="text-ink-600 dark:text-ink-200 sm:text-lg">{article.description}</p>
        <p className="text-xs text-ink-400">
          Published {new Date(article.publishedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric"
          })}
        </p>
      </header>

      <section
        aria-label="Direct answer"
        className="card border-l-4 border-l-accent text-sm leading-relaxed text-ink-900 dark:text-ink-100"
      >
        <p className="font-semibold uppercase tracking-wider text-ink-400">In short</p>
        <p className="mt-2">{answer}</p>
      </section>

      <article className="prose-base flex flex-col gap-5 text-sm leading-relaxed text-ink-600 dark:text-ink-200 sm:text-base">
        {children}
      </article>
    </main>
  );
}
