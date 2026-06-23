"use client";

import { useState } from "react";
import type { Signal } from "@margot/schema";
import { SIGNAL_SOURCE_TYPES } from "@margot/schema";
import { SignalCard } from "./signal-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SignalsFeedProps {
  signals: Signal[];
}

const ALL_FILTERS = ["all", ...SIGNAL_SOURCE_TYPES] as const;

export function SignalsFeed({ signals }: SignalsFeedProps) {
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all"
    ? signals
    : signals.filter((s) => s.source === filter);

  return (
    <div className="space-y-4">
      {/* Type filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_FILTERS.map((f) => {
          const count = f === "all"
            ? signals.length
            : signals.filter((s) => s.source === f).length;
          return (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              className={cn("h-7 text-xs capitalize", count === 0 && f !== "all" && "opacity-40")}
              onClick={() => setFilter(f)}
            >
              {f} {count > 0 && <span className="ml-1 text-xs opacity-70">({count})</span>}
            </Button>
          );
        })}
      </div>

      {/* Signal list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No signals{filter !== "all" ? ` of type "${filter}"` : ""} yet.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((signal) => (
            <SignalCard key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}
