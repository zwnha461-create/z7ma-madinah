import { useEffect, useMemo, useState, ReactNode } from 'react';
import { ROADS, ZONES, ZoneId, PLACES, placeBusy, riyadhNow, displayScore, roadScore, snapshot, statusOf, hourlyProfile, ScoreOverrides } from './lib/engine';
import { getLiveScores, LIVE_REFRESH_MS, LIVE_POINT_COUNT, LiveData } from './lib/live';
import TrafficMap from './components/TrafficMap';

type Page = 'home' | 'calendar' | 'share' | 'trends' | 'guide' | 'privacy' | 'methodology';
const mapsLink = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

/* ---------- helpers ---------- */
const toAr = (s: string | number) => String(s).replace(/[0-9]/g, d => '٠١٢٣٤٥٦٧٨٩'[Number(d)]);
function fmtClock(d: Date) { const h = d.getHours(); const ap = h < 12 ? 'ص' : 'م'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`; }
function fmtHour(h: number) { const ap = h < 12 ? 'ص' : 'م'; const h12 = h % 12 === 0 ? 12 : h % 12; return `${h12}${ap}`; }
function StatusWord({ s, withPct }: { s: number; withPct?: boolean }) {
  const st = statusOf(s);
  return <span className="statusWord" style={{ color: st.color }}><i className="dot" style={{ background: st.color }} />{st.label}{withPct ? ` ${Math.round(s * 100)}%` : ''}</span>;
}
function headline(pct: number): string {
  if (pct < 28) return 'الحركة سالكة، وقت ممتاز للطلعة 👍';
  if (pct < 52) return 'الحركة خفيفة، وقت مناسب 👍';
  if (pct < 68) return 'الحركة متوسطة، خلّ عندك وقت إضافي';
  if (pct < 85) return 'الحركة زحمة، أجّل طلعتك إن تقدر';
  return 'الحركة واقفة تقريباً، الأفضل تنتظر ⛔';
}
const zoneAvg = (zid: ZoneId, now: Date, overrides?: ScoreOverrides) => { const rs = ROADS.filter(r => r.zone === zid); return rs.length ? rs.reduce((a, r) => a + displayScore(r, now, overrides), 0) / rs.length : 0; };
/** "Usual" baseline date, mirroring engine.snapshot(): shift to a Monday-ish day. */
const usualDateOf = (date: Date) => { const d = new Date(date); d.setDate(d.getDate() - ((d.getDay() + 5) % 7)); return d; };
/** Pattern-only (no live overrides) average for a zone at a given date. */
const zonePatternAvg = (zid: ZoneId, date: Date) => { const rs = ROADS.filter(r => r.zone === zid); return rs.length ? rs.reduce((a, r) => a + roadScore(r, date), 0) / rs.length : 0; };
/** Zone delta vs its usual pattern level, as a signed relative %. */
const zoneDelta = (zid: ZoneId, now: Date, overrides?: ScoreOverrides) => {
  const pct = Math.round(zoneAvg(zid, now, overrides) * 100);
  const usual = Math.round(zonePatternAvg(zid, usualDateOf(now)) * 100);
  const delta = Math.round(((pct - usual) / Math.max(usual, 1)) * 100);
  return { pct, delta };
};
/** Riyadh wall-clock time of an epoch-ms instant (for the live "last updated" chip). */
const fmtEpochRiyadh = (ms: number) => fmtClock(new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })));

/* ---------- small stroke icons (original, monochrome) ---------- */
const ic = (children: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  gauge: ic(<><path d="M4 15a8 8 0 1 1 16 0" /><path d="M12 15l4.2-4.2" /><path d="M2.5 15h2M19.5 15h2M12 5.5v-2" /></>),
  mosque: ic(<><path d="M12 8c2.8 1.6 4.5 3.4 4.5 6.5V19h-9v-4.5C7.5 11.4 9.2 9.6 12 8z" /><path d="M12 8V5.5" /><circle cx="12" cy="4" r="1" /><path d="M4 21h16M4 19h3M17 19h3" /></>),
  flame: ic(<path d="M12 21.5c3.9 0 6.8-2.8 6.8-6.6 0-2.9-1.9-5-3.3-6.8C14.2 6.4 13.2 4.6 13.2 2.5c-2.9 1.9-4.4 4.4-4.6 6.7C7.5 8.1 6.8 6.7 6.8 4.9 5.4 6.6 5.2 8.9 5.2 14.9c0 3.8 2.9 6.6 6.8 6.6z" />),
  calendar: ic(<><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  pin: ic(<><path d="M12 21s-6.8-5.3-6.8-10.8a6.8 6.8 0 1 1 13.6 0C18.8 15.7 12 21 12 21z" /><circle cx="12" cy="10" r="2.5" /></>),
  chart: ic(<><path d="M4 20.5h16" /><path d="M6.5 20.5v-6M11 20.5v-11M15.5 20.5v-8M20 20.5V7" /></>),
  shield: ic(<path d="M12 3l7 2.8v6.1c0 4.4-2.9 7.4-7 9.1-4.1-1.7-7-4.7-7-9.1V5.8z" />),
};

/* ---------- weather (Open-Meteo, no key, 30-min localStorage cache) ---------- */
function weatherText(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'صافي', emoji: '☀️' };
  if (code === 1 || code === 2) return { label: 'غائم جزئياً', emoji: '🌤️' };
  if (code === 3) return { label: 'غائم', emoji: '☁️' };
  if (code === 45 || code === 48) return { label: 'ضباب', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'رذاذ خفيف', emoji: '🌦️' };
  if (code === 61 || code === 63 || code === 65 || code === 66 || code === 67) return { label: 'مطر', emoji: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'ثلج', emoji: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'زخات مطر', emoji: '🌦️' };
  if (code === 85 || code === 86) return { label: 'زخات ثلج', emoji: '🌨️' };
  if (code >= 95) return { label: 'عاصفة رعدية', emoji: '⛈️' };
  return { label: '—', emoji: '🌡️' };
}
const WEATHER_KEY = 'z7ma-weather-v1';
function WeatherChip() {
  const [w, setW] = useState<{ temp: number; code: number } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WEATHER_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && Date.now() - p.t < 30 * 60000 && isFinite(p.temp)) { setW({ temp: p.temp, code: p.code }); return; } }
    } catch { /* cache unavailable — fetch fresh */ }
    fetch('https://api.open-meteo.com/v1/forecast?latitude=24.4686&longitude=39.6142&current=temperature_2m,weather_code&timezone=Asia%2FRiyadh')
      .then(r => r.json())
      .then(j => {
        const temp = Math.round(Number(j?.current?.temperature_2m));
        const code = Number(j?.current?.weather_code);
        if (!isFinite(temp)) return;
        setW({ temp, code });
        try { localStorage.setItem(WEATHER_KEY, JSON.stringify({ t: Date.now(), temp, code })); } catch { /* ignore */ }
      })
      .catch(() => { /* hide gracefully on failure */ });
  }, []);
  if (!w) return null;
  const t = weatherText(w.code);
  return <span className="weatherChip"><b>{w.temp}°</b><span className="weatherSep">/</span><span>{t.label} {t.emoji}</span></span>;
}

/* ---------- gauge: 180° top semicircle ---------- */
function Gauge({ value }: { value: number }) {
  const cx = 160, cy = 168, r = 126;
  const ptAt = (angDeg: number, rad: number) => { const a = (angDeg * Math.PI) / 180; return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const; };
  const arcTo = (ang: number, rad: number) => { const [x, y] = ptAt(ang, rad); return `${x.toFixed(1)} ${y.toFixed(1)}`; };
  const frac = Math.max(0, Math.min(1, value / 10));
  const endAng = 180 - 180 * frac;
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const ang = 180 - 18 * i;
    const [x1, y1] = ptAt(ang, r + 9); const [x2, y2] = ptAt(ang, r + 17);
    return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={`gtick ${i / 10 <= frac ? 'on' : ''}`} />;
  });
  return (
    <svg className="gaugeSvg" viewBox="0 0 320 196" role="img" aria-label={`مؤشر الزحمة ${value} من 10`}>
      <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00C4D0" /><stop offset="100%" stopColor="#40CBCF" /></linearGradient></defs>
      <g>{ticks}</g>
      <path d={`M ${arcTo(180, r)} A ${r} ${r} 0 0 1 ${arcTo(0, r)}`} className="gaugeTrack" />
      {frac > 0.005 && <path d={`M ${arcTo(180, r)} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${arcTo(endAng, r)}`} stroke="url(#gg)" className="gaugeFill" />}
    </svg>
  );
}

/* ---------- home ---------- */
function Home({ go, live }: { go: (p: Page) => void; live: LiveData | null }) {
  const [zone, setZone] = useState<ZoneId>('central');
  const [tab, setTab] = useState<'zones' | 'streets'>('zones');
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 60000); return () => clearInterval(t); }, []);
  const now = riyadhNow();
  // Live TomTom scores override the pattern model per road wherever present.
  const overrides = useMemo<ScoreOverrides | undefined>(() => {
    if (!live || !live.scores.size) return undefined;
    const o: ScoreOverrides = {};
    live.scores.forEach((s, id) => { o[id] = s.score; });
    return o;
  }, [live]);
  const snap = useMemo(() => snapshot(now, overrides), [now.getHours(), now.getMinutes(), overrides]);
  const st = statusOf(snap.pct / 100);
  const scored = ROADS.map(r => ({ r, s: displayScore(r, now, overrides) })).sort((a, b) => b.s - a.s);
  const zoneRoads = ROADS.filter(r => r.zone === zone);
  // Map inputs: per road the worse of its two directions; per zone its average.
  const roadWorst: Record<string, number> = {};
  ROADS.forEach(r => { roadWorst[r.id] = Math.max(displayScore(r, now, overrides, 0), displayScore(r, now, overrides, 1)); });
  const zoneScores = {} as Record<ZoneId, number>;
  ZONES.forEach(z => { zoneScores[z.id] = zoneAvg(z.id, now, overrides); });
  const pickZone = (z: ZoneId) => { setZone(z); setTab('zones'); document.getElementById('zones-streets')?.scrollIntoView({ behavior: 'smooth' }); };
  // Gauge trend: displayed score now vs the pattern score 30 minutes ago.
  const pastPct = snapshot(new Date(now.getTime() - 30 * 60000)).pct;
  const trendDiff = snap.pct - pastPct;
  // Headline comparison chips vs the usual level.
  const usual = Math.max(snap.usualPct, 1);
  const extraTrip = Math.max(1, Math.round(30 * (snap.pct / usual) - 30));
  const relPct = Math.round(((snap.pct - snap.usualPct) / usual) * 100);
  const curZone = zoneDelta(zone, now, overrides);
  const busiest = zoneRoads.reduce((a, r) => (displayScore(r, now, overrides) > displayScore(a, now, overrides) ? r : a), zoneRoads[0]);
  const zoneArea: Record<ZoneId, string> = { north: 'north', east: 'east', central: 'central', west: 'west', south: 'south' };
  const explore: { page: Page; t: string; d: string; color: string; icon: ReactNode }[] = [
    { page: 'guide', t: 'دليل المركزية والحرم', d: 'أبواب الحرم، المواقف، قطار الحرمين، المطار والحافلات', color: '#3B82F6', icon: ICONS.mosque },
    { page: 'trends', t: 'الهبّات', d: 'أكثر أماكن المدينة انشغالاً الحين — تقديري', color: '#F97316', icon: ICONS.flame },
    { page: 'calendar', t: 'التقويم', d: 'مواقيت الصلاة في المدينة والتاريخ الهجري', color: '#A855F7', icon: ICONS.calendar },
    { page: 'share', t: 'اللوكيشن', d: 'شارك موقعك برابط خرائط جاهز', color: '#00C4D0', icon: ICONS.pin },
    { page: 'methodology', t: 'منهجية البيانات', d: 'كيف نقيس الزحمة ونحسب النسب — بشفافية', color: '#22C55E', icon: ICONS.chart },
    { page: 'privacy', t: 'الخصوصية', d: 'سياسة الخصوصية — باختصار: ما نجمع عنك شي', color: '#8A9A9E', icon: ICONS.shield },
  ];
  return (<>
    {/* 1) GAUGE BLOCK */}
    <section className="hero">
      <div className="gaugeTop">
        <span className="statusChip" style={{ borderColor: st.color, background: `${st.color}24`, color: st.color }}><i className="dot" style={{ background: st.color }} />{snap.label}</span>
        <span className="sinceText">منذ {live ? fmtEpochRiyadh(live.fetchedAt) : fmtClock(now)}</span>
      </div>
      {live && <div className="liveRow"><span className="chip liveChip"><i className="dot" style={{ background: '#22C55E' }} />بيانات حية · TomTom — آخر تحديث {fmtEpochRiyadh(live.fetchedAt)}</span></div>}
      <div className="gaugeWrap">
        <Gauge value={snap.overall} />
        <div className="gaugeCenter">
          <div className="gaugeNum">{snap.overall.toFixed(1)}<span className="gaugeOf">/10</span></div>
          <div className="gaugeStatus" style={{ color: st.color }}>{snap.label}</div>
          <div className="gaugeTrend">{trendDiff > 2 ? '↗ الزحمة في ارتفاع' : trendDiff < -2 ? '↘ الزحمة في انخفاض' : '➡ الزحمة مستقرة'}</div>
        </div>
      </div>
    </section>

    {/* 2) HEADLINE + COMPARISON CHIPS */}
    <section className="headlineBlock">
      <h2 className="heroHead">{headline(snap.pct)}</h2>
      <p className="heroSub">حركة المرور المباشرة</p>
      <div className="heroChips">
        <span className="chip">{snap.pct <= snap.usualPct ? '🚗 نفس وقت الرحلة المعتاد' : `🚗 +${extraTrip}د على رحلة 30 د`}</span>
        {Math.abs(relPct) >= 1 && (
          <span className={`chip ${relPct > 0 ? 'chipPink' : 'chipGood'}`}>{relPct > 0 ? `↑ ${relPct}% مقارنة بالمعتاد` : `↓ ${Math.abs(relPct)}% مقارنة بالمعتاد`}</span>
        )}
      </div>
    </section>

    {/* 3) MAP */}
    <section className="mapSection">
      <TrafficMap roadScores={roadWorst} zoneScores={zoneScores} onZonePick={pickZone} onTrends={() => go('trends')} />
      <p className="mapNote">{live
        ? 'طرق مرسومة على خريطة شوارع حقيقية، وألوان الطرق الرئيسية من سرعات مقاسة حياً عبر TomTom وتُحدّث كل ١٠ دقائق.'
        : 'طرق مرسومة على خريطة شوارع حقيقية، وألوانها تقديرية بنموذجنا — مو حركة حية مقاسة.'}</p>
    </section>

    {/* 4) INCIDENTS (live only) */}
    {live && (
      <section className="card">
        <h2 className="secTitle">تنبيهات وحوادث الآن</h2>
        <p className="secSub">مرصودة حياً عبر TomTom داخل المدينة المنورة — تُحدّث كل ١٠ دقائق</p>
        {live.incidents.length > 0 ? (
          <div className="incidentList">
            {live.incidents.slice(0, 6).map((inc, i) => (
              <div className="incidentRow" key={i}>
                <span className="incidentTag">{inc.label}</span>
                <span className="incidentText">{inc.text}{inc.delayMin > 0 ? ` · تأخير تقريبي ${inc.delayMin} د` : ''}</span>
              </div>))}
          </div>
        ) : (
          <p className="okLine">{live.incidentsKnown
            ? 'لا حوادث مُرصدة الآن على الشوارع الرئيسية'
            : 'بيانات الحوادث غير متاحة حالياً — سرعات الطرق محدّثة كالمعتاد'}</p>
        )}
      </section>
    )}

    {/* 5) CLEAR LINE + NEXT HOURS */}
    <div className="clearLine">{snap.clearLabel ? `تخف الزحمة الساعة ${snap.clearLabel} ◷` : 'تبقى الحركة على حالها الليلة'}</div>
    <h3 className="stripTitle">الساعات القادمة</h3>
    <div className="forecast">
      {snap.forecast.slice(0, 4).map((f, i) => { const fc = statusOf(f.pct / 100).color; return (
        <div key={i} className="fcItem">
          <b style={{ color: fc }}>{f.pct}%</b>
          <span className="fcBar"><i style={{ width: `${f.pct}%`, background: fc }} /></span>
          <small>{i === 0 ? 'الحين' : f.hourLabel}</small>
        </div>); })}
    </div>

    {/* 6) ZONES / STREETS */}
    <section className="tabsSection" id="zones-streets">
      <div className="pillTabs">
        <button className={tab === 'zones' ? 'on' : ''} onClick={() => setTab('zones')}>المناطق</button>
        <button className={tab === 'streets' ? 'on' : ''} onClick={() => setTab('streets')}>الشوارع</button>
      </div>
      {tab === 'zones' ? (<>
        <div className="compass">
          {ZONES.map(z => { const zd = zoneDelta(z.id, now, overrides); const zs = statusOf(zd.pct / 100); return (
            <button key={z.id} className={`zoneCard ${zone === z.id ? 'sel' : ''}`} style={{ gridArea: zoneArea[z.id] }} onClick={() => setZone(z.id)}>
              <span className="zoneName">{z.name}</span>
              <span className="zonePct" style={{ color: zs.color }}>{zd.pct}%</span>
              <span className="zoneDiv" />
              <span className="zoneDelta2" style={{ color: Math.abs(zd.delta) < 1 ? undefined : zd.delta > 0 ? '#F87171' : '#2DD4BF' }}>
                {Math.abs(zd.delta) < 1 ? 'نفس المعتاد' : zd.delta > 0 ? `↑ ${zd.delta}%` : `↓ ${Math.abs(zd.delta)}%`}
              </span>
              <i className="zoneFill" style={{ width: `${zd.pct}%`, background: zs.color }} />
            </button>); })}
        </div>
        <div className="zoneDetail">
          <div className="zdHead">
            <div>
              <div className="zdName">{ZONES.find(z => z.id === zone)?.name}</div>
              <div className="zdBusy">أزحم طريق: {busiest?.name}</div>
            </div>
            <span className="zdDelta" style={{ color: Math.abs(curZone.delta) < 1 ? undefined : curZone.delta > 0 ? '#F87171' : '#2DD4BF' }}>
              {Math.abs(curZone.delta) < 1 ? 'نفس المعتاد تقريبًا' : curZone.delta > 0 ? `أزحم من المعتاد بـ ${curZone.delta}%` : `أخف من المعتاد بـ ${Math.abs(curZone.delta)}%`}
            </span>
          </div>
          {zoneRoads.map(r => (
            <div key={r.id} className="dirGroup">
              <div className="dirRoadRow"><span>{r.name}</span><StatusWord s={displayScore(r, now, overrides)} /></div>
              {r.dirs.map((d, i) => { const ds = displayScore(r, now, overrides, i); const dst = statusOf(ds); return (
                <div className="dirRow" key={i}>
                  <span className="dirLabel">{d}</span>
                  <span className="dirBar"><i style={{ width: `${Math.round(ds * 100)}%`, background: dst.color }} /></span>
                  <span className="dirStatus" style={{ color: dst.color }}>{dst.label}</span>
                </div>); })}
            </div>))}
          <button className="btn ghost" onClick={() => setTab('streets')}>استكشف المزيد من الشوارع</button>
        </div>
      </>) : (<>
        <p className="tabsCaption">السرعة الحين مقارنة بسرعة الشارع وهو فاضي</p>
        <div className="streetCols">
          {scored.map(({ r, s }) => { const rs = statusOf(s); const ls = live?.scores.get(r.id); return (
            <div className="streetRow" key={r.id}>
              <div className="streetMain">
                <span className="streetName"><i className="dot" style={{ background: rs.color }} />{r.name}</span>
                {ls && <span className="streetSpeeds">السرعة الآن {Math.round(ls.currentSpeed)} كم/س من أصل {Math.round(ls.freeFlowSpeed)} كم/س{ls.closure ? ' · إغلاق مُرصد على أحد مقاطعه' : ''}</span>}
              </div>
              <span className="streetBar"><i style={{ width: `${20 + 80 * s}%`, background: rs.color }} /></span>
              <span className="streetStatus" style={{ color: rs.color }}>{rs.label}</span>
            </div>); })}
        </div>
      </>)}
    </section>

    {/* 7) PEAK HOURS */}
    <PeakHours snap={snap} />

    {/* 8) EXPLORE MORE */}
    <section className="explore">
      <h3 className="exploreTitle">استكشف المزيد</h3>
      <div className="exploreGrid">
        {explore.map(c => (
          <button key={c.page} className="exploreCard" onClick={() => go(c.page)}>
            <span className="exploreIcon" style={{ background: `${c.color}26`, color: c.color }}>{c.icon}</span>
            <span className="exploreText"><b>{c.t}</b><small>{c.d}</small></span>
          </button>
        ))}
      </div>
    </section>
  </>);
}

/* ---------- peak hours ---------- */
const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function PeakHours({ snap }: { snap: ReturnType<typeof snapshot> }) {
  const today = riyadhNow().getDay();
  const [dow, setDow] = useState(today);
  const profile = useMemo(() => hourlyProfile(dow), [dow]);
  const curHour = riyadhNow().getHours();
  const peakH = profile.indexOf(Math.max(...profile));
  const bestH = profile.indexOf(Math.min(...profile));
  const barColor = (p: number) => p >= 85 ? '#F97316' : p >= 70 ? '#F59E0B' : p >= 45 ? '#8A6D1F' : '#0F766E';
  const axisAt: Record<number, string> = { 0: '12ص', 4: '4ص', 8: '8ص', 12: '12م', 16: '4م', 20: '8م' };
  return (
    <section className="card peakCard">
      <h2 className="secTitle">ساعات الذروة</h2>
      <p className="secSub">متوسط الازدحام حسب الساعة</p>
      <div className="dayPills">{DAYS.map((d, i) => (<button key={d} className={dow === i ? 'on' : ''} onClick={() => setDow(i)}>{d}{i === today ? ' •' : ''}</button>))}</div>
      <p className="peakSummary">الذروة عند <b>{fmtHour(peakH)}</b> {profile[peakH]}% · أخف وقت بالنهار <b>{fmtHour(bestH)}</b> {profile[bestH]}%</p>
      <div className="chart">
        {dow === today && (<div className="liveLine" style={{ bottom: `${19 + snap.pct * 1.2}px` }}><span>مباشر {snap.pct}%</span></div>)}
        {profile.map((p, h) => (
          <div className="barCol" key={h} title={`${fmtHour(h)}: ${p}%`}>
            <span className="barTag" style={{ color: h === peakH ? '#F59E0B' : '#00C4D0' }}>{h === peakH ? 'ذروة' : dow === today && h === curHour ? 'الحين' : ''}</span>
            <div className="barTrack"><i style={{ height: `${p}%`, background: dow === today && h === curHour ? '#00C4D0' : barColor(p) }} /></div>
            <small>{axisAt[h] || ''}</small>
          </div>))}
      </div>
      <p className="diffLine" style={{ color: snap.diffPct >= 0 ? '#F87171' : '#2DD4BF' }}>اليوم {Math.abs(snap.diffPct)}% {snap.diffPct >= 0 ? 'أكثر ازدحامًا من المعتاد' : 'أخف من المعتاد'}</p>
    </section>
  );
}

/* ---------- calendar ---------- */
const FALLBACK = { Fajr: '05:10', Sunrise: '06:32', Dhuhr: '12:15', Asr: '15:38', Maghrib: '17:57', Isha: '19:27' };
const PRAYER_NAMES: Record<string, string> = { Fajr: 'الفجر', Sunrise: 'الشروق', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
const PRAYER_ICON: Record<string, string> = { Fajr: '☾', Sunrise: '☀', Dhuhr: '☀', Asr: '☀', Maghrib: '☾', Isha: '☾' };
function CalendarPage() {
  const [timings, setTimings] = useState<Record<string, string>>(FALLBACK);
  const [hijri, setHijri] = useState(''); const [live, setLive] = useState(false); const [, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    fetch('https://api.aladhan.com/v1/timingsByCity?city=Madinah&country=Saudi%20Arabia&method=4')
      .then(r => r.json()).then(j => { if (j?.data?.timings) { const t = j.data.timings; const clean: Record<string, string> = {}; Object.keys(FALLBACK).forEach(k => clean[k] = String(t[k]).slice(0, 5)); setTimings(clean); setLive(true); const h = j.data.date?.hijri; if (h) setHijri(`${h.day} ${h.month?.ar || h.month?.en} ${h.year}هـ`); } })
      .catch(() => {});
  }, []);
  const next = useMemo(() => {
    const cur = riyadhNow(); const mins = cur.getHours() * 60 + cur.getMinutes();
    for (const k of Object.keys(FALLBACK)) { const [hh, mm] = timings[k].split(':').map(Number); const m = hh * 60 + mm; if (m > mins) return { name: PRAYER_NAMES[k], inMin: m - mins }; }
    return { name: 'الفجر (غداً)', inMin: 0 };
  }, [timings]);
  return (<>
    <h2 className="pageTitle">التقويم</h2>
    <p className="pageSub">مواقيت الصلاة وفعاليات قادمة</p>
    <div className="prayerCard">
      <svg className="arch" viewBox="0 0 120 92"><path d="M14 88 L14 44 Q14 22 38 16 Q54 12 60 4 Q66 12 82 16 Q106 22 106 44 L106 88" fill="none" stroke="#C9A227" strokeWidth="2" /></svg>
      <div className="prayerHead">أوقات الصلاة</div>
      {hijri && <div className="hijri">{toAr(hijri)}</div>}
      <div className="prayerCity">المدينة المنورة</div>
      {next.inMin > 0 && <div className="nextChip">الصلاة القادمة: {next.name} بعد {Math.floor(next.inMin / 60)}:{String(next.inMin % 60).padStart(2, '0')}</div>}
      <div className="prayerRows">
        {Object.keys(FALLBACK).map(k => (<div className="prayerRow" key={k}><span className="prayerName"><i>{PRAYER_ICON[k]}</i>{PRAYER_NAMES[k]}</span><b className="prayerTime">{toAr(timings[k])}</b></div>))}
      </div>
      <p className="prayerNote">{live ? 'المواقيت مباشرة من خدمة الأذان (Aladhan) بطريقة أم القرى.' : 'تعذّر جلب المواقيت المباشرة — تُعرض مواقيت تقريبية احتياطية.'}</p>
    </div>
    <p className="noEvents">لا توجد فعاليات قادمة</p>
  </>);
}

/* ---------- share ---------- */
function SharePage() {
  const [link, setLink] = useState(''); const [err, setErr] = useState(''); const [copied, setCopied] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false); const [paste, setPaste] = useState('');
  const [door, setDoor] = useState(''); const [floor, setFloor] = useState(''); const [notesOpen, setNotesOpen] = useState(false); const [notes, setNotes] = useState('');
  const locate = () => { setErr(''); if (!navigator.geolocation) { setErr('جهازك لا يدعم تحديد الموقع.'); return; } navigator.geolocation.getCurrentPosition(p => setLink(`https://www.google.com/maps?q=${p.coords.latitude},${p.coords.longitude}`), () => setErr('ما قدرنا نحدد موقعك — فعّل إذن الموقع وحاول ثانية.')); };
  const applyPaste = () => { const v = paste.trim(); if (/^https?:\/\//.test(v) && (v.includes('google') || v.includes('maps') || v.includes('goo.gl'))) { setLink(v); setErr(''); } else setErr('الصق رابط خرائط جوجل صحيح.'); };
  const lines = ['تعليمات الوصول لموقعي في المدينة المنورة:', link, door ? `رقم الباب / الشقة: ${door}` : '', floor ? `الدور: ${floor}` : '', notes ? `ملاحظات: ${notes}` : ''].filter(Boolean);
  const text = lines.join('\n');
  return (<>
    <h2 className="pageTitle">شارك اللوكيشن</h2>
    <p className="pageSub">حدّد موقعك وابعث تعليمات الوصول لأي أحد — توصله برابط خرائط جاهز للفتح.</p>
    <div className="card">
      <button className="btn" onClick={locate}>◎ حدد موقعي</button>
      {link && <p className="okLine">✓ تمت إضافة الموقع</p>}
      {err && <p className="errLine">{err}</p>}
      <button className="collapseRow" onClick={() => setPasteOpen(!pasteOpen)}><span>أو الصق رابط قوقل ماب</span><span>{pasteOpen ? '▴' : '▾'}</span></button>
      {pasteOpen && (<div className="collapseBody"><input type="text" placeholder="https://maps.app.goo.gl/…" value={paste} onChange={e => setPaste(e.target.value)} /><button className="btn ghost" onClick={applyPaste}>استخدم هذا الرابط</button></div>)}
    </div>
    <div className="card">
      <div className="halfRow">
        <label>رقم الباب / الشقة<input type="text" value={door} onChange={e => setDoor(e.target.value)} placeholder="مثال: 12" /></label>
        <label>الدور<input type="text" value={floor} onChange={e => setFloor(e.target.value)} placeholder="مثال: 3" /></label>
      </div>
      <button className="collapseRow" onClick={() => setNotesOpen(!notesOpen)}><span>ملاحظات إضافية</span><span>{notesOpen ? '▴' : '▾'}</span></button>
      {notesOpen && <div className="collapseBody"><input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="مثال: البوابة الخلفية، الباب الأزرق…" /></div>}
    </div>
    <a className={`btn whatsapp ${!link ? 'disabled' : ''}`} href={link ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined} target="_blank" rel="noreferrer">شارك التعليمات</a>
    <button className="btn ghost big" disabled={!link} onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); }}>{copied ? '✓ تم النسخ' : 'نسخ النص'}</button>
    {!link && <p className="needLoc">أضف الموقع أولاً</p>}
    <p className="mut center">ما يُحفظ أي موقع عندنا — المشاركة تتم من جهازك مباشرة.</p>
  </>);
}

