import type { NextConfig } from "next";

// GitHub Pages serves a project site from /<repo-name>, so the workflow sets BASE_PATH (e.g. "/msun-campus-map").
// Locally and on Vercel it's empty.
const basePath = process.env.BASE_PATH ?? "";

const nextConfig: NextConfig = {
  /* config options here */
  output: "export", // plain HTML/JS/CSS files in /out, no server needed
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
