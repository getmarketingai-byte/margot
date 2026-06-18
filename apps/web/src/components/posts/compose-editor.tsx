"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createPost, updatePost } from "@/app/actions/posts";
import type { Post, PostPlatform } from "@margot/schema";
import { cn } from "@/lib/utils";
import { Loader2, Check } from "lucide-react";

const PLATFORMS: Array<{ value: PostPlatform; label: string }> = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "twitter", label: "Twitter / X" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "newsletter", label: "Newsletter" },
  { value: "blog", label: "Blog" },
  { value: "email", label: "Email" },
];

const CHAR_LIMITS: Partial<Record<PostPlatform, number>> = {
  linkedin: 3000,
  twitter: 280,
};

interface ComposeEditorProps {
  initialPost?: Post;
}

export function ComposeEditor({ initialPost }: ComposeEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [postId, setPostId] = useState<string | null>(initialPost?.id ?? null);
  const [content, setContent] = useState(initialPost?.content ?? "");
  const [platform, setPlatform] = useState<PostPlatform>(
    initialPost?.platform ?? "linkedin"
  );
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limit = CHAR_LIMITS[platform] ?? null;
  const count = content.length;
  const overLimit = limit !== null && count > limit;

  const save = useCallback(
    async (status?: "draft") => {
      if (!content.trim()) return;
      setSaveState("saving");
      try {
        if (postId) {
          await updatePost(postId, { content, platform, status });
        } else {
          const created = await createPost({ content, platform, status: status ?? "draft" });
          if (created) setPostId(created.id);
        }
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 2000);
      } catch {
        setSaveState("idle");
      }
    },
    [content, platform, postId]
  );

  // Auto-save on pause
  useEffect(() => {
    if (!content.trim()) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      save("draft");
    }, 1500);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [content, save]);

  function handlePublish() {
    if (!content.trim() || overLimit) return;
    startTransition(async () => {
      if (postId) {
        await updatePost(postId, { content, platform, status: "published" });
      } else {
        await createPost({ content, platform, status: "published" });
      }
      router.push("/dashboard/posts");
    });
  }

  function handleSaveDraft() {
    startTransition(async () => {
      await save("draft");
      router.push("/dashboard/posts?status=draft");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Platform selector */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="platform"
          className="text-sm font-medium text-foreground"
        >
          Platform
        </label>
        <select
          id="platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as PostPlatform)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Text editor */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="content"
          className="text-sm font-medium text-foreground"
        >
          Content <span className="text-destructive">*</span>
        </label>
        <textarea
          id="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What do you want to say?"
          rows={10}
          className={cn(
            "w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            overLimit ? "border-destructive focus:ring-destructive" : "border-input"
          )}
        />
        {/* Character count */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span
            className={cn(
              "font-mono",
              overLimit && "font-semibold text-destructive"
            )}
          >
            {count.toLocaleString()}
            {limit !== null && ` / ${limit.toLocaleString()}`}
          </span>
          {/* Auto-save indicator */}
          <span className="flex items-center gap-1">
            {saveState === "saving" && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving…
              </>
            )}
            {saveState === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-600" />
                <span className="text-green-600">Saved</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
        <Button
          variant="outline"
          onClick={handleSaveDraft}
          disabled={isPending || !content.trim()}
        >
          Save draft
        </Button>

        {/* Full-width Publish on mobile */}
        <Button
          onClick={handlePublish}
          disabled={isPending || !content.trim() || overLimit}
          className="w-full sm:w-auto"
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          Publish
        </Button>
      </div>

      {overLimit && (
        <Badge variant="destructive" className="self-start">
          {count - (limit ?? 0)} characters over the {platform} limit
        </Badge>
      )}
    </div>
  );
}
