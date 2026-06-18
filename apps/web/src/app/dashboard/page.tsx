import { authOrPreview, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { posts, contacts } from "@margot/schema";
import { eq, gte, and, count, inArray, desc } from "drizzle-orm";
import Link from "next/link";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still at it";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good evening";
}

export default async function DashboardPage() {
  const session = await authOrPreview();
  if (!session?.user) redirect("/sign-in");

  const userId = session.user.id!;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [postsThisWeekResult, warmLeadsResult, latestDraft] = await Promise.all([
    db
      .select({ count: count() })
      .from(posts)
      .where(and(eq(posts.userId, userId), gte(posts.createdAt, sevenDaysAgo))),
    db
      .select({ count: count() })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), inArray(contacts.status, ["lead", "prospect"]))),
    db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(and(eq(posts.userId, userId), eq(posts.status, "draft")))
      .orderBy(desc(posts.updatedAt))
      .limit(1),
  ]);

  const postsThisWeek = postsThisWeekResult[0]?.count ?? 0;
  const warmLeads = warmLeadsResult[0]?.count ?? 0;
  const hasName = !!(session.user.name?.trim());
  const draft = latestDraft[0] ?? null;
  const greeting = getGreeting();

  const nav = [
    { label: "Posts", href: "/dashboard/posts", icon: "✍️" },
    { label: "Signals", href: "/dashboard/signals", icon: "📡" },
    { label: "Contacts", href: "/dashboard/contacts", icon: "🤝" },
    { label: "Concepts", href: "/dashboard/concepts", icon: "💡" },
    { label: "Settings", href: "/dashboard/settings", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      {/* Topbar */}
      <header className="flex items-center justify-between px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">Margot</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:block">
            {session.user.name ?? session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6 space-y-6">

        {/* Right Now: greeting */}
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">Right now</p>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {greeting}, {session.user.name?.split(" ")[0] ?? "there"} 👋
          </h1>
        </div>

        {/* Stats tiles */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Posts this week</p>
            <p className="text-3xl font-bold text-indigo-600 dark:text-indigo-400">{postsThisWeek}</p>
          </div>
          <div className="rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Warm leads</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{warmLeads}</p>
          </div>
        </div>

        {/* Next Best Move */}
        <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 p-4">
          <p className="text-xs uppercase tracking-widest text-indigo-400 dark:text-indigo-500 mb-2">Next best move</p>
          {!hasName ? (
            <div>
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-1">Complete your profile to get started</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3">Margot needs to know who you are to give personalised recommendations.</p>
              <Link
                href="/dashboard/settings"
                className="inline-block text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Set up profile →
              </Link>
            </div>
          ) : draft ? (
            <div>
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-1">Finish your draft</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3 truncate">{draft.title}</p>
              <Link
                href={`/dashboard/posts`}
                className="inline-block text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                View drafts →
              </Link>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-100 mb-1">Create your first post</p>
              <p className="text-xs text-indigo-600 dark:text-indigo-400 mb-3">Start building your content pipeline.</p>
              <Link
                href="/dashboard/posts"
                className="inline-block text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Compose post →
              </Link>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-3">Quick actions</p>
          <div className="grid grid-cols-3 gap-3">
            <Link
              href="/dashboard/posts"
              className="flex flex-col items-center gap-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-center"
            >
              <span className="text-2xl">✍️</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Compose post</span>
            </Link>
            <Link
              href="/dashboard/brain-dump"
              className="flex flex-col items-center gap-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-center"
            >
              <span className="text-2xl">🧠</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Brain dump</span>
            </Link>
            <Link
              href="/dashboard/signals"
              className="flex flex-col items-center gap-2 rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors text-center"
            >
              <span className="text-2xl">📡</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">View signals</span>
            </Link>
          </div>
        </div>
      </main>

      {/* Bottom nav (mobile-first) */}
      <nav className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex justify-around px-2 py-2 sm:hidden">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
          >
            <span className="text-lg">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Sidebar nav (desktop) */}
      <aside className="hidden sm:flex fixed left-0 top-0 h-full w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex-col pt-16 pb-4 px-3">
        <div className="flex-1 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </aside>
    </div>
  );
}
