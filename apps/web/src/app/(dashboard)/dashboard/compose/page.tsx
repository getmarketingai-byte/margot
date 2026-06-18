import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PenSquare } from "lucide-react";

export default async function ComposePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Compose</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Write and schedule content with AI assistance.
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center py-12 text-center">
          <PenSquare className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-sm text-muted-foreground">AI composer coming soon.</p>
          <p className="text-xs text-muted-foreground mt-1">
            This feature is being built. Posts can be created via the API.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
