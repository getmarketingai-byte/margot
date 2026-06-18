"use client";

import React from "react";
import { signIn } from "next-auth/react";
import { Sparkles, Zap, Rss, Users, Brain, ArrowRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const features = [
  {
    icon: Brain,
    title: "AI Content Engine",
    description:
      "Generate on-brand posts, emails, and campaigns with a single prompt. Your voice, amplified.",
  },
  {
    icon: Rss,
    title: "Signal Intelligence",
    description:
      "Monitor trends, competitor moves, and industry signals in real-time. Never miss an opportunity.",
  },
  {
    icon: Users,
    title: "Smart CRM",
    description:
      "Track relationships, follow-up reminders, and engagement history in one unified view.",
  },
  {
    icon: Zap,
    title: "Autonomous Agents",
    description:
      "Set goals and let Margot's AI agents execute multi-step marketing workflows automatically.",
  },
];

const highlights = [
  "Publish to LinkedIn, Twitter/X, and email",
  "Vector search across all your content",
  "Encrypted OAuth token storage",
  "PWA – works offline",
];

export function LandingPage() {
  const handleSignIn = () => {
    void signIn("google", { callbackUrl: "/dashboard" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/40 bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-bold text-foreground">Margot</span>
          </div>
          <Button onClick={handleSignIn} size="sm">
            Sign in
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="container mx-auto max-w-6xl px-4 py-24 text-center md:py-32">
          <Badge variant="secondary" className="mb-6 inline-flex gap-1.5">
            <Sparkles className="h-3 w-3" />
            AI-Powered Marketing Dashboard
          </Badge>

          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-bold tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Your personal{" "}
            <span className="text-primary">AI marketing team</span>{" "}
            in your pocket
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground">
            Margot combines AI content generation, signal monitoring, smart CRM,
            and autonomous agents — so you can focus on strategy, not busywork.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button size="lg" onClick={handleSignIn} className="gap-2 px-8">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </Button>
            <Button variant="outline" size="lg" className="gap-2">
              Learn more <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Highlights */}
          <ul className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3">
            {highlights.map((h) => (
              <li key={h} className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-primary" />
                {h}
              </li>
            ))}
          </ul>
        </section>

        {/* Features */}
        <section className="border-t border-border bg-muted/30 py-20">
          <div className="container mx-auto max-w-6xl px-4">
            <div className="mb-12 text-center">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                Everything you need to grow
              </h2>
              <p className="mt-4 text-muted-foreground">
                Purpose-built tools that work together seamlessly.
              </p>
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-xl border border-border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24">
          <div className="container mx-auto max-w-2xl px-4 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Ready to supercharge your marketing?
            </h2>
            <p className="mt-4 text-muted-foreground">
              Join Margot and start publishing smarter, faster.
            </p>
            <Button size="lg" onClick={handleSignIn} className="mt-8 gap-2 px-10">
              Get started free
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border py-8">
        <div className="container mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Margot. Built with Next.js 15 &amp; Turborepo.
        </div>
      </footer>
    </div>
  );
}
