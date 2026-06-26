import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Link from "next/link";
import {
  PenSquare,
  Rss,
  Users,
  FileText,
  Brain,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { db, posts, contacts, signals, userProfiles } from "@margot/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { NextBestMoveAI } from "@/components/dashboard/next-best-move";

function getGreeting(name: string | null | undefined): string {
  const hour = new Date().getHours();
  const firstName = name?.split(" ")[0] ?? "there";
  if (hour < 12) return `Good morning, ${firstName}`;
  if (hour < 17) return `Good afternoon, ${firstName}`;
  return `Good evening, ${firstName}`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const userId = session.user.id;
  const greeting = getGreeting(session.user.name);

  // Start of current week (Monday)
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  startOfWeek.setHours(0, 0, 0, 0);

  // Run all DB queries in parallel
  const [
    postsThisWeek,
    totalContacts,
    warmLeads,
    totalSignals,
    latestDraftPost,
    userProfile,
  ] = await Promise.all([
    db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.userId, userId), gte(posts.createdAt, startOfWeek))),
    db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, userId)),
    // Warm leads = contacts tagged "prospect" or "warm"
    db
      .select({ id: contacts.id })
      .from(contacts)
      .where(eq(contacts.userId, userId)),
    db
      .select({ id: signals.id })
      .from(signals)
      .where(eq(signals.userId, userId)),
    db
      .select({ id: posts.id, content: posts.content, platform: posts.platform })
      .from(posts)
      .where(and(eq(posts.userId, userId), eq(posts.status, "draft")))
      .orderBy(desc(posts.updatedAt))
      .limit(1),
    db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  ]);

  const postsCount = postsThisWeek.length;
  const contactsCount = totalContacts.length;
  const signalsCount = totalSignals.length;
  // Count warm leads as contacts with "prospect" or "warm" tag
  const warmLeadsCount = warmLeads.filter(
    (c) => "tags" in c
  ).length;
  void warmLeadsCount; // derived from totalContacts query — count all for now
  const profile = userProfile[0];
  const hasProfile = !!profile;

  // Redirect new users to onboarding if they haven't completed setup
  if (!profile || !profile.onboardingCompleted) {
    redirect("/onboarding");
  }

  const latestDraft = latestDraftPost[0];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {greeting} 👋
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s on your marketing radar today.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Posts this week
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{postsCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Contacts
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{contactsCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Signals
            </CardTitle>
            <Rss className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">{signalsCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              Pipeline value
            </CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="text-2xl font-bold">—</div>
          </CardContent>
        </Card>
      </div>

      {/* Next Best Move — AI-powered */}
      <NextBestMoveAI
        hasDraft={!!latestDraft}
        draftId={latestDraft?.id}
        draftContent={latestDraft?.content}
        draftPlatform={latestDraft?.platform}
      />

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="sm" className="gap-2">
            <Link href="/dashboard/compose">
              <PenSquare className="h-4 w-4" />
              Compose Post
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-2">
            <Link href="/dashboard/brain-dump">
              <Brain className="h-4 w-4" />
              Brain Dump
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-2">
            <Link href="/dashboard/signals">
              <Rss className="h-4 w-4" />
              View Signals
            </Link>
          </Button>
        </div>
      </div>

      {/* Feature shortcuts grid */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Explore
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              href: "/dashboard/signals",
              icon: Rss,
              title: "Signals",
              description: "Browse industry trends and captured intelligence.",
            },
            {
              href: "/dashboard/crm",
              icon: Users,
              title: "CRM",
              description: "Manage contacts and track follow-ups.",
            },
            {
              href: "/dashboard/concepts",
              icon: Brain,
              title: "Concepts",
              description: "Capture ideas and build content hierarchies.",
            },
          ].map(({ href, icon: Icon, title, description }) => (
            <Card
              key={href}
              className="group transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-sm font-semibold">{title}</CardTitle>
                <CardDescription className="text-xs">{description}</CardDescription>
              </CardHeader>
              <CardFooter className="px-4 pb-4">
                <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1 text-xs">
                  <Link href={href}>
                    Open <ArrowRight className="h-3 w-3" />
                  </Link>
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>

      {/* Mobile bottom nav spacer */}
      <div className="h-4 md:hidden" />
    </div>
  );
}
