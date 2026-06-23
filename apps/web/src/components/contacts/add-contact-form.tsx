"use client";

import { useState, useTransition } from "react";
import { createContact } from "@/app/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlusCircle, Loader2, X } from "lucide-react";
import { CONTACT_STAGES } from "@margot/schema";

export function AddContactForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [company, setCompany] = useState("");
  const [stage, setStage] = useState("lead");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  function reset() {
    setName(""); setEmail(""); setHandle(""); setCompany("");
    setStage("lead"); setSource(""); setNotes("");
    setOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    startTransition(async () => {
      await createContact({
        name: name.trim(),
        email: email.trim() || undefined,
        handle: handle.trim() || undefined,
        company: company.trim() || undefined,
        stage,
        source: source.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      reset();
    });
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="gap-2" size="sm">
        <PlusCircle className="h-4 w-4" />
        Add Contact
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">New Contact</span>
        <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs">Name *</Label>
          <Input
            id="name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="h-8 text-sm"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="stage" className="text-xs">Stage</Label>
          <select
            id="stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {CONTACT_STAGES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="handle" className="text-xs">Handle / Social</Label>
          <Input
            id="handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@username or LinkedIn URL"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="company" className="text-xs">Company</Label>
          <Input
            id="company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="source" className="text-xs">Source</Label>
          <Input
            id="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="linkedin, referral, event..."
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes" className="text-xs">Notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any relevant notes..."
          rows={2}
          className="resize-none text-sm"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="submit" disabled={isPending || !name.trim()} size="sm" className="flex-1">
          {isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Saving...</> : "Add Contact"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
