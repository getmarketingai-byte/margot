"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { createPost } from "@/app/actions/posts";

interface GeneratedPost {
  content: string;
  pillar: string;
  reasoning: string;
}

interface NextBestMoveProps {
  /** When true, shows the "existing draft" path instead of AI generation */
  hasDraft?: boolean;
  draftId?: string;
  draftContent?: string;
  draftPlatform?: string;
}

export function NextBestMoveAI({
  hasDraft,
  draftId,
  draftContent,
  draftPlatform,
}: NextBestMoveProps) {
  const router = useRouter();
  const [generated, setGenerated] = useState<GeneratedPost | null>(null);
  const [loading, setLoading] = useState(!hasDraft);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function fetchGenerated() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/post", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Generation failed");
      }
      const data = (await res.json()) as GeneratedPost;
      setGenerated(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Only auto-fetch if user has no draft (no point generating when draft exists)
  useEffect(() => {
    if (!hasDraft) {
      fetchGenerated();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleUsePost() {
    if (!generated) return;
    startTransition(async () => {
      const post = await createPost({
        content: generated.content,
        platform: "linkedin",
        status: "draft",
      });
      router.push(`/dashboard/posts/${post.id}`);
    });
  }

  // Existing draft path — no AI shown
  if (hasDraft && draftId) {
    return (
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">Next Best Move</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            You have a draft post ready to publish on{" "}
            <span className="font-medium capitalize">{draftPlatform}</span>.
          </p>
          <p className="text-sm text-foreground line-clamp-2">
            &ldquo;{draftContent}&rdquo;
          </p>
          <Button size="sm" onClick={() => router.push(`/dashboard/posts/${draftId}`)}>
            Review and publish →
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </div>
            <CardTitle className="text-base">Next Best Move</CardTitle>
          </div>
          {generated && !loading && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={fetchGenerated}
              disabled={loading}
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Writing a post for you…
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {error.includes("ANTHROPIC_API_KEY")
                ? "AI generation needs setup — add ANTHROPIC_API_KEY to Vercel env vars."
                : "Couldn't generate a post right now."}
            </p>
            <Button size="sm" variant="outline" onClick={fetchGenerated}>
              Try again
            </Button>
          </div>
        ) : generated ? (
          <div className="space-y-3">
            <div className="rounded-md bg-background/60 p-3">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {generated.pillar}
              </p>
              <p className="text-sm text-foreground line-clamp-4 whitespace-pre-wrap leading-relaxed">
                {generated.content}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground italic">
              {generated.reasoning}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1"
                onClick={handleUsePost}
                disabled={isPending}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowRight className="h-3 w-3" />
                )}
                Use this post
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={fetchGenerated}
                disabled={loading}
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
