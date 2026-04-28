import Link from "next/link";
import { redirect } from "next/navigation";
import { authOrPreview, signOut } from "@/lib/auth";
import { loadBillingState } from "@/lib/billing-state-server";
import { AccountMenu } from "./account-menu";
import { BillingBanner } from "./billing-banner";

const PRIMARY_NAV = [
  { href: "/dashboard/plan", label: "Perfect Week" },
  { href: "/dashboard/energy", label: "Planning" },
  { href: "/dashboard/review", label: "Day sheet" },
  { href: "/dashboard/week-review", label: "Week review" },
  { href: "/dashboard/calendars", label: "Calendars" }
];

const ACCOUNT_LINKS = [
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/calendars#ical-feeds", label: "iCal feeds" },
  { href: "/dashboard/billing", label: "Billing" }
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await authOrPreview();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/dashboard");
  const billing = await loadBillingState(session.user.id);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-8 pt-6 sm:max-w-4xl lg:max-w-6xl xl:max-w-7xl">
      <header className="mb-4 flex items-center justify-between">
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

      <nav
        aria-label="Primary"
        className="-mx-4 sticky top-0 z-10 mb-4 border-b border-ink-200 bg-white/95 px-4 backdrop-blur dark:border-ink-600 dark:bg-ink-900/90"
      >
        <ul className="flex justify-around gap-1 sm:gap-2">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                className="block px-2 py-2.5 text-xs font-medium text-ink-600 hover:text-ink-900 sm:px-3 sm:text-sm dark:text-ink-200 dark:hover:text-ink-100"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <BillingBanner state={billing} />

      <main className="flex-1">{children}</main>
    </div>
  );
}
