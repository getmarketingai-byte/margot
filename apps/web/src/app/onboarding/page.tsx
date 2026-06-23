"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle,
  Mic,
  Layers,
  Users,
  Calendar,
  Radio,
  DollarSign,
  ClipboardCheck,
  Plus,
  X,
  GripVertical,
} from "lucide-react";

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

interface OnboardingState {
  brandVoice: string;
  contentPillars: ContentPillar[];
  targetAudience: string;
  postingCadence: PostingCadence | null;
  signalSources: SignalSource[];
  salesModel: SalesModel | null;
}

// ── Step metadata ──────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Brand Voice", icon: Mic },
  { id: 2, label: "Content Pillars", icon: Layers },
  { id: 3, label: "Audience", icon: Users },
  { id: 4, label: "Cadence", icon: Calendar },
  { id: 5, label: "Signals", icon: Radio },
  { id: 6, label: "Sales Model", icon: DollarSign },
  { id: 7, label: "Review", icon: ClipboardCheck },
];

// ── Helper: generate temp IDs ──────────────────────────────────────────────

let _idCtr = 0;
function tmpId() { return `tmp-${++_idCtr}`; }

// ── Main component ─────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  const [state, setState] = useState<OnboardingState>({
    brandVoice: "",
    contentPillars: [{ id: tmpId(), name: "", description: "" }],
    targetAudience: "",
    postingCadence: null,
    signalSources: [],
    salesModel: null,
  });

  // ── Navigation ─────────────────────────────────────────────────────────

  const canNext = () => {
    switch (step) {
      case 1: return state.brandVoice.trim().length > 0;
      case 2: return state.contentPillars.filter(p => p.name.trim()).length >= 1;
      case 3: return state.targetAudience.trim().length > 0;
      case 4: return state.postingCadence !== null;
      case 5: return true; // signal sources are optional
      case 6: return state.salesModel !== null;
      case 7: return true;
      default: return false;
    }
  };

  const next = () => { if (step < 7) setStep(s => s + 1); };
  const back = () => { if (step > 1) setStep(s => s - 1); };

  // ── Submit ─────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const payload = {
        brandVoice: state.brandVoice,
        contentPillars: state.contentPillars
          .filter(p => p.name.trim())
          .map(({ name, description }) => ({ name, description })),
        targetAudience: state.targetAudience,
        postingCadence: state.postingCadence,
        signalSources: state.signalSources.map(({ type, url }) => ({ type, url })),
        salesModel: state.salesModel,
        onboardingComplete: true,
      };

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        router.push("/dashboard");
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Pillar helpers ─────────────────────────────────────────────────────

  const addPillar = () => {
    if (state.contentPillars.length < 6) {
      setState(s => ({
        ...s,
        contentPillars: [...s.contentPillars, { id: tmpId(), name: "", description: "" }],
      }));
    }
  };

  const removePillar = (id: string) => {
    setState(s => ({ ...s, contentPillars: s.contentPillars.filter(p => p.id !== id) }));
  };

  const updatePillar = (id: string, field: "name" | "description", value: string) => {
    setState(s => ({
      ...s,
      contentPillars: s.contentPillars.map(p => p.id === id ? { ...p, [field]: value } : p),
    }));
  };

  // ── Signal source helpers ──────────────────────────────────────────────

  const addSource = (type: SignalSource["type"]) => {
    setState(s => ({ ...s, signalSources: [...s.signalSources, { id: tmpId(), type, url: "" }] }));
  };

  const removeSource = (id: string) => {
    setState(s => ({ ...s, signalSources: s.signalSources.filter(src => src.id !== id) }));
  };

  const updateSource = (id: string, url: string) => {
    setState(s => ({
      ...s,
      signalSources: s.signalSources.map(src => src.id === id ? { ...src, url } : src),
    }));
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <span className="font-semibold text-foreground">Margot</span>
        <span className="text-xs text-muted-foreground">Step {step} of 7</span>
      </header>

      {/* Progress stepper */}
      <div className="px-4 pt-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max mx-auto max-w-2xl">
          {STEPS.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-1">
                <button
                  onClick={() => done && setStep(s.id)}
                  className={cn(
                    "flex flex-col items-center gap-1 px-2 py-1 rounded-lg transition-colors",
                    active && "bg-primary/10",
                    done && "cursor-pointer hover:bg-muted",
                    !active && !done && "opacity-40"
                  )}
                >
                  <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold",
                    active && "border-primary bg-primary text-primary-foreground",
                    done && "border-primary bg-primary/20 text-primary",
                    !active && !done && "border-muted-foreground text-muted-foreground"
                  )}>
                    {done ? <CheckCircle className="h-4 w-4" /> : s.id}
                  </div>
                  <span className="text-[10px] text-muted-foreground hidden sm:block">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <div className={cn("h-px w-4 flex-shrink-0", step > s.id ? "bg-primary" : "bg-border")} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <main className="flex-1 flex items-start justify-center px-4 py-6">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle className="text-lg">{STEPS[step - 1]?.label}</CardTitle>
            <CardDescription className="text-sm">
              {step === 1 && "Describe your tone so Margot writes in your voice."}
              {step === 2 && "Add 3–6 themes you post about. You can reorder them."}
              {step === 3 && "Who do you reach and what problems do they have?"}
              {step === 4 && "How often do you publish?"}
              {step === 5 && "Add sources for Margot to monitor (optional)."}
              {step === 6 && "How does your business generate revenue?"}
              {step === 7 && "Review your profile before finishing."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Step 1 — Brand Voice */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="brandVoice" className="text-xs">Brand voice</Label>
                  <Textarea
                    id="brandVoice"
                    placeholder={"Conversational and direct. No jargon. I say 'you' not 'the reader'.\n\nDos: practical examples, numbered lists, short sentences.\nDon'ts: passive voice, buzzwords like 'synergy', em dashes."}
                    value={state.brandVoice}
                    onChange={e => setState(s => ({ ...s, brandVoice: e.target.value }))}
                    rows={6}
                    className="text-sm"
                  />
                </div>
              </div>
            )}

            {/* Step 2 — Content Pillars */}
            {step === 2 && (
              <div className="space-y-3">
                {state.contentPillars.map((pillar, idx) => (
                  <div key={pillar.id} className="flex gap-2 items-start">
                    <GripVertical className="mt-2 h-4 w-4 flex-shrink-0 text-muted-foreground" />
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
                    {state.contentPillars.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removePillar(pillar.id)}
                        className="mt-2 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                {state.contentPillars.length < 6 && (
                  <Button type="button" variant="outline" size="sm" onClick={addPillar} className="gap-1 text-xs">
                    <Plus className="h-3 w-3" /> Add pillar
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">{state.contentPillars.filter(p => p.name.trim()).length} / 6 pillars</p>
              </div>
            )}

            {/* Step 3 — Target Audience */}
            {step === 3 && (
              <div className="space-y-2">
                <Label htmlFor="audience" className="text-xs">Target audience</Label>
                <Textarea
                  id="audience"
                  placeholder={"Early-stage B2B SaaS founders who are pre-product-market fit.\n\nThey struggle with: turning technical features into compelling messaging, building a consistent posting habit, and knowing which channels matter for their stage."}
                  value={state.targetAudience}
                  onChange={e => setState(s => ({ ...s, targetAudience: e.target.value }))}
                  rows={6}
                  className="text-sm"
                />
              </div>
            )}

            {/* Step 4 — Posting Cadence */}
            {step === 4 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(["daily", "3x_week", "weekly", "custom"] as const).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setState(s => ({ ...s, postingCadence: opt }))}
                    className={cn(
                      "flex flex-col items-center gap-2 rounded-lg border-2 p-4 transition-colors text-sm font-medium",
                      state.postingCadence === opt
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-muted-foreground text-muted-foreground"
                    )}
                  >
                    <Calendar className="h-5 w-5" />
                    {opt === "daily" && "Daily"}
                    {opt === "3x_week" && "3× / week"}
                    {opt === "weekly" && "Weekly"}
                    {opt === "custom" && "Custom"}
                  </button>
                ))}
              </div>
            )}

            {/* Step 5 — Signal Sources */}
            {step === 5 && (
              <div className="space-y-4">
                <div className="space-y-2">
                  {state.signalSources.map(src => (
                    <div key={src.id} className="flex gap-2 items-center">
                      <span className="text-xs w-16 flex-shrink-0 text-muted-foreground">
                        {src.type === "subreddit" && "Reddit"}
                        {src.type === "rss" && "RSS"}
                        {src.type === "x_account" && "X / @"}
                      </span>
                      <Input
                        placeholder={
                          src.type === "subreddit" ? "https://reddit.com/r/SaaS"
                          : src.type === "rss" ? "https://example.com/feed.xml"
                          : "@username"
                        }
                        value={src.url}
                        onChange={e => updateSource(src.id, e.target.value)}
                        className="text-sm flex-1"
                      />
                      <button type="button" onClick={() => removeSource(src.id)} className="text-muted-foreground hover:text-destructive">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
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
                <p className="text-xs text-muted-foreground">Signal sources are optional — you can add more later in Settings.</p>
              </div>
            )}

            {/* Step 6 — Sales Model */}
            {step === 6 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {([
                  { value: "subscription", label: "Subscription / MRR", desc: "SaaS, memberships, recurring revenue" },
                  { value: "deal_pipeline", label: "Deal pipeline", desc: "Consulting, agency, high-ticket sales" },
                ] as const).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setState(s => ({ ...s, salesModel: opt.value }))}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border-2 p-4 text-left transition-colors",
                      state.salesModel === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-muted-foreground"
                    )}
                  >
                    <span className={cn("font-medium text-sm", state.salesModel === opt.value ? "text-primary" : "text-foreground")}>
                      {opt.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{opt.desc}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Step 7 — Review */}
            {step === 7 && (
              <div className="space-y-4 text-sm">
                <ReviewRow
                  label="Brand Voice"
                  value={state.brandVoice || "—"}
                  onEdit={() => setStep(1)}
                />
                <ReviewRow
                  label="Content Pillars"
                  value={state.contentPillars.filter(p => p.name.trim()).map(p => p.name).join(", ") || "—"}
                  onEdit={() => setStep(2)}
                />
                <ReviewRow
                  label="Target Audience"
                  value={state.targetAudience || "—"}
                  onEdit={() => setStep(3)}
                />
                <ReviewRow
                  label="Posting Cadence"
                  value={
                    state.postingCadence === "daily" ? "Daily"
                    : state.postingCadence === "3x_week" ? "3× per week"
                    : state.postingCadence === "weekly" ? "Weekly"
                    : state.postingCadence === "custom" ? "Custom"
                    : "—"
                  }
                  onEdit={() => setStep(4)}
                />
                <ReviewRow
                  label="Signal Sources"
                  value={state.signalSources.length > 0 ? `${state.signalSources.length} source(s)` : "None"}
                  onEdit={() => setStep(5)}
                />
                <ReviewRow
                  label="Sales Model"
                  value={
                    state.salesModel === "subscription" ? "Subscription / MRR"
                    : state.salesModel === "deal_pipeline" ? "Deal pipeline"
                    : "—"
                  }
                  onEdit={() => setStep(6)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Footer nav */}
      <footer className="border-t border-border px-4 py-4 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={back}
          disabled={step === 1}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>

        {step < 7 ? (
          <Button
            type="button"
            size="sm"
            onClick={next}
            disabled={!canNext()}
            className="gap-1"
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving ? "Saving…" : "Finish setup"}
          </Button>
        )}
      </footer>
    </div>
  );
}

// ── Review row sub-component ───────────────────────────────────────────────

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm text-foreground line-clamp-2">{value}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex-shrink-0 text-xs text-primary hover:underline"
      >
        Edit
      </button>
    </div>
  );
}
