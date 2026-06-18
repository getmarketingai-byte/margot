import { ComposeEditor } from "@/components/posts/compose-editor";

export default function NewPostPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          New post
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft saves automatically as you type.
        </p>
      </div>
      <ComposeEditor />
    </div>
  );
}
