"use client";

import { useState, useTransition } from "react";
import type { Concept } from "@margot/schema";
import { updateConcept, deleteConcept, conceptToPost } from "@/app/actions/concepts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Trash2,
  Pencil,
  X,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  idea: "bg-yellow-100 text-yellow-800 border-yellow-200",
  active: "bg-green-100 text-green-800 border-green-200",
  archived: "bg-gray-100 text-gray-600 border-gray-200",
};

interface ConceptNodeProps {
  concept: Concept;
  children: Concept[];
  allConcepts: Concept[];
  depth?: number;
}

function ConceptNode({ concept, children, allConcepts, depth = 0 }: ConceptNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(concept.title);
  const [body, setBody] = useState(concept.body);
  const [isPending, startTransition] = useTransition();

  function saveEdit() {
    startTransition(async () => {
      await updateConcept(concept.id, { title, body });
      setEditing(false);
    });
  }

  function handleDelete() {
    if (!confirm("Delete this concept?")) return;
    startTransition(async () => {
      await deleteConcept(concept.id);
    });
  }

  function handleToPost() {
    startTransition(async () => {
      await conceptToPost(concept.id);
    });
  }

  const hasChildren = children.length > 0;

  return (
    <div className={cn("border-l-2 border-border pl-3", depth > 0 && "ml-4 mt-2")}>
      <div className="group flex items-start gap-2 py-1.5">
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded((p) => !p)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="w-4 h-4 block" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-sm font-medium h-8"
                autoFocus
              />
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                className="text-xs resize-none"
                placeholder="Body (optional)"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={isPending} className="h-7 px-2">
                  {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-7 px-2">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium leading-tight">{concept.title}</span>
                <Badge
                  variant="outline"
                  className={cn("text-xs px-1.5 py-0", STATUS_COLORS[concept.status] ?? STATUS_COLORS.idea)}
                >
                  {concept.status}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(concept.createdAt).toLocaleDateString()}
                </span>
              </div>
              {concept.body && (
                <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{concept.body}</p>
              )}
            </>
          )}
        </div>

        {/* Actions — visible on hover */}
        {!editing && (
          <div className="flex shrink-0 gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={handleToPost}
              disabled={isPending}
              title="Create post from concept"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
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
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <ConceptNode
              key={child.id}
              concept={child}
              children={allConcepts.filter((c) => c.parentId === child.id)}
              allConcepts={allConcepts}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ConceptTreeProps {
  concepts: Concept[];
}

export function ConceptTree({ concepts }: ConceptTreeProps) {
  // Root concepts: those with no parentId or parentId not in the list
  const conceptIds = new Set(concepts.map((c) => c.id));
  const roots = concepts.filter((c) => !c.parentId || !conceptIds.has(c.parentId));

  if (concepts.length === 0) return null;

  return (
    <div className="space-y-1">
      {roots.map((root) => (
        <ConceptNode
          key={root.id}
          concept={root}
          children={concepts.filter((c) => c.parentId === root.id)}
          allConcepts={concepts}
          depth={0}
        />
      ))}
    </div>
  );
}
