import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Zap } from "lucide-react";

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Agents</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Autonomous marketing agents for research, outreach, and scheduling.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center">
          <Zap className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm text-muted-foreground">Agents coming soon.</p>
          <p className="text-xs text-muted-foreground mt-1">
            AI-powered marketing agents will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
