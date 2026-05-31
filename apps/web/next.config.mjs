/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: [
    "@margot/schema",
    "@margot/planner",
    "@margot/marketing"
  ]
};

export default nextConfig;
