"use client";

import { useState, useTransition } from "react";
import { createBrainDump } from "@/app/actions/concepts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Loader2 } from "lucide-react";

export function BrainDumpForm() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    startTransition(async () => {
      await createBrainDump(content.trim());
      setContent("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="w-full h-14 text-base gap-2"
        size="lg"
      >
        <PlusCircle className="h-5 w-5" />
        Brain Dump
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        autoFocus
        placeholder="What's on your mind? First line becomes the concept title..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={4}
        className="w-full resize-none text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending || !content.trim()} className="flex-1">
          {isPending ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving...</>
          ) : (
            "Save & Create Concept"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => { setOpen(false); setContent(""); }}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
