import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, signals } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { AddSignalForm } from "@/components/signals/add-signal-form";
import { SignalsFeed } from "@/components/signals/signals-feed";
import { Card, CardContent } from "@/components/ui/card";
import { Rss } from "lucide-react";

export default async function SignalsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select()
    .from(signals)
    .where(eq(signals.userId, session.user.id))
    .orderBy(desc(signals.capturedAt))
    .limit(100);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Signals</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Industry trends and intelligence. Turn any signal into a post draft.
          </p>
        </div>
        <AddSignalForm />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Rss className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No signals yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your first signal using the button above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <SignalsFeed signals={rows} />
      )}
    </div>
  );
}
