import type { MetadataRoute } from "next";

// PWA — instalável na tela inicial (iPhone/Android). Nome/ícones fáceis de trocar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Central NF-e",
    short_name: "Central NF-e",
    description:
      "Central Fiscal, Financeira e de Compras — NF-e dos CNPJs da empresa.",
    start_url: "/inicio",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0b3d2e",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
