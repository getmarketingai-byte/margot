import Link from "next/link";
import { redirect } from "next/navigation";
import { authOrPreview, signOut } from "@/lib/auth";
import { loadBillingState } from "@/lib/billing-state-server";
import { AccountMenu } from "./account-menu";
import { BillingBanner } from "./billing-banner";
import { DashboardPerfListener } from "./dashboard-perf-listener";
import { DashboardRoutePrefetch } from "./dashboard-route-prefetch";
import { DashboardPrimaryNav } from "./dashboard-primary-nav";

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
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-8 pt-6 sm:max-w-4xl sm:px-5 lg:max-w-6xl lg:px-6 xl:max-w-7xl 2xl:max-w-[min(100rem,calc(100vw-4rem))] min-[2000px]:max-w-[min(120rem,calc(100vw-5rem))]">
      <header className="mb-4 flex items-center justify-between">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
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

      <DashboardPrimaryNav />

      <DashboardPerfListener />

      <DashboardRoutePrefetch />

      {billing.mode !== "bypass" ? <BillingBanner state={billing} className="mb-4" /> : null}

      <main className="flex-1">{children}</main>

      {billing.mode === "bypass" ? (
        <BillingBanner state={billing} className="mt-6 border-emerald-200/70 bg-emerald-50/70" />
      ) : null}
    </div>
  );
}
