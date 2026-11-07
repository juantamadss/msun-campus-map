// Places on the campus map. Generated from the OpenStreetMap export plus the
// edits made in campus-building-editor.html (see src/data/campus.json).
import campus from "./campus.json";

export type PlaceKind = "building" | "court" | "field" | "other" | "gate";

export interface Building {
  id: string;
  name: string;
  shortName: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  /** Outlines on the map that belong to this place */
  shapeIds: string[];
  description?: string;
  /** Offices or laboratories inside */
  offices?: string[];
  /** Photo for an office, keyed by office name */
  officeImages?: Record<string, string>;
  /** office name → its web page (set in the editor); offices without one get no Visit button */
  officeLinks?: Record<string, string>;
  image?: string;
  /** Which location this place belongs to (e.g. "main-campus") */
  site?: string;
}

// Photos live in /public; on GitHub Pages the site sits under /<repo-name>, so prefix the paths
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const withBase = (p?: string | null) => (p ? BASE + p : undefined);

const IMAGES: Record<string, string> = {
  "fisheries-science": "/images/fisheries-science.jpg",
};

export const buildings: Building[] = campus.places.map((p) => ({
  id: p.id,
  name: p.name,
  shortName: p.name,
  kind: p.kind as PlaceKind,
  lat: p.lat,
  lng: p.lng,
  shapeIds: p.shapeIds,
  offices: p.offices,
  officeImages: Object.fromEntries(Object.entries((p.officeImages ?? {}) as Record<string, string>).map(([k, v]) => [k, BASE + v])),
  officeLinks: (p.officeLinks ?? {}) as Record<string, string>,
  image: withBase(p.image ?? IMAGES[p.id]),
  site: (p as { site?: string }).site,
}));

export type Gate = { name: string; use: "entrance" | "exit" | "entrance_exit"; point: [number, number]; image?: string | null };
export const gates = campus.gates as Gate[];
export const KIND_LABEL: Record<PlaceKind, string> = { building: "Building", court: "Court", field: "Oval / field", other: "Area", gate: "Gate" };

const GATE_USE_LABEL = { entrance: "Entrance only", exit: "Exit only", entrance_exit: "Entrance & exit" };

/** Gates opened as cards (photo, directions) when tapped on the map */
export const gatePlaces: Building[] = gates.map((g, i) => ({
  id: `gate-${i}`,
  name: g.name || "Gate",
  shortName: g.name || "Gate",
  kind: "gate",
  lat: g.point[0],
  lng: g.point[1],
  shapeIds: [],
  description: `Gate · ${GATE_USE_LABEL[g.use]}`,
  offices: [],
  image: withBase(g.image),
}));

export type Site = { id: string; name: string; bounds: [[number, number], [number, number]] };
export const sites = ((campus as unknown as { sites?: Site[] }).sites ?? []) as Site[];
