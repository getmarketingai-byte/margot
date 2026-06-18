import { redirect } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { auth } from "@/auth";
import { getPosts } from "@/app/actions/posts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  PenSquare,
  FileText,
  Clock,
  CheckCircle2,
  Archive,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { PostStatus } from "@margot/schema";
import { PostsFilterTabs } from "@/components/posts/posts-filter-tabs";

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

const STATUS_ICONS: Record<
  PostStatus,
  React.ComponentType<{ className?: string }>
> = {
  draft: FileText,
  scheduled: Clock,
  published: CheckCircle2,
  failed: FileText,
  archived: Archive,
};

const VALID_STATUSES: PostStatus[] = [
  "draft",
  "scheduled",
  "published",
  "failed",
  "archived",
];

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { status: statusParam, q } = await searchParams;
  const statusFilter = VALID_STATUSES.includes(statusParam as PostStatus)
    ? (statusParam as PostStatus)
    : undefined;

  const allPosts = await getPosts(statusFilter);
  const filtered = q
    ? allPosts.filter((p) =>
        p.content.toLowerCase().includes(q.toLowerCase())
      )
    : allPosts;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Posts
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "post" : "posts"}
            {statusFilter ? ` · ${STATUS_LABELS[statusFilter]}` : ""}
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/posts/new">
            <PenSquare className="mr-2 h-4 w-4" />
            New post
          </Link>
        </Button>
      </div>

      {/* Filter tabs — wrapped in Suspense because it uses useSearchParams */}
      <Suspense fallback={<div className="h-9 border-b border-border" />}>
        <PostsFilterTabs current={statusFilter} />
      </Suspense>

      {/* Search */}
      <form method="GET" className="flex gap-2">
        {statusFilter && (
          <input type="hidden" name="status" value={statusFilter} />
        )}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search posts…"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <Button type="submit" variant="secondary" size="sm">
          Search
        </Button>
      </form>

      {/* Post list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="mb-4 h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {q ? "No posts match your search." : "No posts yet."}
          </p>
          {!q && (
            <Button asChild className="mt-4" variant="outline">
              <Link href="/dashboard/posts/new">Write your first post</Link>
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((post) => {
            const Icon = STATUS_ICONS[post.status];
            const preview = post.content.slice(0, 160);
            return (
              <li key={post.id}>
                <Link href={`/dashboard/posts/${post.id}`} className="block">
                  <Card className="group cursor-pointer transition-shadow hover:shadow-md">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-medium text-foreground">
                          {preview}
                          {post.content.length > 160 ? "…" : ""}
                        </p>
                        <Badge
                          variant={STATUS_VARIANTS[post.status]}
                          className="shrink-0 capitalize"
                        >
                          <Icon className="mr-1 h-3 w-3" />
                          {STATUS_LABELS[post.status]}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="capitalize">{post.platform}</span>
                        <span>·</span>
                        <span>{post.content.length} chars</span>
                        <span>·</span>
                        <span>{formatRelativeTime(post.updatedAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
