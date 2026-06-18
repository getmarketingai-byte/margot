"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  Configuration: {
    title: "Server configuration error",
    description:
      "There is a problem with the server configuration. Please contact support.",
  },
  AccessDenied: {
    title: "Access denied",
    description:
      "You do not have permission to sign in. Please contact support if this is unexpected.",
  },
  Verification: {
    title: "Unable to verify",
    description:
      "The sign-in link is no longer valid. It may have expired or already been used.",
  },
  OAuthSignin: {
    title: "Sign-in error",
    description:
      "Could not start the Google sign-in flow. Please try again.",
  },
  OAuthCallback: {
    title: "Callback error",
    description:
      "Something went wrong during the Google sign-in callback. Please try again.",
  },
  Default: {
    title: "Authentication error",
    description:
      "An unexpected error occurred during sign-in. Please try again.",
  },
};

function AuthErrorContent() {
  const params = useSearchParams();
  const errorCode = params.get("error") ?? "Default";
  const { title, description } =
    ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES["Default"]!;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-8 text-center dark:border-red-800 dark:bg-red-950">
        <h1 className="mb-2 text-xl font-semibold text-red-800 dark:text-red-200">
          {title}
        </h1>
        <p className="mb-6 text-sm text-red-600 dark:text-red-400">
          {description}
        </p>
        <Link
          href="/"
          className="inline-flex items-center rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <AuthErrorContent />
    </Suspense>
  );
}
