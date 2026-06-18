import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, concepts } from "@margot/schema";
import { eq, desc, isNull } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";

export default async function ConceptsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select()
    .from(concepts)
    .where(eq(concepts.userId, session.user.id))
    .orderBy(desc(concepts.updatedAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Concepts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your ideas, content pillars, and knowledge map.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No concepts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your first concept to start building your content map.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((concept) => (
            <Card key={concept.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">{concept.title}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {concept.body && (
                  <p className="text-xs text-muted-foreground line-clamp-3">{concept.body}</p>
                )}
                {concept.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {concept.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
