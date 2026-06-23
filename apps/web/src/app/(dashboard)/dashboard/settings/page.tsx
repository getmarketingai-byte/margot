"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Settings, CheckCircle, Plus, X, Calendar, DollarSign, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────

interface ContentPillar {
  id: string;
  name: string;
  description: string;
}

interface SignalSource {
  id: string;
  type: "subreddit" | "rss" | "x_account";
  url: string;
}

type PostingCadence = "daily" | "3x_week" | "weekly" | "custom";
type SalesModel = "subscription" | "deal_pipeline";

interface ProfileForm {
  // Legacy fields
  headline: string;
  bio: string;
  industry: string;
  website: string;
  linkedinUrl: string;
  twitterHandle: string;
  // Sprint 3 fields
  brandVoice: string;
  contentPillars: ContentPillar[];
  targetAudience: string;
  postingCadence: PostingCadence | null;
  signalSources: SignalSource[];
  salesModel: SalesModel | null;
}

let _idCtr = 0;
function tmpId() { return `tmp-${++_idCtr}`; }

function toLocalPillars(raw: { name: string; description: string }[] | null | undefined): ContentPillar[] {
  if (!raw || raw.length === 0) return [{ id: tmpId(), name: "", description: "" }];
  return raw.map(p => ({ id: tmpId(), ...p }));
}

function toLocalSources(raw: { type: string; url: string }[] | null | undefined): SignalSource[] {
  if (!raw || raw.length === 0) return [];
  return raw.map(s => ({ id: tmpId(), type: s.type as SignalSource["type"], url: s.url }));
}

