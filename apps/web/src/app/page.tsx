import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
          Margot
        </span>
        <Link
          href="/sign-in"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
        >
          Sign in
        </Link>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 dark:text-white max-w-2xl">
          Your AI marketing cockpit
        </h1>
        <p className="mt-6 text-lg text-gray-600 dark:text-gray-400 max-w-xl">
          Margot helps entrepreneurs plan content, track market signals, and
          manage client relationships — all in one place.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/sign-in"
            className="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Get started free
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-16 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              title: "Content pipeline",
              description:
                "Draft, schedule, and publish posts across channels with AI assistance.",
              icon: "✍️",
            },
            {
              title: "Market signals",
              description:
                "Capture and search industry signals to stay ahead of trends.",
              icon: "📡",
            },
            {
              title: "CRM",
              description:
                "Track leads, prospects, and clients with AI-suggested next actions.",
              icon: "🤝",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-gray-200 dark:border-gray-700 p-6"
            >
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {f.title}
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-6 py-6 text-center text-sm text-gray-500 dark:text-gray-500">
        © {new Date().getFullYear()} Margot. Built for Australian entrepreneurs.
      </footer>
    </main>
  );
}
