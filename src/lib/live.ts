// Live traffic from TomTom: Flow Segment Data (measured speeds) + Traffic
// Incidents (accidents / roadworks / closures) for Madinah.
//
// Flow: each of the 13 engine roads is sampled at 2-4 points that are actual
// vertices of that road's baked geometry in src/lib/roadsGeo.ts (chosen by
// farthest-point spread over the road's vertices, then verified against the
// geometry data): the three ring roads get 4 points spread around them, long
// roads 3, short roads 2 — 37 points in total. TomTom returns, for the segment
// nearest each point, currentSpeed vs freeFlowSpeed — the ratio is a measured
// congestion signal, unlike the pattern model in engine.ts. The governing
// (worst) point's measured speeds are kept on the score so the UI can show
// them («السرعة الآن X كم/س من أصل Y»).
//
// Incidents: ONE extra request per cycle to the Traffic Incidents API v5
// (incidentDetails) over a bounding box covering the whole baked road network
// (roadsGeo extents padded by ~0.02°). Fully defensive: any failure yields
// "incidents unknown", never an error in the page.
//
// Quota protection: the TomTom free tier is 2,500 requests/day SHARED across
// all visitors of the published site, and one full refresh cycle now costs
// 37 flow points + 1 incidents = 38 requests. Results are therefore cached in
// localStorage for 10 minutes and the page never refetches more often than
// every 10 minutes (worst case, one tab left open 24h: 38 x 144 = 5,472
// requests/day — which is exactly why the production architecture is a
// shared-cache proxy in front of TomTom; see REVERSE_ENGINEERING.md 3.7/3.8).
// The key comes from the VITE_TOMTOM_KEY env var (set in the Bolt project
// settings) — it is never committed to the repo.

import type { LatLng } from './roadsGeo';

export const LIVE_REFRESH_MS = 10 * 60 * 1000;
const CACHE_KEY = 'z7ma-tomtom-live-v2';
const MIN_CONFIDENCE = 0.4;

/** Sample points per road id — every coordinate below is a vertex of that
 *  road's polyline(s) in roadsGeo.ts (OSM geometry + EXTRA_GEO merges;
 *  salam/uhud/universities use their documented fallback lines). Selection:
 *  farthest-point spread over the road's vertex set, so the points cover the
 *  road end-to-end instead of clustering at its middle. */
export const ROAD_POINTS: Record<string, LatLng[]> = {
  // Ring roads — 4 points spread around each ring
  kfaisal: [[24.4641, 39.61728], [24.47287, 39.60386], [24.46307, 39.60441], [24.47386, 39.61355]],
  kabdullah: [[24.4205, 39.62092], [24.50013, 39.62614], [24.45752, 39.6678], [24.46577, 39.58306]],
  kkhalid: [[24.51574, 39.45324], [24.38326, 39.68828], [24.3703, 39.52049], [24.52431, 39.69484]],
  // Long roads — 3 points along the road
  kabdulaziz: [[24.46286, 39.80725], [24.46895, 39.61956], [24.47577, 39.70994]],
  quba: [[24.3538, 39.67218], [24.46554, 39.60774], [24.4107, 39.6242]],
  abubakr: [[24.48499, 39.45426], [24.47131, 39.60608], [24.48405, 39.5349]],
  airport: [[24.54555, 39.69848], [24.47812, 39.62121], [24.50725, 39.6562]],
  hijra: [[24.45438, 39.70634], [24.34974, 39.55157], [24.43677, 39.60108]],
  // Short roads — 2 points
  kfahd: [[24.50122, 39.61348], [24.47495, 39.61107]],
  salam: [[24.474, 39.549], [24.46714, 39.60273]],
  awali: [[24.42651, 39.65786], [24.46307, 39.61546]],
  uhud: [[24.47, 39.6115], [24.5035, 39.6128]],
  universities: [[24.4676, 39.606], [24.4835, 39.5445]],
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
  /** Measured current speed (km/h) at the governing point. */
  currentSpeed: number;
  /** Free-flow speed (km/h) at the governing point. */
  freeFlowSpeed: number;
}

/* ---------- incidents ---------- */

/** Bounding box covering the whole baked road network (roadsGeo extents:
 *  lat 24.34518..24.54555, lon 39.45064..39.80725) padded by ~0.02°.
 *  TomTom wants minLon,minLat,maxLon,maxLat. Area ~1,100 km² (limit 10,000). */
export const MADINAH_BBOX = '39.43064,24.32518,39.82725,24.56555';

