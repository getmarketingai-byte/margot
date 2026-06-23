"use client";

import { useState } from "react";
import type { Contact } from "@margot/schema";
import { CONTACT_STAGES } from "@margot/schema";
import { ContactCard } from "./contact-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ContactsBoardProps {
  contacts: Contact[];
}

const STAGE_COLORS: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800",
  prospect: "bg-yellow-100 text-yellow-800",
  customer: "bg-green-100 text-green-800",
  churned: "bg-gray-100 text-gray-700",
};

export function ContactsBoard({ contacts }: ContactsBoardProps) {
  const [stage, setStage] = useState<string>("all");

  // Stage counts
  const counts = CONTACT_STAGES.reduce<Record<string, number>>(
    (acc, s) => { acc[s] = contacts.filter((c) => c.stage === s).length; return acc; },
    {}
  );

  const filtered = stage === "all" ? contacts : contacts.filter((c) => c.stage === stage);

  return (
    <div className="space-y-4">
      {/* Stage counts row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {CONTACT_STAGES.map((s) => (
          <div
            key={s}
            className={cn(
              "rounded-lg border p-3 text-center cursor-pointer transition-colors",
              stage === s ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            )}
            onClick={() => setStage(stage === s ? "all" : s)}
          >
            <div className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize mb-1", STAGE_COLORS[s])}>
              {s}
            </div>
            <div className="text-2xl font-bold">{counts[s] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant={stage === "all" ? "default" : "outline"}
          className="h-7 text-xs"
          onClick={() => setStage("all")}
        >
          All ({contacts.length})
        </Button>
        {CONTACT_STAGES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={stage === s ? "default" : "outline"}
            className={cn("h-7 text-xs capitalize", (counts[s] ?? 0) === 0 && "opacity-40")}
            onClick={() => setStage(stage === s ? "all" : s)}
          >
            {s} {(counts[s] ?? 0) > 0 && `(${counts[s]})`}
          </Button>
        ))}
      </div>

      {/* Contact list */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No contacts{stage !== "all" ? ` in "${stage}"` : ""} yet.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ContactCard key={c.id} contact={c} />
          ))}
        </div>
      )}
    </div>
  );
}
