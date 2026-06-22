"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import type { PostStatus } from "@margot/schema";

const TABS: Array<{ label: string; value: PostStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "draft" },
  { label: "Scheduled", value: "scheduled" },
  { label: "Published", value: "published" },
  { label: "Archived", value: "archived" },
];

interface PostsFilterTabsProps {
  current?: PostStatus | undefined;
}

export function PostsFilterTabs({ current }: PostsFilterTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function navigate(value: PostStatus | "all") {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    // clear search when changing tabs
    params.delete("q");
    router.push(`/dashboard/posts?${params.toString()}`);
  }

  const active = current ?? "all";

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border pb-0">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          onClick={() => navigate(tab.value)}
          className={cn(
            "shrink-0 rounded-t-md px-4 py-2 text-sm font-medium transition-colors",
            active === tab.value
              ? "border border-b-0 border-border bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