/** Arabic labels for TomTom iconCategory values (Traffic Incidents API v5). */
export const INCIDENT_CATEGORY_AR: Record<number, string> = {
  0: 'تنبيه مروري',
  1: 'حادث',
  2: 'ضباب',
  3: 'ظروف قيادة خطرة',
  4: 'أمطار',
  5: 'طريق زلق',
  6: 'ثلوج',
  7: 'رياح قوية',
  8: 'تنبيه مروري',
  9: 'أعمال صيانة على الطريق',
  10: 'إغلاق طريق',
  11: 'إغلاق مسار',
  12: 'تضييق مسارات',
};

export interface LiveIncident {
  /** Arabic type label (from iconCategory, with a delay-based fallback). */
  label: string;
  /** Human location/description text (from-to, road numbers, or TomTom's event description). */
  text: string;
  /** Reported delay in minutes (0 when TomTom gives none). */
  delayMin: number;
  /** TomTom magnitudeOfDelay 0..4 (4 usually means a closure). */
  magnitude: number;
  /** [lat, lon] of the incident when its geometry gives one. */
  point?: LatLng;
}

export interface LiveData {
  scores: Map<string, LiveRoadScore>;
  /** Current incidents in the Madinah box (empty when none reported). */
  incidents: LiveIncident[];
  /** True when the incidents request actually succeeded (so an empty list
   *  really means "none reported", not "couldn't fetch"). */
  incidentsKnown: boolean;
  /** Epoch ms when the data was fetched from TomTom. */
  fetchedAt: number;
}

interface PointResult { ratio: number; confidence: number; closure: boolean; currentSpeed: number; freeFlowSpeed: number; }

