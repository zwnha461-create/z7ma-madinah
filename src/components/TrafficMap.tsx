import { useEffect, useRef, useState } from 'react';
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
  /** «الهبّات 🔥» overlay pill — navigate to the trends page. */
  onTrends: () => void;
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
 * Dark interactive traffic map (Leaflet + Esri World Dark Gray Canvas,
 * darkened further by CSS filter; street labels render in a pane above the
 * road lines, like the original). CARTO tiles were dropped 2026-11-11 —
 * they began demanding an API key on the published site.
 * Road lines use real OpenStreetMap geometries (baked in src/lib/roadsGeo.ts).
 * Their COLORS come straight from the roadScores prop — the same snapshot
 * values as the streets list — so when live TomTom overrides are active in
 * App, the map recolors to measured speeds automatically (update effect).
 */
export default function TrafficMap({ roadScores, zoneScores, onZonePick, onTrends }: Props) {
  const [glowOn, setGlowOn] = useState(true);
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
    // Street labels sit in their own pane ABOVE the road polylines
    // (overlay pane = 400) but below the zone pill markers (marker pane = 600),
    // so names stay readable over our colored roads like on the original site.
    map.createPane('labels');
    const labelsPane = map.getPane('labels');
    if (labelsPane) {
      labelsPane.style.zIndex = '450';
      labelsPane.style.pointerEvents = 'none';
    }
    // Esri World Dark Gray Canvas — free, no API key. The base is darkened
    // toward near-black via the .esri-dark CSS filter in styles.css.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri © OpenStreetMap contributors',
      maxNativeZoom: 16,
      maxZoom: 19,
      className: 'esri-dark',
    }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16,
      maxZoom: 19,
      pane: 'labels',
      className: 'esri-labels',
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

  // «اتجاهات الزحمة» pill toggles the roads' glow underlay on/off.
  useEffect(() => {
    for (const pairs of Object.values(roadLayers.current)) {
      for (const { glow } of pairs) glow.setStyle({ opacity: glowOn ? 0.25 : 0 });
    }
  }, [glowOn]);

  const flyHaram = () => { mapRef.current?.flyTo([24.4672, 39.6111], 14, { duration: 0.8 }); };

  return (
    <div className="mapBox leafletBox">
      <div ref={boxRef} className="leafletMap" dir="ltr" />
      <div className="legend"><span>واقف</span><div className="legendBar" /><span>سالك</span></div>
      <div className="mapOverlayBottom" dir="ltr">
        <button className={`mapBtn ${glowOn ? 'on' : ''}`} onClick={() => setGlowOn(g => !g)}>اتجاهات الزحمة ⚠</button>
        <span className="mapBtnGroup">
          <button className="mapBtn" onClick={flyHaram}>الحرم 🕌</button>
          <button className="mapBtn" onClick={onTrends}>الهبّات 🔥</button>
        </span>
      </div>
    </div>
  );
}
