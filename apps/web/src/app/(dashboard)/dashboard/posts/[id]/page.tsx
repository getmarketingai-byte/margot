import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getPost } from "@/app/actions/posts";
import { PostDetailClient } from "@/components/posts/post-detail-client";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  const { id } = await params;
  const post = await getPost(id);

  if (!post) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PostDetailClient post={post} />
    </div>
  );
}