/* ---------- trends ---------- */
const TREND_COLORS = ['#F97316', '#00C4D0', '#A855F7', '#22C55E', '#3B82F6', '#EAB308', '#EF4444', '#14B8A6', '#F472B6'];
function TrendsPage() {
  const now = riyadhNow();
  const items = PLACES.map(p => ({ p, b: placeBusy(p, now) })).sort((a, b) => b.b - a.b);
  return (<>
    <h2 className="pageTitle">الهبّات</h2>
    <p className="pageSub">أماكن المدينة وانشغالها الحين — تقدير مبني على أوقاتها المعتادة، مو عدّاد زوّار حي.</p>
    <div className="card">
      {items.map(({ p, b }, i) => { const st = statusOf(b); const c = TREND_COLORS[i % TREND_COLORS.length]; return (
        <div className="trendItem" key={p.name}>
          <div className="trendRow">
            <span className="trendIcon" style={{ background: `${c}26`, color: c }}>{ICONS.pin}</span>
            <span className="trendName">{p.name}<br /><small className="mut">{p.area}</small></span>
            <StatusWord s={b} withPct />
          </div>
          <div className="thinBar"><i style={{ width: `${Math.round(b * 100)}%`, background: st.color }} /></div>
        </div>); })}
    </div>
  </>);
}

