"use client";

import { useTransition } from "react";
import type { Signal } from "@margot/schema";
import { deleteSignal, signalToPost } from "@/app/actions/signals";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Trash2, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SOURCE_COLORS: Record<string, string> = {
  competitor: "bg-red-100 text-red-800 border-red-200",
  trend: "bg-blue-100 text-blue-800 border-blue-200",
  feedback: "bg-purple-100 text-purple-800 border-purple-200",
  news: "bg-orange-100 text-orange-800 border-orange-200",
  manual: "bg-gray-100 text-gray-700 border-gray-200",
};

interface SignalCardProps {
  signal: Signal;
}

export function SignalCard({ signal }: SignalCardProps) {
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm("Delete this signal?")) return;
    startTransition(async () => {
      await deleteSignal(signal.id);
    });
  }

  function handleToPost() {
    startTransition(async () => {
      await signalToPost(signal.id);
    });
  }

  return (
    <Card className="group">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start gap-3">
          <CardTitle className="flex-1 text-sm font-semibold leading-snug">{signal.headline}</CardTitle>
          <Badge
            variant="outline"
            className={cn("shrink-0 text-xs capitalize", SOURCE_COLORS[signal.source] ?? SOURCE_COLORS.manual)}
          >
            {signal.source}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-2">
        {signal.summary && (
          <p className="text-xs text-muted-foreground line-clamp-3">{signal.summary}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {signal.url && (
              <a
                href={signal.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Source <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <span className="text-xs text-muted-foreground">
              {new Date(signal.capturedAt).toLocaleDateString()}
            </span>
          </div>

          <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={handleToPost}
              disabled={isPending}
              title="Create post from signal"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              Post
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={isPending}
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
