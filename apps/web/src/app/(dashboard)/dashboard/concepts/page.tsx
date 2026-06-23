import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, concepts } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { BrainDumpForm } from "@/components/concepts/brain-dump-form";
import { ConceptTree } from "@/components/concepts/concept-tree";
import { Card, CardContent } from "@/components/ui/card";
import { Brain } from "lucide-react";

export default async function ConceptsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select()
    .from(concepts)
    .where(eq(concepts.userId, session.user.id))
    .orderBy(desc(concepts.updatedAt))
    .limit(200);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Concepts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Brain dump an idea and it becomes a concept. Build your content map.
        </p>
      </div>

      {/* Brain dump CTA — always visible at top */}
      <BrainDumpForm />

      {/* Concept tree */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No concepts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Use Brain Dump above to capture your first idea.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              {rows.length} concept{rows.length !== 1 ? "s" : ""}
            </h2>
          </div>
          <ConceptTree concepts={rows} />
        </div>
      )}
    </div>
  );
}
