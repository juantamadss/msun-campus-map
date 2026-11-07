"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { buildings, gates, gatePlaces, KIND_LABEL, sites, type Building } from "@/data/buildings";
import campus from "@/data/campus.json";
import { dist, findRoute, loadGraph, type LatLng, type Route } from "@/lib/route";

const DESKTOP_MIN = 768;
const TOP_BAR = 76; // phone search bar area
const DIR_PANEL = 132; // phone From/To panel area

type Snap = "peek" | "half" | "full";
type Dir = { building: Building; label: string };

function matches(b: Building, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    b.name.toLowerCase().includes(s) ||
    b.shortName.toLowerCase().includes(s) ||
    (b.offices ?? []).some((o) => o.toLowerCase().includes(s))
  );
}

const minutes = (m: number) => Math.max(1, Math.round(m / 80));

// Names longer than 4 words show as an acronym on the map (e.g. "Training and Student Activity Center" → TSAC)
const SMALL_WORDS = new Set(["of", "the", "and", "for", "in", "at", "&"]);
function mapLabel(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 4) return name;
  return words
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ""))
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()))
    .map((w) => w[0].toUpperCase())
    .join("");
}

// ---- Icons ---------------------------------------------------------------
const Icon = {
  search: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
    </svg>
  ),
  close: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  back: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  ),
  directions: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21.7 11.3l-9-9a1 1 0 0 0-1.4 0l-9 9a1 1 0 0 0 0 1.4l9 9a1 1 0 0 0 1.4 0l9-9a1 1 0 0 0 0-1.4zM14 14.5V12h-4v3H8v-4a1 1 0 0 1 1-1h5V7.5l3.5 3.5-3.5 3.5z" />
    </svg>
  ),
  walk: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3A7.3 7.3 0 0 0 19 13v-2a5 5 0 0 1-4.3-2.4l-1-1.6a2 2 0 0 0-1.7-1c-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7z" />
    </svg>
  ),
  external: (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  ),
  locate: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      <circle cx="12" cy="12" r="8" />
    </svg>
  ),
  expand: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
  shrink: (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </svg>
  ),
};

// ---- Drawn campus map (no map tiles) --------------------------------------
type Kind = "building" | "court" | "field" | "other";
const SHAPE_STYLE: Record<string, Leaflet.PathOptions> = {
  building: { color: "#c3cfdf", weight: 1, fillColor: "#d9e1ec", fillOpacity: 1 },
  court: { color: "#b9c7da", weight: 1, fillColor: "#e3e9f1", fillOpacity: 1, dashArray: "3 3" },
  field: { color: "#c5dccb", weight: 1, fillColor: "#dcebe0", fillOpacity: 1 },
  other: { color: "#cfd3e6", weight: 1, fillColor: "#e2e4f0", fillOpacity: 1 },
};
const SHAPE_ON: Leaflet.PathOptions = { color: "#1e3a8a", weight: 2, fillColor: "#3b5bb5", fillOpacity: 0.55, dashArray: undefined };
const ROAD_WIDTH: Record<string, number> = { trunk: 13, primary: 12, secondary: 11, residential: 8, service: 6, track: 5, footway: 3, path: 3 };
const GATE_LOOK = {
  entrance_exit: { text: "IN / OUT", color: "#1e3a8a", label: "Entrance & exit" },
  entrance: { text: "IN", color: "#15803d", label: "Entrance" },
  exit: { text: "OUT", color: "#b91c1c", label: "Exit" },
};

