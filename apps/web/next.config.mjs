/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@margot/schema", "@margot/marketing-engine"],
};

export default nextConfig;
