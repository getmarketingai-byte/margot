/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: false,
  transpilePackages: [
    "@calendar-automations/schema",
    "@calendar-automations/planner",
    "@calendar-automations/marketing"
  ]
};

export default nextConfig;
