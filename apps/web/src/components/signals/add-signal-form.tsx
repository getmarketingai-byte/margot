"use client";

import { useState, useTransition } from "react";
import { createSignal } from "@/app/actions/signals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Loader2, X } from "lucide-react";
import { SIGNAL_SOURCE_TYPES } from "@margot/schema";

export function AddSignalForm() {
  const [open, setOpen] = useState(false);
  const [headline, setHeadline] = useState("");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState("news");
  const [summary, setSummary] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setHeadline("");
    setUrl("");
    setSource("news");
    setSummary("");
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!headline.trim()) return;
    startTransition(async () => {
      await createSignal({
        headline: headline.trim(),
        url: url.trim() || undefined,
        source,
        summary: summary.trim() || undefined,
      });
      reset();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2" size="sm">
        <PlusCircle className="h-4 w-4" />
        Add Signal
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">New Signal</span>
        <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="headline" className="text-xs">Headline *</Label>
        <Input
          id="headline"
          autoFocus
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          placeholder="What's the signal?"
          className="h-8 text-sm"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source-type" className="text-xs">Type</Label>
        <select
          id="source-type"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {SIGNAL_SOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="url" className="text-xs">URL (optional)</Label>
        <Input
          id="url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://..."
          className="h-8 text-sm"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="summary" className="text-xs">Summary (optional)</Label>
        <Textarea
          id="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Brief description..."
          rows={2}
          className="resize-none text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={isPending || !headline.trim()} size="sm" className="flex-1">
          {isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving...</> : "Add Signal"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
