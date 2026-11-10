import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ROADS, ZONES, ZoneId, statusOf } from '../lib/engine';
import { ROAD_GEO } from '../lib/roadsGeo';

interface Props {
  /** Worse-direction congestion score (0..1) per road id — same values as the streets list. */
  roadScores: Record<string, number>;
  /** Average congestion score (0..1) per zone id — same values as the zone cards. */
  zoneScores: Record<ZoneId, number>;
  onZonePick: (z: ZoneId) => void;
}

const ZONE_POS: Record<ZoneId, [number, number]> = {
  central: [24.4672, 39.6111],
  north: [24.53, 39.6],
  south: [24.4, 39.62],
  east: [24.47, 39.68],
  west: [24.47, 39.54],
};

const tipText = (roadId: string, score: number) => {
  const r = ROADS.find(x => x.id === roadId);
  const st = statusOf(score);
  return `${r?.name ?? roadId} — ${st.label} ${Math.round(score * 100)}%`;
};

const pillIcon = (name: string, score: number) => {
  const st = statusOf(score);
  return L.divIcon({
    className: 'zoneMarkerIcon',
    html: `<div class="zonePill" style="border-color:${st.color}">${name} <b>${Math.round(score * 100)}%</b></div>`,
  });
};

/**
 * Dark interactive traffic map (Leaflet + CARTO dark tiles).
 * Road lines use real OpenStreetMap geometries (baked in src/lib/roadsGeo.ts).
 * Their COLORS come straight from the roadScores prop — the same snapshot
 * values as the streets list — so when live TomTom overrides are active in
 * App, the map recolors to measured speeds automatically (update effect).
 */
export default function TrafficMap({ roadScores, zoneScores, onZonePick }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const roadLayers = useRef<Record<string, { glow: L.Polyline; main: L.Polyline }[]>>({});
  const markers = useRef<Partial<Record<ZoneId, L.Marker>>>({});
  const pickRef = useRef(onZonePick);
  pickRef.current = onZonePick;
  // Latest scores, read by the init effect to paint initial colors.
  const scoresRef = useRef({ roadScores, zoneScores });
  scoresRef.current = { roadScores, zoneScores };

  useEffect(() => {
    if (!boxRef.current || mapRef.current) return;
    const map = L.map(boxRef.current, {
      center: [24.4672, 39.6111],
      zoom: 12,
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
    });
    map.attributionControl.setPrefix(false);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    const { roadScores: rs, zoneScores: zs } = scoresRef.current;
    // Roads: glow + main line per baked polyline
    for (const road of ROADS) {
      const lines = ROAD_GEO[road.id];
      if (!lines) continue;
      const color = statusOf(rs[road.id] ?? 0).color;
      roadLayers.current[road.id] = lines.map(coords => {
        const glow = L.polyline(coords, { color, weight: 10, opacity: 0.25, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        const main = L.polyline(coords, { color, weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        main.bindTooltip(tipText(road.id, rs[road.id] ?? 0), { sticky: true, className: 'trafficTip', direction: 'top' });
        return { glow, main };
      });
    }
    // Zone pill markers
    for (const z of ZONES) {
      const m = L.marker(ZONE_POS[z.id], { icon: pillIcon(z.name, zs[z.id] ?? 0) }).addTo(map);
      m.on('click', () => pickRef.current(z.id));
      markers.current[z.id] = m;
    }
    return () => {
      map.remove();
      mapRef.current = null;
      roadLayers.current = {};
      markers.current = {};
    };
    // init once — later score changes are handled by the update effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recolor lines + refresh tooltips/markers whenever the snapshot refreshes.
  useEffect(() => {
    if (!mapRef.current) return;
    for (const [id, pairs] of Object.entries(roadLayers.current)) {
      const s = roadScores[id];
      if (s == null) continue;
      const color = statusOf(s).color;
      for (const { glow, main } of pairs) {
        glow.setStyle({ color });
        main.setStyle({ color });
        main.setTooltipContent(tipText(id, s));
      }
    }
    for (const z of ZONES) {
      const m = markers.current[z.id];
      const s = zoneScores[z.id];
      if (m && s != null) m.setIcon(pillIcon(z.name, s));
    }
  }, [roadScores, zoneScores]);

  return (
    <div className="mapBox leafletBox">
      <div ref={boxRef} className="leafletMap" dir="ltr" />
      <div className="legend"><span>واقف</span><div className="legendBar" /><span>سالك</span></div>
      <span className="mapChip">⚠ اتجاهات الزحمة</span>
    </div>
  );
}
