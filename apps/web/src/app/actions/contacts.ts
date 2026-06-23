"use server";

import { auth } from "@/auth";
import { db, contacts, contactInteractions } from "@margot/schema";
import { eq, and, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";

async function requireUser(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id;
}

export async function getContacts(stage?: string) {
  const userId = await requireUser();
  const conditions = [eq(contacts.userId, userId)];
  if (stage && stage !== "all") {
    conditions.push(eq(contacts.stage, stage));
  }
  return db
    .select()
    .from(contacts)
    .where(and(...conditions))
    .orderBy(desc(contacts.createdAt));
}

export async function createContact(data: {
  name: string;
  email?: string;
  handle?: string;
  company?: string;
  stage?: string;
  source?: string;
  notes?: string;
}) {
  const userId = await requireUser();
  const [row] = await db
    .insert(contacts)
    .values({
      userId,
      name: data.name,
      email: data.email,
      handle: data.handle,
      company: data.company,
      stage: data.stage ?? "lead",
      source: data.source,
      tags: [],
      notes: data.notes,
    })
    .returning();
  revalidatePath("/dashboard/crm");
  return row;
}

export async function updateContact(
  id: string,
  data: Partial<{
    name: string;
    email: string;
    handle: string;
    company: string;
    stage: string;
    source: string;
    notes: string;
  }>
) {
  const userId = await requireUser();
  const [row] = await db
    .update(contacts)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)))
    .returning();
  revalidatePath("/dashboard/crm");
  return row;
}

export async function deleteContact(id: string) {
  const userId = await requireUser();
  await db
    .delete(contacts)
    .where(and(eq(contacts.id, id), eq(contacts.userId, userId)));
  revalidatePath("/dashboard/crm");
}

export async function getContactInteractions(contactId: string) {
  const userId = await requireUser();
  return db
    .select()
    .from(contactInteractions)
    .where(
      and(
        eq(contactInteractions.contactId, contactId),
        eq(contactInteractions.userId, userId)
      )
    )
    .orderBy(desc(contactInteractions.date));
}

export async function createInteraction(data: {
  contactId: string;
  type: string;
  body: string;
  date?: Date;
}) {
  const userId = await requireUser();
  const [row] = await db
    .insert(contactInteractions)
    .values({
      userId,
      contactId: data.contactId,
      type: data.type,
      body: data.body,
      date: data.date ?? new Date(),
    })
    .returning();
  revalidatePath("/dashboard/crm");
  return row;
}