/* ---------- guide ---------- */
const GUIDE = [
  { t: 'أبواب المسجد النبوي الرئيسية', d: 'باب السلام (الغرب)، باب الملك فهد (الشمال — الأكبر)، باب الملك عبدالعزيز (الشرق)، وأبواب عمر وعثمان وعلي. للروضة الشريفة: الحجز عبر تطبيق نسك والدخول من الأبواب المخصصة حسب الموعد.', q: 'المسجد النبوي المدينة المنورة' },
  { t: 'مواقف المركزية', d: 'مواقف مدفوعة تحت وحول المنطقة المركزية، الأقرب للحرم: مواقف المركزية الشمالية والجنوبية. تمتلئ حول المغرب والعشاء والجمعة — الوصول قبل الصلاة بوقت كافٍ أسهل.', q: 'مواقف المركزية المدينة المنورة' },
  { t: 'محطة قطار الحرمين — المدينة', d: 'على طريق الملك عبدالعزيز شرق المدينة، رحلات إلى جدة ومكة عبر محطة السليمانية. احجز عبر تطبيق/موقع قطار الحرمين SAR.', q: 'محطة قطار الحرمين المدينة المنورة' },
  { t: 'مطار الأمير محمد بن عبدالعزيز', d: 'شمال شرق المدينة على طريق المطار، حوالي ٢٠ دقيقة من المركزية في الأوقات العادية وتزيد مع الذروة.', q: 'مطار الأمير محمد بن عبدالعزيز الدولي' },
  { t: 'حافلات المدينة', d: 'شبكة حافلات تربط المركزية بالأحياء والمطار ومحطة القطار، والدفع عبر تطبيق «حافلات المدينة». خيار عملي وقت زحمة المركزية.', q: 'محطة حافلات المدينة المنورة' },
];
function GuidePage() {
  return (<>
    <h2 className="pageTitle">دليل المركزية</h2>
    <p className="pageSub">كل ما تحتاجه حول الحرم النبوي والمنطقة المركزية.</p>
    {GUIDE.map(g => (<div className="card" key={g.t}><h3 className="guideTitle">{g.t}</h3><p className="guideText">{g.d}</p><a className="btn ghost" href={mapsLink(g.q)} target="_blank" rel="noreferrer">افتح في الخرائط</a></div>))}
  </>);
}

