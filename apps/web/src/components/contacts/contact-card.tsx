"use client";

import { useState, useTransition } from "react";
import type { Contact, ContactInteraction } from "@margot/schema";
import { updateContact, deleteContact, createInteraction, getContactInteractions } from "@/app/actions/contacts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CONTACT_STAGES, INTERACTION_TYPES } from "@margot/schema";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  Pencil,
  X,
  Check,
  Loader2,
  PlusCircle,
  Mail,
  Phone,
  Users,
  MessageSquare,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STAGE_COLORS: Record<string, string> = {
  lead: "bg-blue-100 text-blue-800 border-blue-200",
  prospect: "bg-yellow-100 text-yellow-800 border-yellow-200",
  customer: "bg-green-100 text-green-800 border-green-200",
  churned: "bg-gray-100 text-gray-600 border-gray-200",
};

const INTERACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  call: Phone,
  meeting: Calendar,
  social: MessageSquare,
};

interface ContactCardProps {
  contact: Contact;
}

export function ContactCard({ contact }: ContactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [interactions, setInteractions] = useState<ContactInteraction[]>([]);
  const [loadedInteractions, setLoadedInteractions] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Edit state
  const [editName, setEditName] = useState(contact.name);
  const [editEmail, setEditEmail] = useState(contact.email ?? "");
  const [editHandle, setEditHandle] = useState(contact.handle ?? "");
  const [editCompany, setEditCompany] = useState(contact.company ?? "");
  const [editStage, setEditStage] = useState(contact.stage);
  const [editNotes, setEditNotes] = useState(contact.notes ?? "");

  // Interaction form state
  const [intType, setIntType] = useState("email");
  const [intBody, setIntBody] = useState("");

  function toggleExpand() {
    setExpanded((p) => !p);
    if (!loadedInteractions && !expanded) {
      startTransition(async () => {
        const rows = await getContactInteractions(contact.id);
        setInteractions(rows);
        setLoadedInteractions(true);
      });
    }
  }

  function saveEdit() {
    startTransition(async () => {
      await updateContact(contact.id, {
        name: editName,
        email: editEmail || undefined,
        handle: editHandle || undefined,
        company: editCompany || undefined,
        stage: editStage,
        notes: editNotes || undefined,
      });
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${contact.name}?`)) return;
    startTransition(async () => {
      await deleteContact(contact.id);
    });
  }

  function handleAddInteraction(e: React.FormEvent) {
    e.preventDefault();
    if (!intBody.trim()) return;
    startTransition(async () => {
      const newInt = await createInteraction({
        contactId: contact.id,
        type: intType,
        body: intBody.trim(),
      });
      if (newInt) setInteractions((prev) => [newInt, ...prev]);
      setIntBody("");
      setShowAddInteraction(false);
    });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2 pt-4 px-4">
        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-sm font-medium" placeholder="Name" />
              <select
                value={editStage}
                onChange={(e) => setEditStage(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              >
                {CONTACT_STAGES.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="h-8 text-xs" placeholder="Email" />
              <Input value={editHandle} onChange={(e) => setEditHandle(e.target.value)} className="h-8 text-xs" placeholder="@handle or LinkedIn" />
              <Input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} className="h-8 text-xs" placeholder="Company" />
            </div>
            <Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} className="text-xs resize-none" placeholder="Notes" />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={isPending} className="h-7 px-2">
                {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                <span className="ml-1">Save</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 px-2">
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 group">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{contact.name}</span>
                <Badge
                  variant="outline"
                  className={cn("text-xs px-1.5 py-0 capitalize", STAGE_COLORS[contact.stage] ?? STAGE_COLORS.lead)}
                >
                  {contact.stage}
                </Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {contact.company && <span className="text-xs text-muted-foreground">{contact.company}</span>}
                {contact.email && <span className="text-xs text-muted-foreground">{contact.email}</span>}
                {contact.handle && <span className="text-xs text-muted-foreground">{contact.handle}</span>}
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)} title="Edit">
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={isPending}
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
      </CardHeader>

      {/* Expand to see interaction log */}
      {!editing && (
        <CardContent className="px-4 pb-4 pt-0">
          <button
            onClick={toggleExpand}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide" : "Interaction log"}
            {loadedInteractions && interactions.length > 0 && ` (${interactions.length})`}
          </button>

          {expanded && (
            <div className="mt-3 space-y-3">
              {/* Notes */}
              {contact.notes && (
                <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                  {contact.notes}
                </p>
              )}

              {/* Interaction list */}
              {isPending && !loadedInteractions ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />Loading...
                </div>
              ) : (
                interactions.length > 0 && (
                  <div className="space-y-2">
                    {interactions.map((int) => {
                      const Icon = INTERACTION_ICONS[int.type] ?? Users;
                      return (
                        <div key={int.id} className="flex gap-2 text-xs">
                          <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="capitalize text-muted-foreground">{int.type}</span>
                              <span className="text-muted-foreground/60">
                                {new Date(int.date).toLocaleDateString()}
                              </span>
                            </div>
                            {int.body && <p className="mt-0.5 text-foreground/80">{int.body}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}

              {/* Add interaction form */}
              {showAddInteraction ? (
                <form onSubmit={handleAddInteraction} className="space-y-2 border border-border rounded-md p-3">
                  <div className="flex gap-2">
                    <select
                      value={intType}
                      onChange={(e) => setIntType(e.target.value)}
                      className="h-7 rounded border border-input bg-background px-2 text-xs"
                    >
                      {INTERACTION_TYPES.map((t) => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <Textarea
                    value={intBody}
                    onChange={(e) => setIntBody(e.target.value)}
                    placeholder="What happened?"
                    rows={2}
                    className="text-xs resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={isPending || !intBody.trim()} className="h-7 text-xs px-3">
                      {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Log"}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAddInteraction(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setShowAddInteraction(true)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <PlusCircle className="h-3 w-3" />
                  Log interaction
                </button>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
