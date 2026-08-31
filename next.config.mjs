/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O front nunca toca certificado/SEFAZ — isso vive só nas Cloud Functions.
  eslint: { ignoreDuringBuilds: true },
  // Carimbo do build. Sem isso não dá para saber, olhando o app, se o que está
  // no ar é o código de agora ou um deploy antigo que ficou pelo caminho.
  // COMMIT_REF é fornecido pela Netlify; rodando local, fica "local".
  env: {
    NEXT_PUBLIC_BUILD_REF: (process.env.COMMIT_REF ?? "local").slice(0, 7),
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
  },
};

export default nextConfig;