/* ---------- methodology ---------- */
function MethodologyPage() {
  return (<>
    <h2 className="pageTitle">منهجية البيانات</h2>
    <p className="pageSub">كيف نقيس الزحمة ونحسب النسب — بشفافية كاملة، وبحدود واضحة لما نعرفه وما لا نعرفه.</p>
    <div className="card guideText">
      <h3 className="guideTitle">مصدر القياس</h3>
      <p>حالة «الآن» للطرق الرئيسية مبنية على خدمة TomTom Traffic Flow: سرعات مقاسة فعلياً من بيانات حركة حقيقية (بيانات مجسّات ومركبات متحركة على الطرق نفسها)، وليست تقديراً ولا محاكاة. تُطلب البيانات من متصفحك مباشرة من TomTom، فإذا تعذّر وصولها رجع الموقع لعرض التقدير وصرّح بذلك.</p>
      <h3 className="guideTitle">السرعة الحالية مقابل سرعة التدفق الحر</h3>
      <p>لكل مقطع طريق رقمان: «السرعة الحالية» وهي سرعة الحركة المقاسة الآن، و«سرعة التدفق الحر» وهي سرعة نفس المقطع وهو فاضٍ تماماً. نسبة ازدحام الطريق = ١ − (السرعة الحالية ÷ سرعة التدفق الحر). مثال: طريق سرعته الحرة 80 كم/س وتُقاس حركته الآن بـ 40 كم/س فنسبته 50%. هذه السرعات نفسها تظهر تحت اسم الطريق في قائمة الشوارع متى توفر القياس الحي.</p>
      <h3 className="guideTitle">نقاط القياس وأسوأ نقطة تحكم</h3>
      <p>لا نعتمد نقطة واحدة لكل طريق: كل طريق من الطرق الثلاثة عشر يُقاس من 2 إلى 4 نقاط موزعة على طوله ({LIVE_POINT_COUNT} نقطة قياس في المجموع)، وكلها نقاط فعلية على مسار الطريق كما يُرسم في الخريطة. تحكم النسبةَ أسوأ نقطة (أبطأ مقطع)، لأن عنق الزجاجة هو ما يوقفك فعلياً في رحلتك. وإذا رصدت أي نقطة إغلاقاً على الطريق عُدّ الطريق «واقف» مهما كانت بقية مقاطعه.</p>
      <h3 className="guideTitle">الثقة والتحديث</h3>
      <p>كل قراءة من TomTom تحمل درجة ثقة؛ القراءات منخفضة الثقة (أقل من ٠٫٤) تُتجاهل متى وجدت للطريق قراءة أوثق. تتجدد البيانات كل ١٠ دقائق وتُحفظ مؤقتاً بنفس المدة، فليس كل فتح للصفحة طلباً جديداً.</p>
      <h3 className="guideTitle">الحوادث والتنبيهات</h3>
      <p>قسم «تنبيهات وحوادث الآن» في الرئيسية يأتي من خدمة حوادث TomTom لنطاق المدينة المنورة كاملاً: حوادث، أعمال طرق، إغلاقات، مع التأخير الذي تُبلغ عنه الخدمة إن وجد. غياب أي تنبيه هناك يعني أن الخدمة لم ترصد شيئاً وقت آخر تحديث — ونصرّح إذا تعذّر جلبها بدل ادعاء خلوّ الطرق.</p>
      <h3 className="guideTitle">ما الذي يبقى تقديرياً؟</h3>
      <p>التوقعات للساعات القادمة ورسم «ساعات الذروة» مآلهما نموذج أنماط الحركة المعتادة في المدينة (ذروات الدوام والصلوات والحرم ونهاية الأسبوع)، لأنهما بطبيعتهما تنبؤ بالمستقبل أو وصف للمعتاد — وهما منفصلان عن قياس «الآن» ومُعلّمان بذلك في مواضعهما. وقسم «الهبّات» تقديري كذلك ومصرّح به في صفحته.</p>
      <h3 className="guideTitle">حدود الصدق</h3>
      <p>نقاط القياس ليست حساسات على كل متر: حادث مفاجئ يقع بين نقطتين قد لا ينعكس على نسبة طريقه حتى دورة التحديث التالية (حتى ١٠ دقائق)، وإن كان قسم الحوادث قد يرصده قبلها. وإذا فشلت كل نقاط طريق ما في دورة ما، عاد ذلك الطريق مؤقتاً إلى درجته التقديرية حتى تنجح دورة لاحقة. السرعات المعروضة هي سرعات المقاطع المقاسة وقت آخر تحديث، وليست وعداً بزمن رحلة.</p>
    </div>
  </>);
}

