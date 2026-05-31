import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Margot — AI Marketing Cockpit",
    short_name: "Margot",
    description:
      "AI-powered marketing assistant for Australian SMB entrepreneurs",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#6366f1",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
    categories: ["business", "productivity"],
    lang: "en-AU",
  };
}
