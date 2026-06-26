import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ComposeEditor } from "@/components/posts/compose-editor";

export default async function ComposePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Compose
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft saves automatically as you type.
        </p>
      </div>
      <ComposeEditor />
    </div>
  );
}
