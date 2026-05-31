import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: [
    "@margot/schema",
    "@margot/planner",
    "@margot/marketing",
    "@margot/marketing-engine",
  ],
};

export default withSerwist(nextConfig);
