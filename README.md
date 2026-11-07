# MSU Naawan Campus Map

Interactive campus map for **Mindanao State University – Naawan**, built with Next.js + Leaflet + Tailwind CSS. Deployable to Vercel in one command.

## Features

- Pan/zoom map centered on MSU Naawan (OpenStreetMap base tiles — no API key needed)
- 14 pre-loaded campus buildings and landmarks with colored pin markers
- Clickable markers → info panel with description and department details
- Category filter chips: Academic, Admin, Facilities, Student, Research
- Live search by building name
- Sidebar building list — click any entry to fly to its location on the map

## Project Structure

```
src/
  app/
    page.tsx          # Entry point (server component)
    layout.tsx
    globals.css       # Leaflet CSS imported here
  components/
    MapLoader.tsx     # Client wrapper for dynamic import (ssr: false)
    CampusMap.tsx     # Main interactive map component
  data/
    buildings.ts      # All building data — edit this to add/change buildings
```

## Adding or Editing Buildings

Open `src/data/buildings.ts`. Each building entry looks like:

```ts
{
  id: "admin",
  name: "Administration Building",
  shortName: "Admin",
  category: "Admin",          // Academic | Admin | Facilities | Student | Research
  lat: 8.4703,
  lng: 124.3338,
  description: "Short description shown in the info panel.",
  details: ["Office A", "Office B"],
}
```

To find accurate coordinates for a building, right-click it on [OpenStreetMap](https://www.openstreetmap.org) → "Show address" — the lat/lng appears in the URL.

## Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm install -g vercel
vercel
```

### Option B — GitHub + Vercel Dashboard

1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) → import the repo.
3. Leave all settings at defaults → **Deploy**.

No environment variables needed.

## Local Development

```bash
npm install
npm run dev
# → http://localhost:3000
```
