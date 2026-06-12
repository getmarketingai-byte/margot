import { authOrPreview, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const session = await authOrPreview();

  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Topbar */}
      <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">
          Margot
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600 dark:text-gray-400">
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
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
          Dashboard
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { title: "Content pipeline", count: 0, icon: "✍️", href: "/dashboard/posts" },
            { title: "Market signals", count: 0, icon: "📡", href: "/dashboard/signals" },
            { title: "Contacts", count: 0, icon: "🤝", href: "/dashboard/contacts" },
            { title: "Ideas & concepts", count: 0, icon: "💡", href: "/dashboard/concepts" },
            { title: "Prompt library", count: 0, icon: "🧠", href: "/dashboard/prompts" },
            { title: "Agent runs", count: 0, icon: "🤖", href: "/dashboard/agents" },
          ].map((card) => (
            <a
              key={card.title}
              href={card.href}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl">{card.icon}</span>
                <span className="text-2xl font-bold text-gray-900 dark:text-white">
                  {card.count}
                </span>
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {card.title}
              </p>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