async function fetchPoint(key: string, [lat, lon]: LatLng): Promise<PointResult> {
  const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=${lat},${lon}&unit=KMPH&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom HTTP ${res.status}`);
  const j = await res.json();
  const seg = j?.flowSegmentData;
  const cur = Number(seg?.currentSpeed), free = Number(seg?.freeFlowSpeed);
  if (!seg || !isFinite(cur) || !isFinite(free) || free <= 0) throw new Error('TomTom: bad segment');
  return { ratio: Math.max(0, Math.min(1, cur / free)), confidence: Number(seg.confidence) || 0, closure: seg.roadClosure === true, currentSpeed: cur, freeFlowSpeed: free };
}

/** Fetch live flow scores for all roads. Roads whose points all fail are
 *  absent from the returned Map (callers keep the pattern score for those). */
async function fetchFlowScores(key: string): Promise<Map<string, LiveRoadScore>> {
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
      scores.set(id, {
        score: 1, pct: 100, ratio: Math.min(...pts.map(p => p.ratio)), closure: true,
        confidence: closed.confidence, currentSpeed: closed.currentSpeed, freeFlowSpeed: closed.freeFlowSpeed,
      });
      continue;
    }
    // Ignore low-confidence points only when another point for this road qualifies.
    const qualified = pts.filter(p => p.confidence >= MIN_CONFIDENCE);
    const used = qualified.length ? qualified : pts;
    const worst = used.reduce((a, p) => (p.ratio < a.ratio ? p : a), used[0]);
    const score = Math.max(0, Math.min(1, 1 - worst.ratio));
    scores.set(id, {
      score, pct: Math.round(score * 100), ratio: worst.ratio, closure: false,
      confidence: worst.confidence, currentSpeed: worst.currentSpeed, freeFlowSpeed: worst.freeFlowSpeed,
    });
  }
  return scores;
}

/* ---------- incidents fetching (v5) ---------- */

const INCIDENT_FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},from,to,delay,roadNumbers}}}';

function incidentPoint(geometry: any): LatLng | undefined {
  try {
    const c = geometry?.coordinates;
    if (!Array.isArray(c)) return undefined;
    if (geometry?.type === 'Point' && typeof c[0] === 'number' && typeof c[1] === 'number') return [c[1], c[0]];
    if (geometry?.type === 'LineString' && Array.isArray(c[0])) {
      const mid = c[Math.floor(c.length / 2)];
      if (Array.isArray(mid) && typeof mid[0] === 'number' && typeof mid[1] === 'number') return [mid[1], mid[0]];
    }
  } catch { /* geometry is best-effort */ }
  return undefined;
}

function parseIncident(raw: any): LiveIncident | null {
  try {
    const props = raw?.properties ?? {};
    const events = Array.isArray(props.events) ? props.events : [];
    const cat = Number(props.iconCategory ?? events[0]?.iconCategory);
    const magnitude = Number(props.magnitudeOfDelay) || 0;
    const label = INCIDENT_CATEGORY_AR[cat] ?? (magnitude >= 2 ? 'ازدحام وتأخير' : 'تنبيه مروري');
    const from = typeof props.from === 'string' ? props.from.trim() : '';
    const to = typeof props.to === 'string' ? props.to.trim() : '';
    const roads = Array.isArray(props.roadNumbers) ? props.roadNumbers.filter((x: any) => typeof x === 'string' && x.trim()) : [];
    const desc = events.map((e: any) => (typeof e?.description === 'string' ? e.description.trim() : '')).find((d: string) => d.length > 2) || '';
    // Drop entries with no usable signal at all (malformed payload items) —
    // a real TomTom incident always carries a category, an event, or a place.
    if (!Number.isFinite(cat) && !desc && !from && !to && !roads.length && magnitude <= 0) return null;
    let text = '';
    if (from && to) text = `من ${from} إلى ${to}`;
    else if (from || to) text = from || to;
    else if (roads.length) text = roads.join('، ');
    if (desc && desc !== text && !text.includes(desc)) text = text ? `${text} — ${desc}` : desc;
    if (!text) text = 'داخل المدينة المنورة';
    const delaySec = Number(props.delay) || 0;
    return { label, text, delayMin: delaySec > 0 ? Math.max(1, Math.round(delaySec / 60)) : 0, magnitude, point: incidentPoint(raw?.geometry) };
  } catch { return null; }
}

async function fetchIncidentsOnce(key: string, language: string): Promise<LiveIncident[]> {
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(key)}&bbox=${MADINAH_BBOX}&fields=${encodeURIComponent(INCIDENT_FIELDS)}&language=${language}&timeValidityFilter=present`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TomTom incidents HTTP ${res.status}`);
  const j = await res.json();
  const list: any[] = Array.isArray(j?.incidents) ? j.incidents : [];
  return list.map(parseIncident).filter((x: LiveIncident | null): x is LiveIncident => x !== null)
    .sort((a, b) => b.magnitude - a.magnitude).slice(0, 20);
}

/** Incidents for the Madinah box, or null when the request failed (callers
 *  then show "incidents unavailable" rather than a false "none reported").
 *  Arabic descriptions are requested first; if that language is rejected we
 *  retry once in English — still one request in the normal case. */
async function fetchIncidents(key: string): Promise<LiveIncident[] | null> {
  try { return await fetchIncidentsOnce(key, 'ar-SA'); }
  catch {
    try { return await fetchIncidentsOnce(key, 'en-GB'); }
    catch { return null; }
  }
}

/** One full live cycle: flow scores for all roads + the incidents list. */
export async function fetchLiveScores(key: string): Promise<LiveData> {
  const [scores, incidents] = await Promise.all([fetchFlowScores(key), fetchIncidents(key)]);
  return { scores, incidents: incidents ?? [], incidentsKnown: incidents !== null, fetchedAt: Date.now() };
}

/* ---------- 10-minute localStorage cache + in-flight dedupe ---------- */

export function loadCachedLive(): LiveData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { fetchedAt: number; scores: [string, LiveRoadScore][]; incidents: LiveIncident[]; incidentsKnown: boolean };
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.scores)) return null;
    if (Date.now() - parsed.fetchedAt >= LIVE_REFRESH_MS) return null; // stale
    return {
      scores: new Map(parsed.scores),
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
      incidentsKnown: parsed.incidentsKnown === true,
      fetchedAt: parsed.fetchedAt,
    };
  } catch { return null; }
}

function saveCachedLive(data: LiveData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      fetchedAt: data.fetchedAt, scores: [...data.scores],
      incidents: data.incidents, incidentsKnown: data.incidentsKnown,
    }));
  } catch { /* storage full/blocked — ignore */ }
}

let inFlight: Promise<LiveData | null> | null = null;

/** Cache-aware entry point: fresh cache (<10 min) is reused with NO API call;
 *  otherwise one shared fetch runs (concurrent callers share the promise).
 *  Returns null only when BOTH flow and incidents failed, so the page can
 *  fall back to the pure pattern model with no "live" claims. */
export function getLiveScores(key: string): Promise<LiveData | null> {
  const cached = loadCachedLive();
  if (cached) return Promise.resolve(cached);
  if (inFlight) return inFlight;
  inFlight = fetchLiveScores(key)
    .then(data => { if (data.scores.size || data.incidentsKnown) { saveCachedLive(data); return data; } return null; })
    .catch(() => null)
    .finally(() => { inFlight = null; });
  return inFlight;
}