// ── Component ──────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState<ProfileForm>({
    headline: "",
    bio: "",
    industry: "",
    website: "",
    linkedinUrl: "",
    twitterHandle: "",
    brandVoice: "",
    contentPillars: [{ id: tmpId(), name: "", description: "" }],
    targetAudience: "",
    postingCadence: null,
    signalSources: [],
    salesModel: null,
  });

  useEffect(() => {
    fetch("/api/profile")
      .then(r => r.json())
      .then((data: Record<string, unknown> | null) => {
        if (data) {
          setForm({
            headline: (data.headline as string) ?? "",
            bio: (data.bio as string) ?? "",
            industry: (data.industry as string) ?? "",
            website: (data.website as string) ?? "",
            linkedinUrl: (data.linkedinUrl as string) ?? "",
            twitterHandle: (data.twitterHandle as string) ?? "",
            brandVoice: (data.brandVoice as string) ?? "",
            contentPillars: toLocalPillars(data.contentPillars as { name: string; description: string }[] | null),
            targetAudience: (data.targetAudience as string) ?? "",
            postingCadence: (data.postingCadence as PostingCadence | null) ?? null,
            signalSources: toLocalSources(data.signalSources as { type: string; url: string }[] | null),
            salesModel: (data.salesModel as SalesModel | null) ?? null,
          });
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      const payload = {
        ...form,
        contentPillars: form.contentPillars.filter(p => p.name.trim()).map(({ name, description }) => ({ name, description })),
        signalSources: form.signalSources.map(({ type, url }) => ({ type, url })),
        onboardingComplete: true,
      };
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Pillar helpers ─────────────────────────────────────────────────────

  const addPillar = () => {
    if (form.contentPillars.length < 6) {
      setForm(f => ({ ...f, contentPillars: [...f.contentPillars, { id: tmpId(), name: "", description: "" }] }));
    }
  };
  const removePillar = (id: string) => setForm(f => ({ ...f, contentPillars: f.contentPillars.filter(p => p.id !== id) }));
  const updatePillar = (id: string, field: "name" | "description", value: string) =>
    setForm(f => ({ ...f, contentPillars: f.contentPillars.map(p => p.id === id ? { ...p, [field]: value } : p) }));

  // ── Source helpers ─────────────────────────────────────────────────────

  const addSource = (type: SignalSource["type"]) =>
    setForm(f => ({ ...f, signalSources: [...f.signalSources, { id: tmpId(), type, url: "" }] }));
  const removeSource = (id: string) => setForm(f => ({ ...f, signalSources: f.signalSources.filter(s => s.id !== id) }));
  const updateSource = (id: string, url: string) =>
    setForm(f => ({ ...f, signalSources: f.signalSources.map(s => s.id === id ? { ...s, url } : s) }));

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your profile and preferences.</p>
      </div>

      {/* ── Brand Voice ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" /> Brand Voice
          </CardTitle>
          <CardDescription className="text-xs">Tone, phrases, dos and don&apos;ts — helps Margot write in your voice.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Conversational and direct. Short sentences. No jargon."
            value={form.brandVoice}
            onChange={e => setForm(f => ({ ...f, brandVoice: e.target.value }))}
            rows={4}
            className="text-sm"
          />
        </CardContent>
      </Card>

      {/* ── Content Pillars ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Content Pillars</CardTitle>
          <CardDescription className="text-xs">3–6 themes you post about.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.contentPillars.map((pillar, idx) => (
            <div key={pillar.id} className="flex gap-2 items-start">
              <div className="flex-1 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  placeholder={`Theme ${idx + 1} name`}
                  value={pillar.name}
                  onChange={e => updatePillar(pillar.id, "name", e.target.value)}
                  className="text-sm"
                />
                <Input
                  placeholder="Short description"
                  value={pillar.description}
                  onChange={e => updatePillar(pillar.id, "description", e.target.value)}
                  className="text-sm"
                />
              </div>
              {form.contentPillars.length > 1 && (
                <button type="button" onClick={() => removePillar(pillar.id)} className="mt-2 text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          {form.contentPillars.length < 6 && (
            <Button type="button" variant="outline" size="sm" onClick={addPillar} className="gap-1 text-xs">
              <Plus className="h-3 w-3" /> Add pillar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Target Audience ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target Audience</CardTitle>
          <CardDescription className="text-xs">Who you reach and what problems they have.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Early-stage B2B SaaS founders who struggle with messaging…"
            value={form.targetAudience}
            onChange={e => setForm(f => ({ ...f, targetAudience: e.target.value }))}
            rows={4}
            className="text-sm"
          />
        </CardContent>
      </Card>

      {/* ── Posting Cadence ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" /> Posting Cadence
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(["daily", "3x_week", "weekly", "custom"] as const).map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => setForm(f => ({ ...f, postingCadence: opt }))}
                className={cn(
                  "rounded-lg border-2 p-3 text-sm font-medium transition-colors",
                  form.postingCadence === opt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-muted-foreground text-muted-foreground"
                )}
              >
                {opt === "daily" ? "Daily" : opt === "3x_week" ? "3× / week" : opt === "weekly" ? "Weekly" : "Custom"}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Signal Sources ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" /> Signal Sources
          </CardTitle>
          <CardDescription className="text-xs">Subreddits, RSS feeds, X accounts to monitor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {form.signalSources.map(src => (
            <div key={src.id} className="flex gap-2 items-center">
              <span className="text-xs w-16 flex-shrink-0 text-muted-foreground">
                {src.type === "subreddit" ? "Reddit" : src.type === "rss" ? "RSS" : "X / @"}
              </span>
              <Input
                placeholder={src.type === "subreddit" ? "https://reddit.com/r/…" : src.type === "rss" ? "https://…/feed.xml" : "@username"}
                value={src.url}
                onChange={e => updateSource(src.id, e.target.value)}
                className="text-sm flex-1"
              />
              <button type="button" onClick={() => removeSource(src.id)} className="text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2 flex-wrap">
            <Button type="button" variant="outline" size="sm" onClick={() => addSource("subreddit")} className="gap-1 text-xs">
              <Plus className="h-3 w-3" /> Subreddit
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addSource("rss")} className="gap-1 text-xs">
              <Plus className="h-3 w-3" /> RSS feed
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => addSource("x_account")} className="gap-1 text-xs">
              <Plus className="h-3 w-3" /> X account
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Sales Model ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4" /> Sales Model
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {([
              { value: "subscription", label: "Subscription / MRR", desc: "SaaS, memberships, recurring revenue" },
              { value: "deal_pipeline", label: "Deal pipeline", desc: "Consulting, agency, high-ticket sales" },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setForm(f => ({ ...f, salesModel: opt.value }))}
                className={cn(
                  "flex flex-col gap-1 rounded-lg border-2 p-3 text-left transition-colors",
                  form.salesModel === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-muted-foreground"
                )}
              >
                <span className={cn("font-medium text-sm", form.salesModel === opt.value ? "text-primary" : "text-foreground")}>
                  {opt.label}
                </span>
                <span className="text-xs text-muted-foreground">{opt.desc}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Professional Info ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Professional Info</CardTitle>
          <CardDescription className="text-xs">Basic profile details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="headline" className="text-xs">Professional headline</Label>
            <Input
              id="headline"
              placeholder="Founder @ Acme · B2B SaaS"
              value={form.headline}
              onChange={e => setForm(f => ({ ...f, headline: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bio" className="text-xs">Bio</Label>
            <Textarea
              id="bio"
              placeholder="I help early-stage founders build marketing systems…"
              value={form.bio}
              onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
              rows={3}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="website" className="text-xs">Website</Label>
              <Input id="website" type="url" placeholder="https://example.com" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twitterHandle" className="text-xs">Twitter / X handle</Label>
              <Input id="twitterHandle" placeholder="username" value={form.twitterHandle} onChange={e => setForm(f => ({ ...f, twitterHandle: e.target.value }))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="linkedinUrl" className="text-xs">LinkedIn URL</Label>
            <Input id="linkedinUrl" type="url" placeholder="https://linkedin.com/in/username" value={form.linkedinUrl} onChange={e => setForm(f => ({ ...f, linkedinUrl: e.target.value }))} />
          </div>
        </CardContent>
      </Card>

      {/* ── Connected Accounts (placeholder) ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connected Accounts</CardTitle>
          <CardDescription className="text-xs">Integrations coming soon.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {["LinkedIn", "Google Calendar"].map(name => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="text-sm text-foreground">{name}</span>
                <span className="text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">Coming soon</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-8">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle className="h-3 w-3" /> Saved
          </span>
        )}
      </div>
    </form>
  );
}
