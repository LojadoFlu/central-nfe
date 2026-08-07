/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O front nunca toca certificado/SEFAZ — isso vive só nas Cloud Functions.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
