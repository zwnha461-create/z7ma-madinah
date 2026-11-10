// Live traffic from TomTom Traffic Flow Segment Data.
// For each of the 13 engine roads we sample 1-2 points that are actual vertices
// of that road's baked geometry in src/lib/roadsGeo.ts (middle of the road;
// the three ring roads get two points on opposite sides). TomTom returns, for
// the segment nearest each point, currentSpeed vs freeFlowSpeed — the ratio is
// a measured congestion signal, unlike the pattern model in engine.ts.
//
// Quota protection: the TomTom free tier is 2,500 requests/day SHARED across
// all visitors of the published site. Results are therefore cached in
// localStorage for 10 minutes and the page never refetches more often than
// every 10 minutes. The key comes from the VITE_TOMTOM_KEY env var (set in
// the Bolt project settings) — it is never committed to the repo.

import type { LatLng } from './roadsGeo';

export const LIVE_REFRESH_MS = 10 * 60 * 1000;
const CACHE_KEY = 'z7ma-tomtom-live-v1';
const MIN_CONFIDENCE = 0.4;

/** Sample points per road id — every coordinate below is a vertex of that
 *  road's polyline(s) in roadsGeo.ts (OSM geometry; salam/uhud/universities
 *  use their documented fallback lines). Ring roads: two opposite sides. */
export const ROAD_POINTS: Record<string, LatLng[]> = {
  // Ring roads — two points on opposite sides
  kfaisal: [[24.47363, 39.60502], [24.46312, 39.61153]], // N side / S side of the Haram ring
  kabdullah: [[24.49617, 39.60916], [24.44236, 39.66518]], // N arc / SE arc
  kkhalid: [[24.48766, 39.70961], [24.43582, 39.4718]], // E arc / NW arc
  // Single mid-road points
  kfahd: [[24.48728, 39.61117]],
  kabdulaziz: [[24.46987, 39.63414]],
  salam: [[24.4698, 39.57]],
  quba: [[24.4107, 39.6242]],
  abubakr: [[24.48097, 39.60065]],
  airport: [[24.51698, 39.66712]],
  hijra: [[24.43394, 39.58816]],
  uhud: [[24.493, 39.6108]],
  universities: [[24.4755, 39.564]],
  awali: [[24.44845, 39.62736]],
};

export const LIVE_POINT_COUNT = Object.values(ROAD_POINTS).reduce((a, p) => a + p.length, 0);

export interface LiveRoadScore {
  /** Congestion fraction 0..1 (same scale as engine roadScore). */
  score: number;
  /** score as a percentage 0..100. */
  pct: number;
  /** Worst (lowest) currentSpeed/freeFlowSpeed ratio among the road's points. */
  ratio: number;
  /** True when any sampled segment reported a road closure. */
  closure: boolean;
  /** TomTom confidence of the governing point. */
  confidence: number;
}

export interface LiveData {
  scores: Map<string, LiveRoadScore>;
  /** Epoch ms when the data was fetched from TomTom. */
  fetchedAt: number;
}

interface PointResult { ratio: number; confidence: number; closure: boolean; }

async function fetchPoint(key: string, [lat, lon]: LatLng): Promise<PointResult> {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
  const j = await res.json();
  const seg = j?.flowSegmentData;
  const cur = Number(seg?.currentSpeed), free = Number(seg?.freeFlowSpeed);
  if (!seg || !isFinite(cur) || !isFinite(free) || free <= 0) throw new Error('TomTom: bad segment');
  return { ratio: Math.max(0, Math.min(1, cur / free)), confidence: Number(seg.confidence) || 0, closure: seg.roadClosure === true };
}

/** Fetch live scores for all roads. Roads whose points all fail are absent
 *  from the returned Map (callers keep the pattern score for those). */
export async function fetchLiveScores(key: string): Promise<LiveData> {
  const roadIds = Object.keys(ROAD_POINTS);
  const perRoad = await Promise.all(roadIds.map(async id => {
    const settled = await Promise.allSettled(ROAD_POINTS[id].map(p => fetchPoint(key, p)));
    const pts = settled.filter((r): r is PromiseFulfilledResult<PointResult> => r.status === 'fulfilled').map(r => r.value);
    return [id, pts] as const;
  }));
  const scores = new Map<string, LiveRoadScore>();
  for (const [id, pts] of perRoad) {
    if (!pts.length) continue;
    const closed = pts.find(p => p.closure);
    if (closed) {
      scores.set(id, { score: 1, pct: 100, ratio: Math.min(...pts.map(p => p.ratio)), closure: true, confidence: closed.confidence });
      continue;
    }
    // Ignore low-confidence points only when another point for this road qualifies.
    const qualified = pts.filter(p => p.confidence >= MIN_CONFIDENCE);
    const used = qualified.length ? qualified : pts;
    const worst = used.reduce((a, p) => (p.ratio < a.ratio ? p : a), used[0]);
    const score = Math.max(0, Math.min(1, 1 - worst.ratio));
    scores.set(id, { score, pct: Math.round(score * 100), ratio: worst.ratio, closure: false, confidence: worst.confidence });
  }
  return { scores, fetchedAt: Date.now() };
}

/* ---------- 10-minute localStorage cache + in-flight dedupe ---------- */

export function loadCachedLive(): LiveData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; scores: [string, LiveRoadScore][] };
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.scores)) return null;
    if (Date.now() - parsed.fetchedAt >= LIVE_REFRESH_MS) return null; // stale
    return { scores: new Map(parsed.scores), fetchedAt: parsed.fetchedAt };
  } catch { return null; }
}

function saveCachedLive(data: LiveData) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: data.fetchedAt, scores: [...data.scores] })); } catch { /* storage full/blocked — ignore */ }
}

let inFlight: Promise<LiveData | null> | null = null;

/** Cache-aware entry point: fresh cache (<10 min) is reused with NO API call;
 *  otherwise one shared fetch runs (concurrent callers share the promise). */
export function getLiveScores(key: string): Promise<LiveData | null> {
  const cached = loadCachedLive();
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetchLiveScores(key)
    .then(data => { if (data.scores.size) { saveCachedLive(data); return data; } return null; })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}
