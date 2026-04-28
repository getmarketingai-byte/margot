import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { loadBillingState } from "@/lib/billing-state-server";
import { AccountMenu } from "./account-menu";
import { BillingBanner } from "./billing-banner";

const PRIMARY_NAV = [
  { href: "/dashboard/plan", label: "Perfect Week" },
  { href: "/dashboard/energy", label: "Energy" },
  { href: "/dashboard/calendars", label: "Calendars" }
];

const ACCOUNT_LINKS = [
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/constraints", label: "Constraints" },
  { href: "/dashboard/calendars#ical-feeds", label: "iCal feeds" },
  { href: "/dashboard/billing", label: "Billing" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/dashboard");
  const billing = await loadBillingState(session.user.id);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-28 pt-6 sm:max-w-4xl lg:max-w-6xl xl:max-w-7xl">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/dashboard/plan" className="text-sm font-semibold tracking-tight">
          Calendar Automations
        </Link>
        <AccountMenu
          links={ACCOUNT_LINKS}
          signOut={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        />
      </header>

      <BillingBanner state={billing} />

      <main className="flex-1">{children}</main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-3xl border-t border-ink-200 bg-white/95 backdrop-blur dark:border-ink-600 dark:bg-ink-900/90 sm:max-w-4xl lg:max-w-6xl xl:max-w-7xl"
      >
        <ul className="flex justify-around px-2">
          {PRIMARY_NAV.map((item) => (
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
