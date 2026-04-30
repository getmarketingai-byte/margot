import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { PRODUCT, SITE_URL } from "@/lib/marketing";
import { ADSENSE_PUBLISHER_ID, GOOGLE_ANALYTICS_ID } from "@/lib/analytics";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: PRODUCT.name,
    template: `%s — ${PRODUCT.name}`
  },
  description: PRODUCT.shortDescription,
  applicationName: PRODUCT.name,
  authors: [{ name: PRODUCT.legalName, url: SITE_URL }],
  openGraph: {
    siteName: PRODUCT.name,
    title: PRODUCT.name,
    description: PRODUCT.shortDescription,
    url: SITE_URL,
    type: "website"
  },
  robots: {
    index: true,
    follow: true
  }
  // The AdSense meta tag is rendered directly in <head> below rather than via
  // metadata.other — Next.js 15.5 streams metadata into the body via React
  // Suspense, which AdSense's static-HTML verification crawler doesn't see.
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
         * Google AdSense + Analytics tags are inlined directly in <head> so
         * Google's verification crawler sees them in the initial HTML
         * response. Placing them via next/script (any strategy) or via
         * metadata.other causes Next.js 15.5 to stream them into <body>,
         * which the static-HTML AdSense crawler does not parse.
         */}
        <meta name="google-adsense-account" content={ADSENSE_PUBLISHER_ID} />
        <script
          async
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUBLISHER_ID}`}
          crossOrigin="anonymous"
        />
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', '${GOOGLE_ANALYTICS_ID}');`
          }}
        />
      </head>
      <body className="min-h-dvh">
        {children}
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
