import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
  },
  other: {
    "google-adsense-account": ADSENSE_PUBLISHER_ID
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {children}
        <SiteFooter />

        <Script
          id="adsbygoogle-loader"
          async
          strategy="afterInteractive"
          src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUBLISHER_ID}`}
          crossOrigin="anonymous"
        />

        <Script
          id="gtag-loader"
          async
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`}
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GOOGLE_ANALYTICS_ID}');
          `}
        </Script>
      </body>
    </html>
  );
}
