import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, contacts } from "@margot/schema";
import { eq, desc } from "drizzle-orm";
import { AddContactForm } from "@/components/contacts/add-contact-form";
import { ContactsBoard } from "@/components/contacts/contacts-board";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";

export default async function CRMPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const rows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, session.user.id))
    .orderBy(desc(contacts.createdAt))
    .limit(200);

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your contacts and relationship pipeline.
          </p>
        </div>
        <AddContactForm />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-sm text-muted-foreground">No contacts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Add your first contact using the button above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ContactsBoard contacts={rows} />
      )}
    </div>
  );
}
