import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db, userProfiles } from "@margot/schema";
import { eq } from "drizzle-orm";
import { LandingPage } from "@/components/landing/landing-page";

export default async function HomePage() {
  const session = await auth();

  if (session?.user?.id) {
    // Check if user has completed onboarding (has a profile row)
    const [profile] = await db
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    if (profile) {
      redirect("/dashboard");
    } else {
      redirect("/onboarding");
    }
  }

  return <LandingPage />;
}
