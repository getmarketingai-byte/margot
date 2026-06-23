"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Rss, Plus, ExternalLink } from "lucide-react";

interface Signal {
  id: string;
  source: string;
  headline: string;
  url: string | null;
  summary: string | null;
  capturedAt: string;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ headline: "", source: "manual", url: "", summary: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/signals");
    if (res.ok) setSignals(await res.json() as Signal[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!form.headline.trim() || !form.source.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: form.headline.trim(),
          source: form.source.trim() || "manual",
          url: form.url.trim() || null,
          summary: form.summary.trim() || null,
        }),
      });
      if (res.ok) {
        const row = await res.json() as Signal;
        setSignals((p) => [row, ...p]);
        setForm({ headline: "", source: "manual", url: "", summary: "" });
        setShowForm(false);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Signals</h1>
          <p className="mt-1 text-sm text-muted-foreground">Industry trends and intelligence captured for you.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} className="shrink-0">
          <Plus className="h-4 w-4 mr-1" />Add signal
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Rss className="h-4 w-4" />Add a signal manually
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sig-headline" className="text-xs">Headline *</Label>
              <Input id="sig-headline" placeholder="What's the signal?" value={form.headline} onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="sig-source" className="text-xs">Source</Label>
                <Input id="sig-source" placeholder="twitter, reddit, news…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sig-url" className="text-xs">URL (optional)</Label>
                <Input id="sig-url" type="url" placeholder="https://…" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sig-summary" className="text-xs">Summary (optional)</Label>
              <Textarea id="sig-summary" placeholder="Any additional context…" value={form.summary} onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))} rows={2} />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleSubmit} disabled={saving || !form.headline.trim()}>{saving ? "Saving…" : "Save signal"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm({ headline: "", source: "manual", url: "", summary: "" }); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="flex h-20 items-center justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : signals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Rss className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No signals yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Signals appear here as they are captured, or add one manually.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {signals.map((signal) => (
            <Card key={signal.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-sm font-semibold leading-snug">{signal.headline}</CardTitle>
                  <Badge variant="outline" className="shrink-0 text-xs">{signal.source}</Badge>
                </div>
              </CardHeader>
              {(signal.summary ?? signal.url) && (
                <CardContent className="px-4 pb-4 space-y-2">
                  {signal.summary && <p className="text-xs text-muted-foreground line-clamp-3">{signal.summary}</p>}
                  {signal.url && (
                    <a href={signal.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      View source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
