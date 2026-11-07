import type { MetadataRoute } from "next";

export const dynamic = "force-static"; // needed for the static export

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Lets Android/iPad "Add to Home Screen" open the map without browser bars
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MSU Naawan Campus Map",
    short_name: "Campus Map",
    start_url: `${BASE}/`,
    display: "standalone",
    background_color: "#eef2f7",
    theme_color: "#1e3a8a",
    icons: [], // no icon for now
  };
}
