import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, signals } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Rss, ExternalLink } from "lucide-react";

export default async function SignalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select({
      id: signals.id,
      source: signals.source,
      headline: signals.headline,
      url: signals.url,
      summary: signals.summary,
      capturedAt: signals.capturedAt,
    })
    .from(signals)
    .where(eq(signals.userId, session.user.id))
    .orderBy(desc(signals.capturedAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Signals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Industry trends and intelligence captured for you.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Rss className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No signals yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Signals will appear here as they are captured.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((signal) => (
            <Card key={signal.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-sm font-semibold leading-snug">
                    {signal.headline}
                  </CardTitle>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {signal.source}
                  </Badge>
                </div>
              </CardHeader>
              {(signal.summary ?? signal.url) && (
                <CardContent className="px-4 pb-4 space-y-2">
                  {signal.summary && (
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {signal.summary}
                    </p>
                  )}
                  {signal.url && (
                    <a
                      href={signal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
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