export default function CampusMap() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const LRef = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Map<string, Leaflet.Marker>>(new Map());
  const routeLayer = useRef<Leaflet.LayerGroup | null>(null);
  const shapeLayers = useRef<Map<string, Leaflet.Polygon>>(new Map());

  function drawCampus(L: typeof Leaflet, map: Leaflet.Map) {
    // sea: close the coastline off to the west
    const c = campus.coast as [number, number][];
    const sea = [...c, [c[c.length - 1][0], c[c.length - 1][1] - 0.05], [c[0][0], c[0][1] - 0.05]] as [number, number][];
    L.polygon(sea, { stroke: false, fillColor: "#cfdcec", fillOpacity: 1, interactive: false }).addTo(map);
    for (const area of campus.campus as [number, number][][]) {
      L.polygon(area, { stroke: false, fillColor: "#e6ecf5", fillOpacity: 1, interactive: false }).addTo(map);
    }
    for (const r of campus.roads) {
      const w = ROAD_WIDTH[r.type] ?? 5;
      L.polyline(r.pts as [number, number][], { color: "#d3dbe7", weight: w + 2, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    }
    for (const r of campus.roads) {
      const w = ROAD_WIDTH[r.type] ?? 5;
      L.polyline(r.pts as [number, number][], { color: "#ffffff", weight: w, lineCap: "round", lineJoin: "round", interactive: false }).addTo(map);
    }
    // names of the campus roads, written along the road at its midpoint
    for (const r of campus.roads) {
      if (r.type !== "service" || !r.name) continue;
      const pts = r.pts as [number, number][];
      const k = Math.cos((pts[0][0] * Math.PI) / 180);
      const len = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * k);
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += len(pts[i - 1], pts[i]);
      let i = 1, run = 0;
      while (i < pts.length - 1 && run + len(pts[i - 1], pts[i]) < total / 2) run += len(pts[i - 1], pts[i++]);
      const [a, b] = [pts[i - 1], pts[i]];
      const t = len(a, b) ? (total / 2 - run) / len(a, b) : 0;
      const mid: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      let deg = (-Math.atan2((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * k) * 180) / Math.PI;
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      const icon = L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="cm-road-label" style="transform:translate(-50%,-50%) rotate(${deg.toFixed(1)}deg)">${r.name}</div>` });
      L.marker(mid, { icon, keyboard: false, interactive: false }).addTo(map);
    }
    const placeOf = new Map<string, Building>();
    buildings.forEach((b) => b.shapeIds.forEach((id) => placeOf.set(id, b)));
    // courts / oval first so buildings sit on top of them
    const ordered = [...campus.shapes].sort((a, b) => Number(a.kind === "building") - Number(b.kind === "building"));
    for (const sh of ordered) {
      const kind = (sh.kind as Kind) in SHAPE_STYLE ? sh.kind : "building";
      const place = placeOf.get(sh.id);
      const pg = L.polygon(sh.pts as [number, number][], { ...SHAPE_STYLE[kind], interactive: !!place, kind } as Leaflet.PolylineOptions).addTo(map);
      if (place) pg.on("click", () => openBuilding(place));
      shapeLayers.current.set(sh.id, pg);
    }
    gates.forEach((g, i) => {
      const look = GATE_LOOK[g.use];
      const icon = L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="cm-gate" style="background:${look.color}">${look.text}</div>` });
      L.marker(g.point, { icon, keyboard: false })
        .bindTooltip(`${g.name || "Gate"} · ${look.label}`, { direction: "top", offset: [0, -10], className: "cm-gate-tip" })
        .on("click", () => openBuilding(gatePlaces[i]))
        .addTo(map);
    });
    map.attributionControl.addAttribution('Map data © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors');
  }

  const [selected, setSelected] = useState<Building | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [dir, setDir] = useState<Dir | null>(null);
  const [from, setFrom] = useState("me");
  const [route, setRoute] = useState<Route | null>(null);
  const [routeMsg, setRouteMsg] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);

  // phone sheet
  const [snap, setSnap] = useState<Snap>("peek");
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [vh, setVh] = useState(() => window.innerHeight);
  const headRef = useRef<HTMLDivElement>(null);
  const [headH, setHeadH] = useState(84);

  // full screen
  const [isFs, setIsFs] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // live location (the phone's own GPS through the browser, free, no service needed)
  type Me = { lat: number; lng: number; acc: number };
  const [me, setMe] = useState<Me | null>(null);
  const [tracking, setTracking] = useState<"off" | "locating" | "on">("off");
  const [following, setFollowing] = useState(false);
  const followRef = useRef(false);
  const watchId = useRef<number | null>(null);
  const meLayers = useRef<{ circle: Leaflet.Circle; dot: Leaflet.Marker } | null>(null);
  const headingRef = useRef<number | null>(null);
  const [routeStart, setRouteStart] = useState<Me | null>(null); // "Your location" route origin; moves when you walk 8 m+
  const fitKey = useRef("");
  const gpsTried = useRef(false); // asked for GPS once for a route; don't keep re-asking after a refusal

  const immersive = isFs || standalone;
  // the map fills 100dvh, which already stops above the browser's bottom bar, so no extra room is needed
  void immersive;
  const barPx = 0;
  const barCss = "env(safe-area-inset-bottom, 0px)";

  const filtered = useMemo(() => buildings.filter((b) => matches(b, search)), [search]);

  const snapPx = useCallback(
    (s: Snap) => {
      const top = dir ? DIR_PANEL : TOP_BAR;
      if (s === "peek") return headH;
      if (s === "half") return Math.round(vh * 0.5);
      return vh - barPx - top - 8;
    },
    [dir, vh, barPx, headH],
  );
  const sheetH = dragH ?? snapPx(snap);

  // ---- Window / full screen listeners ----------------------------------
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    const onFs = () => {
      const d = document as Document & { webkitFullscreenElement?: Element };
      setIsFs(!!(document.fullscreenElement || d.webkitFullscreenElement));
    };
    const nav = navigator as Navigator & { standalone?: boolean };
    // inside another site's page (iframe) the host page sets the height, so Safari's bar isn't over the map
    let embedded = false;
    try { embedded = window.self !== window.top; } catch { embedded = true; }
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || !!nav.standalone || embedded);
    window.addEventListener("resize", onResize);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      window.removeEventListener("resize", onResize);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  // peek height = the sheet's header (title / route summary)
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeadH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- Hide names that would overlap (bigger buildings win) --------------
  const labelOrder = useMemo(() => {
    const area = new Map<string, number>();
    for (const sh of campus.shapes) {
      let a = 0;
      const p = sh.pts as number[][];
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        a += p[i][1] * q[0] - q[1] * p[i][0];
      }
      area.set(sh.id, Math.abs(a));
    }
    return [...buildings].sort(
      (x, y) => y.shapeIds.reduce((t, id) => t + (area.get(id) ?? 0), 0) - x.shapeIds.reduce((t, id) => t + (area.get(id) ?? 0), 0),
    );
  }, []);
  function declutter() {
    // gate tags always stay visible, so names avoid them
    const shown: DOMRect[] = [...(mapEl.current?.querySelectorAll(".cm-gate") ?? [])].map((g) => g.getBoundingClientRect());
    for (const b of labelOrder) {
      const el = markers.current.get(b.id)?.getElement()?.querySelector(".cm-place") as HTMLElement | null;
      if (!el) continue;
      el.style.visibility = "visible";
      const r = el.getBoundingClientRect();
      const pad = 3;
      const hit = shown.some((o) => r.left < o.right + pad && r.right > o.left - pad && r.top < o.bottom + pad && r.bottom > o.top - pad);
      if (hit) el.style.visibility = "hidden";
      else shown.push(r);
    }
    // road names give way to building names, and only show when zoomed in
    const zoomedIn = (mapRef.current?.getZoom() ?? 0) >= 18;
    for (const el of mapEl.current?.querySelectorAll<HTMLElement>(".cm-road-label") ?? []) {
      el.style.visibility = "visible";
      const r = el.getBoundingClientRect();
      const hit = !zoomedIn || shown.some((o) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top);
      if (hit) el.style.visibility = "hidden";
      else shown.push(r);
    }
  }

  // ---- Map setup -------------------------------------------------------
  useEffect(() => {
    if (mapRef.current || !mapEl.current) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled || !mapEl.current) return;
      LRef.current = L;

      const [[s0, w0], [n0, e0]] = campus.bounds as [[number, number], [number, number]];
      const map = L.map(mapEl.current, {
        zoomControl: false,
        attributionControl: false,
        maxZoom: 21,
        minZoom: 16,
        maxBounds: L.latLngBounds([s0 - 0.003, w0 - 0.003], [n0 + 0.003, e0 + 0.003]),
        maxBoundsViscosity: 0.8,
      });
      L.control.zoom({ position: "bottomleft" }).addTo(map);
      L.control.attribution({ position: "bottomleft", prefix: false }).addTo(map);

      // Building names written on the map (no pins)
      buildings.forEach((b) => {
        const icon = L.divIcon({
          className: "cm-place-wrap",
          html: `<div class="cm-place cm-place-${b.kind}">${mapLabel(b.name).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`,
          iconSize: [0, 0],
        });
        const marker = L.marker([b.lat, b.lng], { icon, title: b.name, keyboard: false }).addTo(map);
        marker.on("click", () => openBuilding(b));
        markers.current.set(b.id, marker);
      });
      map.on("zoomend moveend", declutter);

      const desktop = window.innerWidth >= DESKTOP_MIN;
      map.fitBounds(L.latLngBounds(buildings.map((b) => [b.lat, b.lng] as [number, number])), {
        paddingTopLeft: desktop ? [360, 60] : [40, TOP_BAR + 20],
        paddingBottomRight: desktop ? [60, 60] : [40, 84 + 30],
        maxZoom: 19,
      });
      drawCampus(L, map); // after the view is set, so layers can be re-ordered
      mapRef.current = map;
      requestAnimationFrame(declutter);
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Highlight the selected place's outline(s) -------------------------
  useEffect(() => {
    shapeLayers.current.forEach((layer, id) => {
      const on = !!selected?.shapeIds.includes(id);
      layer.setStyle(on ? SHAPE_ON : SHAPE_STYLE[(layer.options as { kind?: string }).kind ?? "building"]);
      if (on) layer.bringToFront();
    });
  }, [selected]);

  // ---- Pins: hide the selected one, and ones not matching search -------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    buildings.forEach((b) => {
      const m = markers.current.get(b.id);
      if (!m) return;
      const show = matches(b, search) && b.id !== selected?.id;
      if (show && !map.hasLayer(m)) m.addTo(map);
      if (!show && map.hasLayer(m)) map.removeLayer(m);
    });
    requestAnimationFrame(declutter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selected]);

  // ---- Centre the selected building in the visible area ---------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || dir) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const z = Math.max(map.getZoom(), 19);
    let dx = 0;
    let dy = 0;
    if (W >= DESKTOP_MIN) {
      const cardW = Math.min(420, Math.max(320, W * 0.27)) + 12;
      dx = W / 2 - (344 + (W - cardW)) / 2;
    } else {
      const sheetTop = H - barPx - Math.round(H * 0.5);
      dy = H / 2 - (TOP_BAR + sheetTop) / 2;
    }
    const pt = map.project([selected.lat, selected.lng], z).add([dx, dy]);
    map.flyTo(map.unproject(pt, z), z, { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ---- Route: work it out whenever directions or "From" change --------
  const liveStart = from === "me" ? routeStart : null;
  useEffect(() => {
    const key = dir ? `${dir.building.id}|${dir.label}|${from}` : "";
    const sameTrip = key !== "" && key === fitKey.current;
    if (!sameTrip) {
      setRoute(null);
      setRouteMsg(null);
    }
    if (!dir) return;
    if (from === "me" && !liveStart) {
      // start the GPS; the route appears as soon as the first position arrives
      if (tracking === "off" && !gpsTried.current) {
        gpsTried.current = true;
        setRouting(true);
        startTracking(false);
      } else if (tracking === "off") {
        setRouting(false);
        setRouteMsg("Couldn't get your location. Allow location access, or choose a starting point.");
      } else setRouting(true);
      return;
    }
    let stale = false;
    if (!sameTrip) setRouting(true);
    (async () => {
      const g = await loadGraph();
      if (stale) return;
      if (!g) return setRouteMsg("Walkway data hasn't been added yet.");
      const dest: LatLng = [dir.building.lat, dir.building.lng];
      let start: LatLng;
      if (from === "me") {
        start = [liveStart!.lat, liveStart!.lng];
        if (dist(start, dest) > 2000) {
          if (!stale) setRouteMsg("You seem to be off campus. Choose a starting building, or open Google Maps.");
          return;
        }
      } else {
        if (from.startsWith("gate:")) {
          start = gates[+from.slice(5)].point;
        } else {
          const b = buildings.find((x) => x.id === from)!;
          start = [b.lat, b.lng];
        }
      }
      const r = findRoute(g, start, dest);
      if (stale) return;
      setRouteMsg(null);
      if (r) setRoute(r);
      else setRouteMsg("Couldn't find a walking path between these two.");
    })().finally(() => {
      if (!stale) setRouting(false);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, from, liveStart, tracking === "off"]);

  // ---- Draw the route and slide the sheet down -------------------------
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    routeLayer.current?.remove();
    routeLayer.current = null;
    if (!map || !L || !route) return;

    const pts = route.line;
    const main = pts.slice(1, -1);
    const g = L.layerGroup().addTo(map);
    L.polyline(main, { color: "#ffffff", weight: 9, opacity: 0.9 }).addTo(g);
    L.polyline(main, { color: "#2563eb", weight: 5 }).addTo(g);
    L.polyline(pts.slice(0, 2), { color: "#2563eb", weight: 3, dashArray: "4 6" }).addTo(g);
    L.polyline(pts.slice(-2), { color: "#2563eb", weight: 3, dashArray: "4 6" }).addTo(g);
    L.circleMarker(pts[0], { radius: 7, color: "#2563eb", weight: 3, fillColor: "#ffffff", fillOpacity: 1 }).addTo(g);
    L.circleMarker(pts[pts.length - 1], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#1e3a8a", fillOpacity: 1 }).addTo(g);
    routeLayer.current = g;

    const key = dir ? `${dir.building.id}|${dir.label}|${from}` : "";
    if (key === fitKey.current) return; // same trip, just a live update: keep the view
    fitKey.current = key;
    const W = window.innerWidth;
    const desktop = W >= DESKTOP_MIN;
    const cardW = Math.min(420, Math.max(320, W * 0.27)) + 12;
    if (!desktop) setSnap("peek");
    map.flyToBounds(L.latLngBounds(pts), {
      paddingTopLeft: desktop ? [370, 60] : [30, DIR_PANEL + 16],
      paddingBottomRight: desktop ? [cardW + 40, 60] : [30, barPx + (headRef.current?.offsetHeight ?? 92) + 24],
      maxZoom: 19,
      duration: 0.6,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  // ---- Live location ---------------------------------------------------
  function startTracking(follow: boolean) {
    if (!navigator.geolocation) {
      setToast("This browser can't share its location.");
      return;
    }
    followRef.current = follow;
    setFollowing(follow);
    setTracking("locating");
    // compass for the direction arrow (iPhone asks permission, and only from a tap)
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    const listen = () => {
      const onTurn = (e: DeviceOrientationEvent) => {
        const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
        const h = ios ?? (e.absolute && e.alpha != null ? 360 - e.alpha : null);
        if (h == null) return;
        headingRef.current = h;
        const cone = meLayers.current?.dot.getElement()?.querySelector(".cm-me-cone") as HTMLElement | null;
        if (cone) {
          cone.style.display = "block";
          cone.style.transform = `translate(-50%, -100%) rotate(${h}deg)`;
        }
      };
      window.addEventListener("deviceorientationabsolute", onTurn as EventListener);
      window.addEventListener("deviceorientation", onTurn as EventListener);
    };
    if (DOE?.requestPermission) DOE.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
    else listen();

    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
        setTracking("on");
        setMe(next);
        setRouteStart((prev) => (!prev || dist([prev.lat, prev.lng], [next.lat, next.lng]) > 8 ? next : prev));
      },
      (err) => {
        if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        setTracking("off");
        setFollowing(false);
        setToast(
          err.code === 1
            ? "Location is turned off for this site. Allow it in your browser settings to see where you are."
            : "Couldn't find your location. Try again outdoors, or choose a starting point.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  useEffect(() => () => {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
  }, []);

  // stop following when the visitor moves the map themselves
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const stop = () => {
      followRef.current = false;
      setFollowing(false);
    };
    map.on("dragstart", stop);
    return () => {
      map.off("dragstart", stop);
    };
  }, [tracking]);

  // draw / move the blue dot
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !me) return;
    const ll: [number, number] = [me.lat, me.lng];
    if (!meLayers.current) {
      const circle = L.circle(ll, { radius: me.acc, color: "#2563eb", weight: 1, opacity: 0.35, fillColor: "#3b82f6", fillOpacity: 0.12, interactive: false }).addTo(map);
      const icon = L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: `<div class="cm-me"><div class="cm-me-cone"></div><div class="cm-me-pulse"></div><div class="cm-me-dot"></div></div>`,
      });
      const dot = L.marker(ll, { icon, interactive: false, keyboard: false, zIndexOffset: 3000 }).addTo(map);
      meLayers.current = { circle, dot };
      map.flyTo(ll, Math.max(map.getZoom(), 18), { duration: 0.6 });
    } else {
      meLayers.current.circle.setLatLng(ll).setRadius(me.acc);
      meLayers.current.dot.setLatLng(ll);
      if (followRef.current && !dir) map.panTo(ll, { animate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  const onLocate = () => {
    gpsTried.current = false;
    if (tracking === "off") return startTracking(true);
    followRef.current = true;
    setFollowing(true);
    if (me) mapRef.current?.flyTo([me.lat, me.lng], Math.max(mapRef.current.getZoom(), 18), { duration: 0.6 });
  };

  // ---- Actions ---------------------------------------------------------
  function openBuilding(b: Building) {
    setDir(null);
    setSelected(b);
    setSnap("half");
  }
  const closeBuilding = () => {
    setDir(null);
    setSelected(null);
    setSnap("peek");
  };
  const startDirections = (b: Building, label: string) => {
    setSelected(b);
    setFrom((f) => (f === b.id || f === b.id.replace("gate-", "gate:") ? "me" : f));
    setDir({ building: b, label });
  };
  const endDirections = () => {
    setDir(null);
    setSnap("half");
  };

  // ---- Sheet dragging (phone) ------------------------------------------
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, select, input")) return;
    drag.current = { y: e.clientY, h: sheetH, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (Math.abs(dy) > 5) d.moved = true;
    if (d.moved) setDragH(Math.max(snapPx("peek"), Math.min(snapPx("full"), d.h - dy)));
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      setSnap((s) => (s === "peek" ? "half" : "peek"));
    } else if (dragH != null) {
      const opts: Snap[] = ["peek", "half", "full"];
      const best = opts.reduce((a, b) => (Math.abs(snapPx(b) - dragH) < Math.abs(snapPx(a) - dragH) ? b : a));
      setSnap(best);
    }
    setDragH(null);
  };

  // ---- Pieces ----------------------------------------------------------
  // Fly the map to a group of places (a site), leaving room for the panels
  const showArea = (pts: [number, number][]) => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !pts.length) return;
    const desktop = window.innerWidth >= DESKTOP_MIN;
    if (!desktop) setSnap("peek");
    map.flyToBounds(L.latLngBounds(pts), {
      paddingTopLeft: desktop ? [360, 40] : [24, TOP_BAR + 16],
      paddingBottomRight: desktop ? [40, 40] : [24, barPx + 100],
      maxZoom: 19,
      duration: 0.6,
    });
  };

  const groups = [
    ...sites.map((st) => ({ id: st.id, name: st.name, items: filtered.filter((b) => b.site === st.id) })),
    { id: "other", name: sites.length ? "Other locations" : "", items: filtered.filter((b) => !sites.some((st) => st.id === b.site)) },
  ].filter((g) => g.items.length > 0);

  const Row = (b: Building) => (
    <li key={b.id}>
      <button
        onClick={() => openBuilding(b)}
        className={`flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--cm-hover)] ${
          selected?.id === b.id ? "bg-[var(--cm-hover)]" : ""
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--cm-ink)]">{b.name}</span>
          <span className="block truncate text-xs text-[var(--cm-muted)]">
            {b.offices && b.offices.length > 0 ? b.offices.join(" · ") : KIND_LABEL[b.kind]}
          </span>
        </span>
        <svg className="h-4 w-4 flex-shrink-0 text-[var(--cm-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </li>
  );

  const List = (
    <div>
      {filtered.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-[var(--cm-muted)]">No buildings match “{search}”.</p>
      )}
      {groups.map((g) => {
        // groups are an accordion; while searching, every group with a match is open
        const open = !g.name || !!search || openGroups.has(g.id);
        return (
          <section key={g.id}>
            {g.name && (
              <button
                onClick={() => {
                  const next = new Set(openGroups);
                  if (open) next.delete(g.id);
                  else {
                    next.add(g.id);
                    // on desktop the map is beside the list, so also show the area; on phones keep the list open
                    if (window.innerWidth >= DESKTOP_MIN) showArea(g.items.map((b) => [b.lat, b.lng] as [number, number]));
                  }
                  setOpenGroups(next);
                }}
                aria-expanded={open}
                className="sticky top-0 z-[1] flex w-full items-center justify-between border-b border-[var(--cm-line)] bg-[var(--cm-card)] px-5 py-3 text-left hover:bg-[var(--cm-hover)]"
              >
                <span className="text-sm font-bold text-[var(--cm-maroon)]">{g.name}</span>
                <svg
                  className={`h-4 w-4 text-[var(--cm-maroon)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
                </svg>
              </button>
            )}
            {open && <ul className="divide-y divide-[var(--cm-line)]">{g.items.map(Row)}</ul>}
          </section>
        );
      })}
    </div>
  );

  const searchInput = (big: boolean) => (
    <label
      className={`flex items-center gap-3 ${
        big ? "h-12 rounded-full bg-[var(--cm-card)] px-4 shadow-[0_2px_10px_rgba(10,20,50,0.22)]" : "rounded-xl bg-[var(--cm-field)] px-3 py-2.5"
      }`}
    >
      <span className="text-[var(--cm-muted)]">{Icon.search}</span>
      <input
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setDir(null);
          setSelected(null);
          setSnap("half");
        }}
        placeholder="Search buildings or offices"
        className="w-full min-w-0 bg-transparent text-[16px] text-[var(--cm-ink)] outline-none placeholder:text-[var(--cm-muted)] md:text-sm"
      />
    </label>
  );

  const pill = "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap";

  const Photo = (b: Building, rounded: boolean) => (
    <div className={`relative w-full overflow-hidden ${rounded ? "rounded-2xl" : ""}`} style={{ aspectRatio: "3 / 2" }}>
      {b.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.image} alt={b.name} className="h-full w-full object-cover" />
      ) : (
        <div className="cm-placeholder flex h-full w-full flex-col items-center justify-center gap-1 text-white">
          <span className="line-clamp-3 px-6 text-center text-2xl font-bold leading-tight tracking-tight" style={{ textWrap: "balance" }}>
            {b.name}
          </span>
          <span className="text-[11px] uppercase tracking-[0.14em] opacity-70">Photo coming soon</span>
        </div>
      )}
    </div>
  );

  const Actions = (b: Building) => (
    <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
      <button onClick={() => startDirections(b, b.name)} className={`${pill} bg-[var(--cm-maroon)] text-white`}>
        {Icon.directions} Directions
      </button>
      <a
        href={`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${pill} bg-[var(--cm-hover)] text-[var(--cm-maroon)]`}
      >
        {Icon.external} Google Maps
      </a>
    </div>
  );

  const Offices = (b: Building) =>
    b.offices && b.offices.length > 0 ? (
      <div>
        <div className="mb-2 text-base font-bold text-[var(--cm-ink)]">Offices</div>
        <div className="-mx-5 flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
          {b.offices.map((o) => (
            <div
              key={o}
              className="flex w-[200px] flex-shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-[var(--cm-line)] bg-[var(--cm-card)]"
            >
              {b.officeImages?.[o] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.officeImages[o]} alt={o} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              )}
              <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
                <div className="line-clamp-3 text-sm font-semibold leading-snug text-[var(--cm-ink)]">{o}</div>
                <button
                  onClick={() => startDirections(b, o)}
                  className={`${pill} self-start bg-[var(--cm-hover)] px-3 py-1.5 text-xs text-[var(--cm-maroon)]`}
                >
                  {Icon.directions} Directions
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    ) : null;

  const Coords = (b: Building) => (
    <div className="text-center font-mono text-[11px] text-[var(--cm-muted)]">
      {b.lat.toFixed(6)}° N, {b.lng.toFixed(6)}° E
    </div>
  );

  const RouteSummary = (
    <div className="min-h-[52px]">
      {routing ? (
        <div className="text-sm text-[var(--cm-muted)]">Finding the shortest route…</div>
      ) : route ? (
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-[#15803d]">{minutes(route.meters)} min</span>
            <span className="text-base text-[var(--cm-muted)]">({Math.round(route.meters)} m)</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-[var(--cm-muted)]">
            {Icon.walk} <span className="truncate">Walking to {dir?.label}</span>
          </div>
        </div>
      ) : routeMsg ? (
        <div className="text-sm leading-relaxed text-[#b45309]">{routeMsg}</div>
      ) : null}
    </div>
  );

  const FromTo = (
    <div className="flex items-stretch gap-2">
      <button
        onClick={endDirections}
        aria-label="Back"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center self-start rounded-full text-[var(--cm-ink)] hover:bg-[var(--cm-field)]"
      >
        {Icon.back}
      </button>
      <div className="flex flex-col items-center gap-1 pt-3.5">
        <span className="h-3 w-3 rounded-full border-[3px] border-[#2563eb]" />
        <span className="h-5 border-l-2 border-dotted border-[var(--cm-line-strong)]" />
        <span className="h-3 w-3 rounded-full bg-[var(--cm-maroon)]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <select
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
          className="h-10 w-full min-w-0 rounded-lg border border-[var(--cm-line)] bg-[var(--cm-card)] px-3 text-[16px] text-[var(--cm-ink)] outline-none md:text-sm"
        >
          <option value="me">Your location</option>
          {gates.length > 0 && (
            <optgroup label="Gates">
              {gates.map((g, i) => (
                <option key={i} value={`gate:${i}`} disabled={dir?.building.id === `gate-${i}`}>
                  {g.name || "Gate"} ({GATE_LOOK[g.use].label})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Buildings & places">
            {buildings
              .filter((b) => b.id !== dir?.building.id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </optgroup>
        </select>
        <div className="flex h-10 min-w-0 items-center rounded-lg border border-[var(--cm-line)] bg-[var(--cm-field)] px-3 text-sm">
          <span className="truncate font-medium text-[var(--cm-ink)]">{dir?.label}</span>
          {dir && dir.label !== dir.building.name && (
            <span className="ml-1.5 flex-shrink-0 text-xs text-[var(--cm-muted)]">· {dir.building.name}</span>
          )}
        </div>
      </div>
    </div>
  );

  // ---- Layout ----------------------------------------------------------
  return (
    <div
      className="cm-root relative h-[100dvh] w-full overflow-hidden bg-[var(--cm-paper)] font-sans"
      style={{ ["--cm-sheet" as string]: `calc(${sheetH}px + ${barCss} + 8px)` }}
    >
      <div ref={mapEl} className="absolute inset-0 z-0" />

      {/* ===== Desktop / tablet: left panel ===== */}
      <aside className="absolute bottom-3 left-3 top-3 z-[1000] hidden w-80 flex-col overflow-hidden rounded-2xl bg-[var(--cm-card)] shadow-[0_8px_30px_rgba(10,20,50,0.22)] md:flex">
        <header className="cm-header flex items-center justify-between px-5 pb-4 pt-5 text-white">
          <h1 className="text-xl font-bold">Campus Map</h1>
        </header>
        <div className="border-b border-[var(--cm-line)] p-3">{searchInput(false)}</div>
        <div className="flex-1 overflow-y-auto">{List}</div>
        <div className="border-t border-[var(--cm-line)] px-4 py-2 text-xs text-[var(--cm-muted)]">
          {filtered.length} of {buildings.length} buildings
        </div>
      </aside>

      {/* ===== Desktop / tablet: right card ===== */}
      {selected && (
        <div className="absolute bottom-3 right-3 top-3 z-[1000] hidden w-[27%] min-w-[320px] max-w-[420px] overflow-y-auto rounded-2xl bg-[var(--cm-card)] shadow-[0_8px_30px_rgba(10,20,50,0.25)] md:block">
          {dir ? (
            <div className="flex flex-col gap-4 border-b border-[var(--cm-line)] p-4">
              {FromTo}
              <div className="px-1">{RouteSummary}</div>
            </div>
          ) : (
            <div className="relative">
              {Photo(selected, false)}
              <button
                onClick={closeBuilding}
                aria-label="Close"
                className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm hover:bg-black/60"
              >
                {Icon.close}
              </button>
            </div>
          )}
          <div className="flex flex-col gap-5 p-5">
            <div>
              <h2 className="text-2xl font-bold leading-tight text-[var(--cm-ink)]" style={{ textWrap: "balance" }}>
                {selected.name}
              </h2>
              {selected.description && <p className="mt-1 text-sm text-[var(--cm-muted)]">{selected.description}</p>}
            </div>
            {!dir && Actions(selected)}
            {Offices(selected)}
            {dir && Photo(selected, true)}
            {Coords(selected)}
          </div>
        </div>
      )}

      {/* ===== Phone: top bar ===== */}
      <div className="absolute inset-x-0 top-0 z-[1000] px-3 pt-[max(12px,env(safe-area-inset-top))] md:hidden">
        {dir ? (
          <div className="rounded-2xl bg-[var(--cm-card)] p-2.5 shadow-[0_2px_12px_rgba(10,20,50,0.22)]">{FromTo}</div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{searchInput(true)}</div>
          </div>
        )}
      </div>

      {/* ===== Phone: bottom sheet ===== */}
      <div
        className={`absolute inset-x-0 z-[1000] flex flex-col rounded-t-[28px] bg-[var(--cm-card)] shadow-[0_-4px_20px_rgba(10,20,50,0.18)] md:hidden ${
          dragH == null ? "transition-[height] duration-300 ease-out" : ""
        }`}
        // sheet runs to the bottom edge; the list continues behind Safari's bar
        style={{ bottom: 0, height: `calc(${sheetH}px + ${barCss})` }}
      >
        {/* drag area */}
        <div
          ref={headRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          className="flex-shrink-0 touch-none select-none px-5 pb-3 pt-2.5"
        >
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--cm-line-strong)]" />
          {dir ? (
            RouteSummary
          ) : selected ? (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[22px] font-bold leading-tight text-[var(--cm-ink)]" style={{ textWrap: "balance" }}>
                  {selected.name}
                </h2>
                {selected.description && <p className="mt-1 text-sm text-[var(--cm-muted)]">{selected.description}</p>}
              </div>
              <button
                onClick={closeBuilding}
                aria-label="Close"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--cm-field)] text-[var(--cm-ink)]"
              >
                {Icon.close}
              </button>
            </div>
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="text-lg font-bold text-[var(--cm-ink)]">Campus buildings</span>
              <span className="text-xs text-[var(--cm-muted)]">{filtered.length} buildings</span>
            </div>
          )}
        </div>

        <div
          className={`min-h-0 flex-1 ${snap === "peek" && dragH == null ? "overflow-hidden" : "overflow-y-auto"}`}
          style={{ paddingBottom: barCss }}
        >
          {selected ? (
            <div className="flex flex-col gap-5 px-5 pb-6">
              {dir && (
                <h2 className="text-lg font-bold leading-tight text-[var(--cm-ink)]" style={{ textWrap: "balance" }}>
                  {selected.name}
                </h2>
              )}
              {!dir && Actions(selected)}
              {Offices(selected)}
              {Photo(selected, true)}
              {Coords(selected)}
            </div>
          ) : (
            <div className="border-t border-[var(--cm-line)]">{List}</div>
          )}
        </div>
      </div>

      {/* ===== Locate me ===== */}
      <button
        onClick={onLocate}
        aria-label="Show my location"
        title="Show my location"
        className={`cm-locate z-[1000] flex h-12 w-12 items-center justify-center rounded-full bg-[var(--cm-card)] shadow-[0_2px_10px_rgba(10,20,50,0.25)] ${
          following && tracking === "on" ? "text-[#2563eb]" : "text-[var(--cm-ink)]"
        } ${tracking === "locating" ? "animate-pulse" : ""}`}
      >
        {Icon.locate}
      </button>

      {/* ===== Toast ===== */}
      {toast && (
        <div className="absolute inset-x-3 top-[calc(max(12px,env(safe-area-inset-top))+60px)] z-[1100] mx-auto max-w-sm rounded-2xl bg-[#0f172a] px-4 py-3 text-sm leading-relaxed text-white shadow-lg md:top-6">
          {toast}
          <button onClick={() => setToast(null)} className="ml-2 font-semibold text-[#93c5fd]">
            OK
          </button>
        </div>
      )}
    </div>
  );
}
