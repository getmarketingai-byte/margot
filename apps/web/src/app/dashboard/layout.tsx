import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

const NAV = [
  { href: "/dashboard", label: "Home" },
  { href: "/dashboard/goals", label: "Goals" },
  { href: "/dashboard/calendars", label: "Calendars" },
  { href: "/dashboard/frameworks", label: "Frameworks" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/feeds", label: "Feeds" },
  { href: "/dashboard/billing", label: "Billing" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-28 pt-6 sm:max-w-4xl">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          Calendar Automations
        </Link>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="text-xs text-ink-400 hover:text-ink-900 dark:hover:text-ink-100" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <main className="flex-1">{children}</main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-3xl border-t border-ink-200 bg-white/95 backdrop-blur dark:border-ink-600 dark:bg-ink-900/90 sm:max-w-4xl"
      >
        <ul className="flex overflow-x-auto px-2">
          {NAV.map((item) => (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                className="block px-3 py-3 text-xs font-medium text-ink-600 hover:text-ink-900 dark:text-ink-200 dark:hover:text-ink-100"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