/* ---------- privacy ---------- */
function PrivacyPage({ go }: { go: (p: Page) => void }) {
  return (<>
    <h2 className="pageTitle">سياسة الخصوصية</h2>
    <p className="pageSub">باختصار: ما نجمع عنك شي.</p>
    <div className="card guideText">
      <p>لا توجد حسابات ولا تسجيل دخول في هذا الموقع، ولا يُجمع أي بيان شخصي ولا يُرسل لأي خادم تابع لنا.</p>
      <p>عند تفعيل البيانات الحية، تُبنى نسب الطرق الرئيسية على سرعات مقاسة فعلياً عبر خدمة TomTom (سرعة الشارع الحالية مقارنة بسرعته وهو فاضٍ) وتُحدّث كل ١٠ دقائق، ويطلبها متصفحك من TomTom مباشرة. وعند غيابها تكون النسب تقديرات مبنية على أنماط الحركة المعتادة في المدينة المنورة. التوقعات القادمة ورسم «ساعات الذروة» تقديرية بالأنماط دائماً في الحالتين. ألوان الطرق مرسومة على خريطة شوارع حقيقية من OpenStreetMap.</p>
      <p>عند استخدام «حدد موقعي» في صفحة اللوكيشن، يبقى موقعك في جهازك ولا يُستخدم إلا داخل نص المشاركة الذي ترسله أنت بنفسك.</p>
      <p>مواقيت الصلاة تُجلب من خدمة Aladhan العامة. هذه نسخة مدينة مقترحة لأهل المدينة وزوّارها.</p>
      <button className="btn ghost" onClick={() => go('methodology')}>اقرأ منهجية البيانات كاملة</button>
    </div>
  </>);
}

