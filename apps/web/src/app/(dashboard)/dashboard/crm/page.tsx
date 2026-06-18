import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, contacts } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Mail } from "lucide-react";

export default async function CRMPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id))
    .orderBy(desc(contacts.createdAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">CRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your contacts and relationship pipeline.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your first contact to start tracking relationships.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((contact) => (
            <Card key={contact.id}>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-semibold">{contact.name}</CardTitle>
                    {contact.company && (
                      <p className="text-xs text-muted-foreground mt-0.5">{contact.company}</p>
                    )}
                  </div>
                  {contact.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {contact.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              {contact.email && (
                <CardContent className="px-4 pb-4">
                  <a
                    href={`mailto:${contact.email}`}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Mail className="h-3 w-3" />
                    {contact.email}
                  </a>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
