"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Settings, CheckCircle } from "lucide-react";

interface Profile {
  id: string;
  headline: string | null;
  bio: string | null;
  industry: string | null;
  targetAudience: string | null;
  website: string | null;
  linkedinUrl: string | null;
  twitterHandle: string | null;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    headline: "",
    bio: "",
    industry: "",
    targetAudience: "",
    website: "",
    linkedinUrl: "",
    twitterHandle: "",
  });

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile | null) => {
        if (data) {
          setProfile(data);
          setForm({
            headline: data.headline ?? "",
            bio: data.bio ?? "",
            industry: data.industry ?? "",
            targetAudience: data.targetAudience ?? "",
            website: data.website ?? "",
            linkedinUrl: data.linkedinUrl ?? "",
            twitterHandle: data.twitterHandle ?? "",
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
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const updated = await res.json() as Profile;
        setProfile(updated);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your profile and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Marketing Profile
          </CardTitle>
          <CardDescription className="text-xs">
            Help Margot personalise recommendations for your audience and goals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="headline" className="text-xs">Professional headline</Label>
              <Input
                id="headline"
                placeholder="Founder @ Acme · B2B SaaS"
                value={form.headline}
                onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio" className="text-xs">About you</Label>
              <Textarea
                id="bio"
                placeholder="I help early-stage founders build marketing systems..."
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="industry" className="text-xs">Industry / niche</Label>
                <Input
                  id="industry"
                  placeholder="B2B SaaS"
                  value={form.industry}
                  onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetAudience" className="text-xs">Target audience</Label>
                <Input
                  id="targetAudience"
                  placeholder="Early-stage founders"
                  value={form.targetAudience}
                  onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="website" className="text-xs">Website</Label>
                <Input
                  id="website"
                  type="url"
                  placeholder="https://example.com"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="twitterHandle" className="text-xs">Twitter / X handle</Label>
                <Input
                  id="twitterHandle"
                  placeholder="username"
                  value={form.twitterHandle}
                  onChange={(e) => setForm((f) => ({ ...f, twitterHandle: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="linkedinUrl" className="text-xs">LinkedIn URL</Label>
              <Input
                id="linkedinUrl"
                type="url"
                placeholder="https://linkedin.com/in/username"
                value={form.linkedinUrl}
                onChange={(e) => setForm((f) => ({ ...f, linkedinUrl: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving…" : "Save profile"}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle className="h-3 w-3" />
                  Saved
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
