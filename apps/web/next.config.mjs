/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false
  },
  transpilePackages: ["@calendar-automations/schema", "@calendar-automations/planner"]
};

export default nextConfig;
