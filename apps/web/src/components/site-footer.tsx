"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRODUCT } from "@/lib/marketing";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
  { href: "/learn", label: "Learn" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" }
];

export function SiteFooter() {
  const pathname = usePathname() ?? "";
  if (pathname.startsWith("/dashboard")) return null;
  return (
    <footer className="mx-auto mt-12 w-full max-w-2xl border-t border-ink-200 px-5 pb-12 pt-6 text-xs text-ink-400 dark:border-ink-600 sm:max-w-3xl">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-ink-900 dark:hover:text-ink-100">
            {l.label}
          </Link>
        ))}
      </div>
      <p className="mt-4">
        © {new Date().getFullYear()} {PRODUCT.legalName}. All rights reserved.
      </p>
    </footer>
  );
}
