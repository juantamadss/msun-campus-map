// Shortest walking route over the campus walkways from OpenStreetMap.
// The walkway data comes from src/data/campus.json (OpenStreetMap + campus edits).

export type LatLng = [number, number];

interface OsmWay {
  type: string;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

/** A one-way gate on the segment a–b; a is the campus side, tg is where the gate sits (0 = a, 1 = b) */
interface OneWay { a: number; b: number; tg: number; noIn: boolean; noOut: boolean }

export interface Graph {
  pos: Map<number, LatLng>;
  adj: Map<number, { to: number; w: number }[]>;
  segs: [number, number][];
  oneway: Map<string, OneWay>;
}

export interface GateRule { point: number[]; use: string }

const segKey = (x: number, y: number) => (x < y ? `${x}|${y}` : `${y}|${x}`);

// local metres around p (fine at campus scale)
function toXY(o: LatLng, p: LatLng): [number, number] {
  return [(p[1] - o[1]) * 111320 * Math.cos((o[0] * Math.PI) / 180), (p[0] - o[0]) * 110540];
}
// position of p along A→B (0 at A, 1 at B)
function along(A: LatLng, B: LatLng, p: LatLng) {
  const [bx, by] = toXY(A, B), [px, py] = toXY(A, p);
  const l2 = bx * bx + by * by;
  return l2 ? (px * bx + py * by) / l2 : 0;
}
function inPoly(p: LatLng, poly: LatLng[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export interface Route {
  /** Full line to draw, from the start point to the destination */
  line: LatLng[];
  /** Walking distance in metres */
  meters: number;
}

// Road types people can't (or shouldn't) walk on
const SKIP = new Set(["motorway", "motorway_link", "trunk_link", "construction", "proposed", "raceway", "bus_guideway"]);

export function dist(a: LatLng, b: LatLng) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR;
  const dLng = (b[1] - a[1]) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function buildGraph(
  data: { elements?: OsmWay[] },
  closed: Set<string> = new Set(),
  gateRules: GateRule[] = [],
  areas: LatLng[][] = [],
): Graph {
  const pos = new Map<number, LatLng>();
  const adj = new Map<number, { to: number; w: number }[]>();
  const segs: [number, number][] = [];
  const oneway = new Map<string, OneWay>();
  const link = (a: number, b: number, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, w });
  };

  for (const el of data.elements ?? []) {
    if (el.type !== "way" || !el.nodes || !el.geometry) continue;
    const hw = el.tags?.highway;
    if (!hw || SKIP.has(hw) || el.tags?.foot === "no" || el.tags?.access === "no") continue;
    if (el.tags?.name && closed.has(el.tags.name)) continue;
    el.nodes.forEach((id, i) => {
      const g = el.geometry![i];
      if (g) pos.set(id, [g.lat, g.lon]);
    });
    for (let i = 1; i < el.nodes.length; i++) {
      const a = el.nodes[i - 1];
      const b = el.nodes[i];
      const pa = pos.get(a);
      const pb = pos.get(b);
      if (!pa || !pb) continue;
      const w = dist(pa, pb);
      link(a, b, w);
      link(b, a, w);
      segs.push([a, b]);
    }
  }
  const g: Graph = { pos, adj, segs, oneway };

  // Entrance-only and exit-only gates: allow crossing them in one direction only
  const inside = (p: LatLng) => areas.some((poly) => inPoly(p, poly));
  for (const gate of gateRules) {
    const noIn = gate.use === "exit", noOut = gate.use === "entrance";
    if (!noIn && !noOut) continue;
    const gp = gate.point as LatLng;
    const near = snap(g, gp);
    if (near.d > 5) continue;
    let [a, b] = near.seg;
    if (inside(pos.get(a)!) === inside(pos.get(b)!)) continue; // can't tell which side is campus
    if (!inside(pos.get(a)!)) [a, b] = [b, a];
    oneway.set(segKey(a, b), { a, b, tg: along(pos.get(a)!, pos.get(b)!, gp), noIn, noOut });
    const [from, to] = noIn ? [b, a] : [a, b]; // the direction that's not allowed
    adj.set(from, (adj.get(from) ?? []).filter((e) => e.to !== to));
  }
  return g;
}

// Nearest point on any walkway segment to p
function snap(g: Graph, p: LatLng) {
  // work in local metres (fine at campus scale)
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  const ky = 110540;
  let best = { d: Infinity, seg: [0, 0] as [number, number], pt: p as LatLng };
  for (const [a, b] of g.segs) {
    const A = g.pos.get(a)!;
    const B = g.pos.get(b)!;
    const ax = (A[1] - p[1]) * kx, ay = (A[0] - p[0]) * ky;
    const bx = (B[1] - p[1]) * kx, by = (B[0] - p[0]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    const d = Math.hypot(x, y);
    if (d < best.d) best = { d, seg: [a, b], pt: [p[0] + y / ky, p[1] + x / kx] };
  }
  return best;
}

/** Returns null if there's no walkway data or no connected path. */
export function findRoute(g: Graph, from: LatLng, to: LatLng): Route | null {
  if (!g.segs.length) return null;
  const s = snap(g, from);
  const e = snap(g, to);

  // Temporary nodes at the snapped points, joined to their segment ends
  // temporary start/end node ids; must never clash with real node ids (drawn roads use small negative ids)
  const S = -9e15, E = -9e15 - 1;
  const pos = new Map(g.pos);
  pos.set(S, s.pt);
  pos.set(E, e.pt);
  const extra = new Map<number, { to: number; w: number }[]>();
  // can you walk u → v along this segment? (only matters on a one-way gate's segment)
  const ok = (u: number, v: number, seg: [number, number]) => {
    const r = g.oneway.get(segKey(seg[0], seg[1]));
    if (!r) return true;
    const A = pos.get(r.a)!, B = pos.get(r.b)!;
    const t = (n: number) => (n === r.a ? 0 : n === r.b ? 1 : along(A, B, pos.get(n)!));
    const tu = t(u), tv = t(v);
    if ((tu - r.tg) * (tv - r.tg) >= 0) return true; // doesn't pass the gate
    return tu > tv ? !r.noIn : !r.noOut; // moving towards a = going into campus
  };
  const add = (a: number, b: number, seg: [number, number]) => {
    const w = dist(pos.get(a)!, pos.get(b)!);
    if (!extra.has(a)) extra.set(a, []);
    if (!extra.has(b)) extra.set(b, []);
    if (ok(a, b, seg)) extra.get(a)!.push({ to: b, w });
    if (ok(b, a, seg)) extra.get(b)!.push({ to: a, w });
  };
  add(S, s.seg[0], s.seg); add(S, s.seg[1], s.seg);
  add(E, e.seg[0], e.seg); add(E, e.seg[1], e.seg);
  if (segKey(s.seg[0], s.seg[1]) === segKey(e.seg[0], e.seg[1])) add(S, E, s.seg); // both on the same segment

  const edges = (n: number) => [...(g.adj.get(n) ?? []), ...(extra.get(n) ?? [])];

  // Dijkstra (graph is small, a simple scan is plenty)
  const d = new Map<number, number>([[S, 0]]);
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const open = new Set<number>([S]);
  while (open.size) {
    let u = NaN, best = Infinity;
    for (const n of open) if (d.get(n)! < best) { best = d.get(n)!; u = n; }
    open.delete(u);
    if (u === E) break;
    done.add(u);
    for (const { to, w } of edges(u)) {
      if (done.has(to)) continue;
      const nd = best + w;
      if (nd < (d.get(to) ?? Infinity)) { d.set(to, nd); prev.set(to, u); open.add(to); }
    }
  }
  if (!d.has(E)) return null;

  const path: LatLng[] = [];
  for (let n: number | undefined = E; n !== undefined; n = prev.get(n)) path.unshift(pos.get(n)!);
  const line: LatLng[] = [from, ...path, to];
  return { line, meters: d.get(E)! + s.d + e.d };
}

import campus from "@/data/campus.json";
import { closedRoads } from "@/data/closed-roads";

let cache: Graph | null = null;
/** Walking network: the campus roads and paths kept or drawn in the editor */
export async function loadGraph() {
  cache ??= buildGraph(
    campus.walk as { elements: OsmWay[] },
    new Set(closedRoads),
    campus.gates as GateRule[],
    campus.campus as LatLng[][],
  );
  return cache;
}
