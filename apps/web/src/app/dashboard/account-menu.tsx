"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface AccountMenuProps {
  links: ReadonlyArray<{ href: string; label: string }>;
  signOut: () => Promise<void>;
}

/**
 * Compact account dropdown anchored to the dashboard header. Replaces the
 * older inline "Sign out" form and absorbs the secondary nav items
 * (Settings, Feeds, Billing) so the top primary nav stays focused on core pages.
 */
export function AccountMenu({ links, signOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="rounded-md border border-ink-200 px-3 py-1.5 text-xs text-ink-600 hover:text-ink-900 dark:border-ink-600 dark:text-ink-200 dark:hover:text-ink-100"
      >
        Account
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-md border border-ink-200 bg-white shadow-lg dark:border-ink-600 dark:bg-ink-900"
        >
          <ul className="flex flex-col py-1 text-sm">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-2 text-ink-900 hover:bg-ink-100 dark:text-ink-100 dark:hover:bg-ink-600/40"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li className="border-t border-ink-200 dark:border-ink-600">
              <form action={signOut}>
                <button
                  type="submit"
                  className="block w-full px-3 py-2 text-left text-ink-600 hover:bg-ink-100 dark:text-ink-200 dark:hover:bg-ink-600/40"
                >
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
