"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Brain, Plus, X, ChevronDown, ChevronRight } from "lucide-react";

interface Concept {
  id: string;
  title: string;
  body: string | null;
  tags: string[];
  parentId: string | null;
  createdAt: string;
}

function ConceptTree({ concepts, parentId = null, depth = 0 }: { concepts: Concept[]; parentId?: string | null; depth?: number; }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const children = concepts.filter((c) => c.parentId === parentId);
  if (children.length === 0) return null;
  return (
    <div className={depth > 0 ? "ml-4 border-l border-border pl-3" : ""}>
      {children.map((concept) => {
        const hasChildren = concepts.some((c) => c.parentId === concept.id);
        const isCollapsed = collapsed[concept.id];
        return (
          <div key={concept.id} className="mb-2">
            <div className="flex items-start gap-2 py-1">
              {hasChildren ? (
                <button onClick={() => setCollapsed((p) => ({ ...p, [concept.id]: !p[concept.id] }))} className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0">
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
              ) : (
                <div className="mt-0.5 h-3.5 w-3.5 shrink-0 flex items-center justify-center">
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{concept.title}</p>
                {concept.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{concept.body}</p>}
                {concept.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {concept.tags.map((tag) => <Badge key={tag} variant="secondary" className="text-xs py-0 h-4">{tag}</Badge>)}
                  </div>
                )}
              </div>
            </div>
            {!isCollapsed && <ConceptTree concepts={concepts} parentId={concept.id} depth={depth + 1} />}
          </div>
        );
      })}
    </div>
  );
}

export default function ConceptsPage() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dumpText, setDumpText] = useState("");
  const [title, setTitle] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/concepts");
    if (res.ok) setConcepts(await res.json() as Concept[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((p) => [...p, t]);
    setTagInput("");
  };

  const handleSubmit = async () => {
    if (!title.trim() && !dumpText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/concepts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || dumpText.split("\n")[0]?.slice(0, 80) || "New concept", body: dumpText.trim(), tags }),
      });
      if (res.ok) {
        const newConcept = await res.json() as Concept;
        setConcepts((p) => [newConcept, ...p]);
        setDumpText(""); setTitle(""); setTags([]); setTagInput(""); setShowForm(false);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Concepts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Your ideas, content pillars, and knowledge map.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />Brain dump
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Brain className="h-4 w-4" />Capture an idea
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="concept-title" className="text-xs">Title (optional)</Label>
              <Input id="concept-title" placeholder="Give this idea a name…" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="concept-body" className="text-xs">Dump it here — no structure needed</Label>
              <Textarea id="concept-body" placeholder="Just write. First line becomes title if left blank." value={dumpText} onChange={(e) => setDumpText(e.target.value)} rows={4} autoFocus />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tags</Label>
              <div className="flex items-center gap-2">
                <Input placeholder="Add tag…" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); }}} className="h-7 text-xs" />
                <Button variant="outline" size="sm" className="h-7" onClick={addTag}>Add</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setTags((p) => p.filter((t) => t !== tag))}>
                      {tag}<X className="h-2.5 w-2.5" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSubmit} disabled={saving || (!title.trim() && !dumpText.trim())}>{saving ? "Saving…" : "Save concept"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setDumpText(""); setTitle(""); setTags([]); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : concepts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No concepts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Hit <strong>Brain dump</strong> to capture your first idea.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="px-4 py-4">
            <ConceptTree concepts={concepts} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
