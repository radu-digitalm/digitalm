import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Digital M",
    short_name: "Digital M",
    description: "AI for commerce, grounded in real delivery.",
    start_url: "/",
    display: "standalone",
    background_color: "#0A0E16",
    theme_color: "#0A0E16",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
