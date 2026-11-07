"use client";

import dynamic from "next/dynamic";

const CampusMap = dynamic(() => import("./CampusMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="text-gray-500 text-sm">Loading campus map…</div>
    </div>
  ),
});

export default function MapLoader() {
  return <CampusMap />;
}
