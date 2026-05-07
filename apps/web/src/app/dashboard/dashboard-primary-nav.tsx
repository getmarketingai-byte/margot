"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY_NAV = [
  { href: "/dashboard/plan", label: "Perfect Week" },
  { href: "/dashboard/planner", label: "Planner" },
  { href: "/dashboard/review", label: "Day sheet" },
  { href: "/dashboard/week-review", label: "Week review" },
  { href: "/dashboard/calendars", label: "Calendars" }
] as const;

function navItemIsActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardPrimaryNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav
      aria-label="Primary"
      className="-mx-4 sticky top-0 z-10 mb-4 border-b border-ink-200 bg-white/95 px-4 backdrop-blur dark:border-ink-600 dark:bg-ink-900/90"
    >
      <ul className="flex gap-1 overflow-x-auto whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] sm:justify-around sm:gap-2 sm:overflow-visible [&::-webkit-scrollbar]:hidden">
        {PRIMARY_NAV.map((item) => {
          const active = navItemIsActive(pathname, item.href);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "block rounded-md bg-ink-200/80 px-3 py-3 text-sm font-semibold text-ink-900 sm:px-3 sm:py-2.5 sm:text-sm dark:bg-ink-700/60 dark:text-ink-100"
                    : "block rounded-md px-3 py-3 text-sm font-medium text-ink-600 hover:bg-ink-100/70 hover:text-ink-900 sm:px-3 sm:py-2.5 sm:text-sm dark:text-ink-200 dark:hover:bg-ink-800/50 dark:hover:text-ink-100"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
