import type { Metadata, Viewport } from "next";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/error-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Margot – AI Marketing Dashboard",
    template: "%s | Margot",
  },
  description:
    "Margot is an AI-powered marketing dashboard that helps you create content, track signals, and grow your audience.",
  keywords: ["marketing", "AI", "content", "dashboard", "social media"],
  authors: [{ name: "Margot" }],
  creator: "Margot",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "https://margot.vercel.app"
  ),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "https://margot.vercel.app",
    title: "Margot – AI Marketing Dashboard",
    description:
      "AI-powered marketing dashboard for modern creators and founders.",
    siteName: "Margot",
  },
  twitter: {
    card: "summary_large_image",
    title: "Margot – AI Marketing Dashboard",
    description:
      "AI-powered marketing dashboard for modern creators and founders.",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Margot",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#6366f1",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <SessionProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <Toaster />
        </SessionProvider>
      </body>
    </html>
  );
}
