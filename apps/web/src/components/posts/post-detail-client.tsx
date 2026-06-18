"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ComposeEditor } from "./compose-editor";
import { updatePost, deletePost } from "@/app/actions/posts";
import type { Post, PostStatus } from "@margot/schema";
import { ArrowLeft, Pencil, Trash2, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

const STATUS_TRANSITIONS: Record<PostStatus, PostStatus | null> = {
  draft: "published",
  scheduled: "published",
  published: "archived",
  failed: "draft",
  archived: null,
};

const STATUS_LABELS: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  published: "Published",
  failed: "Failed",
  archived: "Archived",
};

const STATUS_VARIANTS: Record<
  PostStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "secondary",
  scheduled: "outline",
  published: "default",
  failed: "destructive",
  archived: "outline",
};

interface PostDetailClientProps {
  post: Post;
}

export function PostDetailClient({ post }: PostDetailClientProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const nextStatus = STATUS_TRANSITIONS[post.status];

  function handleStatusTransition() {
    if (!nextStatus) return;
    startTransition(async () => {
      await updatePost(post.id, { status: nextStatus });
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startTransition(async () => {
      await deletePost(post.id);
      router.push("/dashboard/posts");
    });
  }

  if (editing) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setEditing(false)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Cancel editing
        </button>
        <ComposeEditor initialPost={post} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/dashboard/posts">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Posts
          </Link>
        </Button>
      </div>

      {/* Status + meta */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_VARIANTS[post.status]}>
          {STATUS_LABELS[post.status]}
        </Badge>
        <span className="text-xs text-muted-foreground capitalize">
          {post.platform}
        </span>
        <span className="text-xs text-muted-foreground">
          Updated {formatRelativeTime(post.updatedAt)}
        </span>
      </div>

      {/* Content */}
      <div className="rounded-md border border-border bg-muted/30 px-4 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {post.content}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {post.content.length.toLocaleString()} characters
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={isPending}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>

          <Button
            variant={confirmDelete ? "destructive" : "outline"}
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
            onBlur={() => setConfirmDelete(false)}
          >
            {isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        </div>

        {/* Status transition — full width on mobile */}
        {nextStatus && (
          <Button
            onClick={handleStatusTransition}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {nextStatus === "published"
              ? "Publish"
              : nextStatus === "archived"
              ? "Archive"
              : STATUS_LABELS[nextStatus]}
          </Button>
        )}
      </div>
    </div>
  );
}