/* ---------- app shell ---------- */
export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [light, setLight] = useState(false);
  const [live, setLive] = useState<LiveData | null>(null);
  const [cityOpen, setCityOpen] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; }, [light]);
  // Live TomTom data (only when a key is configured): cache-aware load on
  // mount, then refresh at most every 10 minutes while the page stays open.
  useEffect(() => {
    const key = import.meta.env.VITE_TOMTOM_KEY as string | undefined;
    if (!key) return;
    let alive = true;
    const load = () => { getLiveScores(key).then(d => { if (alive && d) setLive(d); }).catch(() => {}); };
    load();
    const t = setInterval(load, LIVE_REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const tabs: { id: Page; label: string; icon: ReactNode }[] = [
    { id: 'home', label: 'الزحمة', icon: ICONS.gauge }, { id: 'guide', label: 'دليل المركزية', icon: ICONS.mosque }, { id: 'trends', label: 'الهبّات', icon: ICONS.flame },
    { id: 'calendar', label: 'التقويم', icon: ICONS.calendar }, { id: 'share', label: 'اللوكيشن', icon: ICONS.pin },
  ];
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0 }); };
  return (<>
    <header className="topbar">
      <div className="topInner">
        <div className="brand">
          <svg className="logoIcon" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#1E2A2E" strokeWidth="4" /><path d="M 9 27 A 15 15 0 1 1 31 27" fill="none" stroke="#00C4D0" strokeWidth="4" strokeLinecap="round" /><circle cx="20" cy="20" r="2.6" fill="#fff" /><line x1="20" y1="20" x2="26" y2="13" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
          <span className="logoText">زحمة</span>
          <div className="cityWrap">
            <button className="cityPill" onClick={() => setCityOpen(o => !o)}>المدينة المنورة <span className="chev">⌄</span></button>
            {cityOpen && (
              <div className="cityMenu">
                <button className="cityItem" onClick={() => { setCityOpen(false); go('home'); }}>المدينة المنورة <span className="cityCheck">✓</span></button>
                <a className="cityItem" href="https://z7ma.com" target="_blank" rel="noreferrer">الرياض <span className="cityExt">↗</span></a>
                <a className="cityItem" href="https://z7ma.com" target="_blank" rel="noreferrer">جدة <span className="cityExt">↗</span></a>
              </div>
            )}
          </div>
        </div>
        <div className="topActions">
          <WeatherChip />
          <button className="iconBtn" onClick={() => setLight(!light)} aria-label="تبديل المظهر">{light ? '☀️' : '🌙'}</button>
        </div>
      </div>
    </header>
    <nav className="navBar">
      <div className="pillNav">{tabs.map(t => (<button key={t.id} className={page === t.id ? 'on' : ''} onClick={() => go(t.id)}>{t.icon}{t.label}</button>))}</div>
    </nav>
    <div className="wrap">
      {page === 'home' && <Home go={go} live={live} />}
      {page === 'calendar' && <CalendarPage />}
      {page === 'share' && <SharePage />}
      {page === 'trends' && <TrendsPage />}
      {page === 'guide' && <GuidePage />}
      {page === 'privacy' && <PrivacyPage go={go} />}
      {page === 'methodology' && <MethodologyPage />}
      <footer className="footer">
        <span className="footLinks">
          <button className="footLink" onClick={() => go('privacy')}>سياسة الخصوصية</button>
          <button className="footLink" onClick={() => go('methodology')}>منهجية البيانات</button>
        </span>
        <span>نسخة المدينة المنورة — مقترح مستقل</span>
      </footer>
      <p className="footNote">{live
        ? 'سرعات الطرق الرئيسية مقاسة حياً عبر TomTom وتُحدّث كل ١٠ دقائق — التوقعات وساعات الذروة تبقى تقديرية بأنماط الحركة المعتادة · بدون حساب وبدون جمع أي بيانات شخصية'
        : 'مؤشر تقديري مبني على أنماط الحركة المعتادة في المدينة — ألوان طرق الخريطة من نفس النموذج · بدون حساب وبدون جمع أي بيانات شخصية'}</p>
    </div>
  </>);
}
