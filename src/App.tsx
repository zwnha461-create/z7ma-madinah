import { useEffect, useMemo, useState } from 'react';
import { ROADS, ZONES, ZoneId, PLACES, placeBusy, riyadhNow, roadScore, snapshot, statusOf, hourlyProfile } from './lib/engine';

type Page = 'home' | 'calendar' | 'share' | 'trends' | 'guide' | 'privacy';
const MAP_EMBED = 'https://www.google.com/maps?q=24.4672,39.6111&z=12&layer=t&output=embed';
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
const zoneAvg = (zid: ZoneId, now: Date) => { const rs = ROADS.filter(r => r.zone === zid); return rs.length ? rs.reduce((a, r) => a + roadScore(r, now), 0) / rs.length : 0; };

/* ---------- gauge ---------- */
function Gauge({ value, color }: { value: number; color: string }) {
  const cx = 160, cy = 160, r = 122, start = 150, sweep = 240;
  const pt = (deg: number, rad: number) => { const a = (deg * Math.PI) / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)] as const; };
  const arc = (from: number, to: number, rad: number) => { const [x1, y1] = pt(from, rad); const [x2, y2] = pt(to, rad); return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rad} ${rad} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`; };
  const frac = Math.max(0, Math.min(1, value / 10));
  const ticks = Array.from({ length: 41 }, (_, i) => { const a = start + (sweep * i) / 40; const [x1, y1] = pt(a, r + 10); const [x2, y2] = pt(a, r + 17); return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />; });
  return (
    <svg className="gaugeSvg" viewBox="0 0 320 300" role="img" aria-label={`مؤشر الزحمة ${value} من 10`}>
      <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00BFD4" /><stop offset="100%" stopColor={color} /></linearGradient></defs>
      <g className="ticks">{ticks}</g>
      <path d={arc(start, start + sweep, r)} className="gaugeTrack" />
      {frac > 0.01 && <path d={arc(start, start + sweep * frac, r)} stroke="url(#gg)" className="gaugeFill" />}
    </svg>
  );
}

/* ---------- home ---------- */
function Home({ go }: { go: (p: Page) => void }) {
  const [zone, setZone] = useState<ZoneId>('central');
  const [tab, setTab] = useState<'zones' | 'streets'>('zones');
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force(x => x + 1), 60000); return () => clearInterval(t); }, []);
  const now = riyadhNow();
  const snap = useMemo(() => snapshot(now), [now.getHours(), now.getMinutes()]);
  const st = statusOf(snap.pct / 100);
  const scored = ROADS.map(r => ({ r, s: roadScore(r, now) })).sort((a, b) => b.s - a.s);
  const zoneRoads = ROADS.filter(r => r.zone === zone);
  const markerPos: Record<ZoneId, { left: string; top: string }> = {
    central: { left: '50%', top: '54%' }, north: { left: '52%', top: '16%' }, south: { left: '47%', top: '84%' },
    east: { left: '79%', top: '44%' }, west: { left: '20%', top: '44%' },
  };
  const pickZone = (z: ZoneId) => { setZone(z); setTab('zones'); document.getElementById('zones-streets')?.scrollIntoView({ behavior: 'smooth' }); };
  return (<>
    {/* HERO GAUGE */}
    <section className="hero">
      <div className="statusPill"><i className="dot" style={{ background: st.color }} />{snap.label}</div>
      <div className="sinceLine">منذ {fmtClock(now)} · المدينة المنورة</div>
      <div className="gaugeWrap">
        <Gauge value={snap.overall} color={st.color} />
        <div className="gaugeCenter">
          <div className="gaugeNum" style={{ color: st.color }}>{snap.overall.toFixed(1)}<span className="gaugeOf">/10</span></div>
          <div className="gaugeStatus" style={{ color: st.color }}>{snap.label}</div>
        </div>
      </div>
      <h2 className="heroHead">{headline(snap.pct)}</h2>
      <p className="heroSub">حركة المرور المباشرة</p>
      <div className="heroChips">
        <span className="chip">+{snap.extraMin}د على رحلة 30 د</span>
        <span className="chip">{snap.trend > 2 ? `▲ تزيد ${snap.trend}%` : snap.trend < -2 ? `▼ تنقص ${Math.abs(snap.trend)}%` : '— مستقرة'} عن الساعة الماضية</span>
      </div>
    </section>

    {/* MAP */}
    <section className="mapCard">
      <div className="mapBox">
        <iframe className="map" title="خريطة حركة المدينة المنورة الحية" src={MAP_EMBED} loading="lazy" />
        <div className="legend"><span>واقف</span><div className="legendBar" /><span>سالك</span></div>
        {ZONES.map(z => { const s = zoneAvg(z.id, now); const zs = statusOf(s); return (
          <button key={z.id} className="zoneMarker" style={{ ...markerPos[z.id], borderColor: zs.color }} onClick={() => pickZone(z.id)}>
            {z.name} <b>{Math.round(s * 100)}%</b>
          </button>); })}
      </div>
      <p className="mapNote">{snap.clearLabel ? `تخف الزحمة الساعة ${snap.clearLabel}` : 'تبقى الزحمة متوسطة الليلة'} · الخريطة تعرض الحركة الحية الفعلية من خرائط جوجل، والمؤشر أعلاه تقديري بأنماط الحركة المعتادة.</p>
      {/* FORECAST STRIP */}
      <div className="forecast">
        {snap.forecast.map((f, i) => (
          <div key={i} className={`fcItem ${i === 0 ? 'on' : ''}`}>
            <b style={{ color: statusOf(f.pct / 100).color }}>{f.pct}%</b>
            <small>{i === 0 ? 'الحين' : f.hourLabel}</small>
          </div>))}
      </div>
    </section>

    {/* ZONES / STREETS */}
    <section className="card" id="zones-streets">
      <div className="textTabs">
        <button className={tab === 'zones' ? 'on' : ''} onClick={() => setTab('zones')}>المناطق</button>
        <button className={tab === 'streets' ? 'on' : ''} onClick={() => setTab('streets')}>الشوارع</button>
      </div>
      {tab === 'zones' ? (<>
        <div className="zoneGrid">
          {ZONES.map(z => { const s = zoneAvg(z.id, now); const zs = statusOf(s); const delta = Math.round(s * 100) - snap.pct; return (
            <button key={z.id} className={`zoneCard ${zone === z.id ? 'sel' : ''}`} onClick={() => setZone(z.id)}>
              <span className="zoneDelta">{delta > 0 ? `+${delta}%` : delta < 0 ? `${delta}%` : '±0%'}</span>
              <span className="zoneName">{z.name}</span>
              <span className="zonePct">{Math.round(s * 100)}%</span>
              <span className="zoneStatus" style={{ color: zs.color }}>{zs.label}</span>
              <span className="zoneBar"><i style={{ width: `${Math.round(s * 100)}%`, background: zs.color }} /></span>
            </button>); })}
        </div>
        <div className="zoneDetail">
          <h3>{ZONES.find(z => z.id === zone)?.name} — {ZONES.find(z => z.id === zone)?.desc}</h3>
          {zoneRoads.map(r => (
            <div key={r.id} className="dirGroup">
              <div className="row"><span>{r.name}</span><StatusWord s={roadScore(r, now)} /></div>
              {r.dirs.map((d, i) => (<div className="row indent" key={i}><span className="mut">{d}</span><StatusWord s={roadScore(r, now, i)} /></div>))}
            </div>))}
          <button className="btn ghost" onClick={() => setTab('streets')}>استكشف المزيد من الشوارع</button>
        </div>
      </>) : (<>
        <p className="explainer">النسبة هي ازدحام الشارع الحين مقارنة بنفسه وهو فاضي تماماً — كل ما زادت، زاد الوقت اللي بيضيع عليك فيه.</p>
        <div className="streetList">
          {scored.map(({ r, s }) => { const rs = statusOf(s); return (
            <div className="streetRow" key={r.id}>
              <i className="dot" style={{ background: rs.color }} />
              <span className="streetName">{r.name}</span>
              <span className="streetBar"><i style={{ width: `${Math.round(s * 100)}%`, background: rs.color }} /></span>
              <span className="streetStatus" style={{ color: rs.color }}>{rs.label}</span>
            </div>); })}
        </div>
      </>)}
    </section>

    <PeakHours snap={snap} />

    {/* CROSS LINKS */}
    <section className="crossGrid">
      <button className="crossCard" onClick={() => go('guide')}><b>🕌 دليل المركزية</b><span>أبواب الحرم، المواقف، قطار الحرمين، المطار والحافلات</span><em>←</em></button>
      <button className="crossCard" onClick={() => go('trends')}><b>🔥 الهبّات</b><span>أكثر أماكن المدينة انشغالاً الحين — تقديري</span><em>←</em></button>
      <button className="crossCard" onClick={() => go('calendar')}><b>🗓️ التقويم</b><span>مواقيت الصلاة في المدينة والتاريخ الهجري</span><em>←</em></button>
      <button className="crossCard" onClick={() => go('share')}><b>📍 اللوكيشن</b><span>شارك موقعك برابط خرائط جاهز</span><em>←</em></button>
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
  const barColor = (p: number) => p >= 70 ? '#F59E0B' : p >= 45 ? '#92400E' : '#0F766E';
  const axisAt: Record<number, string> = { 0: '12ص', 4: '4ص', 8: '8ص', 12: '12م', 16: '4م', 20: '8م' };
  return (
    <section className="card">
      <h2 className="secTitle">ساعات الذروة</h2>
      <p className="secSub">متوسط الازدحام حسب الساعة</p>
      <div className="dayPills">{DAYS.map((d, i) => (<button key={d} className={dow === i ? 'on' : ''} onClick={() => setDow(i)}>{d}{i === today ? ' •' : ''}</button>))}</div>
      <p className="peakSummary">الذروة: <b>{fmtHour(peakH)}</b> ({profile[peakH]}%) · أفضل وقت: <b>{fmtHour(bestH)}</b> ({profile[bestH]}%)</p>
      <p className="diffLine">اليوم {Math.abs(snap.diffPct)}% {snap.diffPct >= 0 ? 'أكثر' : 'أقل'} ازدحامًا من المعتاد</p>
      <div className="chart">
        {dow === today && (<div className="liveLine" style={{ bottom: `${19 + snap.pct * 1.3}px` }}><span>مباشر {snap.pct}%</span></div>)}
        {profile.map((p, h) => (
          <div className="barCol" key={h}>
            <div className="barTrack"><i style={{ height: `${p}%`, background: dow === today && h === curHour ? '#00C2D8' : barColor(p) }} /></div>
            <small>{axisAt[h] || ''}</small>
          </div>))}
      </div>
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
function TrendsPage() {
  const now = riyadhNow();
  const items = PLACES.map(p => ({ p, b: placeBusy(p, now) })).sort((a, b) => b.b - a.b);
  return (<>
    <h2 className="pageTitle">الهبّات</h2>
    <p className="pageSub">أماكن المدينة وانشغالها الحين — تقدير مبني على أوقاتها المعتادة، مو عدّاد زوّار حي.</p>
    <div className="card">
      {items.map(({ p, b }) => { const st = statusOf(b); return (
        <div className="trendItem" key={p.name}>
          <div className="row"><span>{p.name}<br /><small className="mut">{p.area}</small></span><StatusWord s={b} withPct /></div>
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

/* ---------- privacy ---------- */
function PrivacyPage() {
  return (<>
    <h2 className="pageTitle">سياسة الخصوصية</h2>
    <p className="pageSub">باختصار: ما نجمع عنك شي.</p>
    <div className="card guideText">
      <p>لا توجد حسابات ولا تسجيل دخول في هذا الموقع، ولا يُجمع أي بيان شخصي ولا يُرسل لأي خادم تابع لنا.</p>
      <p>مؤشر الزحمة والنسب المعروضة تقديرات مبنية على أنماط الحركة المعتادة في المدينة المنورة، وليست قياسات حية من حساسات طرق؛ الخريطة وحدها تعرض حركة حية من خرائط جوجل وفق سياستها.</p>
      <p>عند استخدام «حدد موقعي» في صفحة اللوكيشن، يبقى موقعك في جهازك ولا يُستخدم إلا داخل نص المشاركة الذي ترسله أنت بنفسك.</p>
      <p>مواقيت الصلاة تُجلب من خدمة Aladhan العامة. هذه نسخة مدينة مقترحة لأهل المدينة وزوّارها.</p>
    </div>
  </>);
}

/* ---------- app shell ---------- */
export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [light, setLight] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; }, [light]);
  const tabs: { id: Page; label: string }[] = [
    { id: 'home', label: 'الزحمة' }, { id: 'guide', label: 'دليل المركزية' }, { id: 'trends', label: 'الهبّات' },
    { id: 'calendar', label: 'التقويم' }, { id: 'share', label: 'اللوكيشن' },
  ];
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0 }); };
  return (<>
    <header className="topbar">
      <div className="topInner">
        <div className="brand">
          <svg className="logoIcon" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#1F2A28" strokeWidth="4" /><path d="M 9 27 A 15 15 0 1 1 31 27" fill="none" stroke="#00C2D8" strokeWidth="4" strokeLinecap="round" /><circle cx="20" cy="20" r="2.6" fill="#fff" /><line x1="20" y1="20" x2="26" y2="13" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
          <span className="logoText">زحمة</span>
          <button className="cityPill" onClick={() => go('home')}>المدينة المنورة <span className="chev">⌄</span></button>
        </div>
        <div className="topActions">
          <span className="enBtn" title="English — قريباً">EN</span>
          <button className="iconBtn" onClick={() => setLight(!light)} aria-label="تبديل المظهر">{light ? '☀' : '☾'}</button>
        </div>
      </div>
    </header>
    <div className="wrap">
      <nav className="pillNav">{tabs.map(t => (<button key={t.id} className={page === t.id ? 'on' : ''} onClick={() => go(t.id)}>{t.label}</button>))}</nav>
      {page === 'home' && <Home go={go} />}
      {page === 'calendar' && <CalendarPage />}
      {page === 'share' && <SharePage />}
      {page === 'trends' && <TrendsPage />}
      {page === 'guide' && <GuidePage />}
      {page === 'privacy' && <PrivacyPage />}
      <footer className="footer">
        <span>نسخة المدينة المنورة — مقترح</span>
        <button className="footLink" onClick={() => go('privacy')}>سياسة الخصوصية</button>
      </footer>
      <p className="footNote">مؤشر تقديري مبني على أنماط الحركة المعتادة في المدينة — الخريطة تعرض الحركة الحية الفعلية · بدون حساب وبدون جمع أي بيانات شخصية</p>
    </div>
  </>);
}
