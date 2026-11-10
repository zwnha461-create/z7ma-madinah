// Deterministic time-pattern congestion model for Madinah.
// Honest estimation model: NOT live sensor data. Based on usual daily patterns:
// morning peak, prayer/Haram peaks, evening peak, Thursday evening, Friday noon.

export type StatusKey = 'empty' | 'light' | 'medium' | 'busy' | 'stuck';
export interface Road { id: string; name: string; zone: ZoneId; base: number; haram: number; dirs: [string, string]; }
export type ZoneId = 'central' | 'north' | 'south' | 'east' | 'west';
export const ZONES: { id: ZoneId; name: string; desc: string }[] = [
  { id: 'central', name: 'المركزية', desc: 'حول الحرم النبوي' },
  { id: 'north', name: 'الشمال', desc: 'أحد • العيون • المطار' },
  { id: 'south', name: 'الجنوب', desc: 'قباء • العوالي • الهجرة' },
  { id: 'east', name: 'الشرق', desc: 'الملك فهد • الجامعة' },
  { id: 'west', name: 'الغرب', desc: 'السلام • الجامعات' },
];

export const ROADS: Road[] = [
  { id: 'kfaisal', name: 'طريق الملك فيصل — الدائري الأول', zone: 'central', base: 0.52, haram: 1, dirs: ['باتجاه الحرم', 'خارج المركزية'] },
  { id: 'salam', name: 'طريق السلام', zone: 'central', base: 0.48, haram: 0.9, dirs: ['باتجاه الحرم', 'باتجاه الجامعات'] },
  { id: 'quba', name: 'طريق قباء', zone: 'central', base: 0.5, haram: 0.95, dirs: ['باتجاه الحرم', 'باتجاه قباء'] },
  { id: 'kabdullah', name: 'طريق الملك عبدالله — الدائري الثاني', zone: 'east', base: 0.55, haram: 0.35, dirs: ['شمالاً', 'جنوباً'] },
  { id: 'kkhalid', name: 'طريق الملك خالد — الدائري الثالث', zone: 'south', base: 0.35, haram: 0.15, dirs: ['شرقاً', 'غرباً'] },
  { id: 'kfahd', name: 'طريق الملك فهد', zone: 'east', base: 0.5, haram: 0.3, dirs: ['باتجاه المطار', 'باتجاه المركز'] },
  { id: 'kabdulaziz', name: 'طريق الملك عبدالعزيز', zone: 'north', base: 0.46, haram: 0.4, dirs: ['شرقاً', 'غرباً'] },
  { id: 'abubakr', name: 'طريق أبي بكر الصديق — سلطانة', zone: 'west', base: 0.44, haram: 0.5, dirs: ['باتجاه الحرم', 'باتجاه القصواء'] },
  { id: 'airport', name: 'طريق المطار', zone: 'north', base: 0.42, haram: 0.2, dirs: ['باتجاه المطار', 'باتجاه المدينة'] },
  { id: 'hijra', name: 'طريق الهجرة', zone: 'south', base: 0.4, haram: 0.45, dirs: ['باتجاه الحرم', 'باتجاه مكة'] },
  { id: 'uhud', name: 'طريق أحد', zone: 'north', base: 0.38, haram: 0.35, dirs: ['باتجاه أحد', 'باتجاه الحرم'] },
  { id: 'universities', name: 'طريق الجامعات', zone: 'west', base: 0.36, haram: 0.1, dirs: ['شرقاً', 'غرباً'] },
  { id: 'awali', name: 'طريق العوالي', zone: 'south', base: 0.34, haram: 0.3, dirs: ['باتجاه العوالي', 'باتجاه الحرم'] },
];

export function riyadhNow(): Date {
  // Convert to Asia/Riyadh wall time via Intl, then work with its parts
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });
  return new Date(s);
}
function gauss(x: number, mu: number, sigma: number) { const d = (x - mu) / sigma; return Math.exp(-0.5 * d * d); }

// Congestion factor 0..1 for a given decimal hour on a given weekday (0=Sun..6=Sat, JS on Riyadh date)
export function patternFactor(hour: number, dow: number, haramWeight: number): number {
  let f = 0.12; // late-night / base floor
  f += 0.42 * gauss(hour, 7.5, 0.9);            // morning peak 6:30-8:30
  f += 0.30 * gauss(hour, 13.0, 1.1);           // midday / schools-offices out
  f += 0.62 * gauss(hour, 17.75, 1.35) ;        // evening peak 16:00-19:30
  // Prayer / Haram peaks (stronger for Haram-weighted roads)
  f += haramWeight * (0.38 * gauss(hour, 18.6, 0.55) + 0.34 * gauss(hour, 19.9, 0.6) + 0.22 * gauss(hour, 5.2, 0.5));
  if (dow === 5) f += haramWeight * 0.55 * gauss(hour, 12.2, 0.8) + 0.15 * gauss(hour, 12.2, 1.2); // Friday noon
  if (dow === 4) f += 0.22 * gauss(hour, 20.5, 1.6); // Thursday evening
  if (dow === 5 || dow === 6) f -= 0.18 * gauss(hour, 7.5, 0.9); // weekend morning calmer
  return Math.max(0.03, Math.min(0.98, f));
}

export function roadScore(road: Road, date: Date, dirIdx = 0): number {
  const h = date.getHours() + date.getMinutes() / 60;
  const dow = date.getDay();
  const dirBias = dirIdx === 0 ? 0.04 : -0.02;
  // Deterministic small pseudo-variation per road so roads differ but stay stable within the hour
  const seed = (road.id.charCodeAt(0) * 7 + road.id.length * 13 + date.getHours() * 3) % 10;
  const jitter = (seed - 5) / 100;
  const raw = road.base * 0.55 + patternFactor(h, dow, road.haram) * 0.75 + dirBias + jitter;
  return Math.max(0.02, Math.min(0.99, raw));
}

export function statusOf(score: number): { key: StatusKey; label: string; color: string } {
  if (score < 0.28) return { key: 'empty', label: 'فاضي', color: '#22C55E' };
  if (score < 0.52) return { key: 'light', label: 'خفيفة', color: '#14B8A6' };
  if (score < 0.68) return { key: 'medium', label: 'متوسطة', color: '#F59E0B' };
  if (score < 0.85) return { key: 'busy', label: 'زحمة', color: '#F97316' };
  return { key: 'stuck', label: 'واقف', color: '#EF4444' };
}

// Average congestion % for each hour (0..23) on a given weekday (0=Sun..6=Sat),
// derived from the same pattern model (weekday differences come from patternFactor:
// Friday noon Haram peak, Thursday evening, calmer weekend mornings).
export function hourlyProfile(dow: number): number[] {
  const base = riyadhNow();
  const diff = dow - base.getDay();
  return Array.from({ length: 24 }, (_, h) => {
    const d = new Date(base); d.setDate(d.getDate() + diff); d.setHours(h, 0, 0, 0);
    return Math.round((ROADS.reduce((a, r) => a + roadScore(r, d), 0) / ROADS.length) * 100);
  });
}
export function labelOf(score10: number): string {
  if (score10 < 2.5) return 'خفيفة جداً';
  if (score10 < 4.5) return 'خفيفة';
  if (score10 < 6.5) return 'متوسطة';
  if (score10 < 8.5) return 'زحمة';
  return 'زحمة شديدة';
}

export interface Snapshot {
  now: Date; overall: number; pct: number; label: string;
  trend: number; extraMin: number; usualPct: number; diffPct: number;
  forecast: { hourLabel: string; pct: number }[]; bestTime: string; clearTime: string; clearLabel: string; peakLabel: string;
}
export function snapshot(date = riyadhNow()): Snapshot {
  const avg = (d: Date) => ROADS.reduce((a, r) => a + roadScore(r, d), 0) / ROADS.length;
  const cur = avg(date);
  const prev = new Date(date); prev.setHours(prev.getHours() - 1);
  const trend = Math.round((cur - avg(prev)) * 100);
  const pct = Math.round(cur * 100);
  // "usual" = same hour averaged Mon-Thu baseline approximation
  const usualDate = new Date(date); usualDate.setDate(usualDate.getDate() - ((usualDate.getDay() + 5) % 7)); // shift to a Monday-ish
  const usualPct = Math.round(avg(usualDate) * 100);
  const forecast = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(date); d.setHours(date.getHours() + i, 0, 0, 0);
    const hh = d.getHours(); const ap = hh < 12 ? 'ص' : 'م'; const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return { hourLabel: `${h12} ${ap}`, pct: Math.round(avg(d) * 100) };
  });
  let best = forecast[0], bi = 0; forecast.forEach((f, i) => { if (f.pct < best.pct) { best = f; bi = i; } });
  const clear = forecast.find((f) => f.pct < 35);
  return {
    now: date, overall: Math.round(cur * 100) / 10, pct, label: labelOf(cur * 10),
    trend, extraMin: Math.round(cur * 22), usualPct, diffPct: pct - usualPct,
    forecast, bestTime: bi === 0 ? 'الآن تقريباً' : `حوالي ${best.hourLabel}`,
    clearTime: clear ? `تنفك تدريجياً حوالي ${clear.hourLabel}` : 'تبقى متوسطة الليلة',
    clearLabel: clear ? clear.hourLabel : '',
    peakLabel: 'عادة ٥–٧:٣٠ مساءً، وحول صلاتي المغرب والعشاء قرب الحرم',
  };
}

export const PLACES: { name: string; area: string; base: number; peakHour: number }[] = [
  { name: 'المسجد النبوي والمركزية', area: 'الحرم', base: 0.55, peakHour: 19 },
  { name: 'مسجد قباء', area: 'قباء', base: 0.4, peakHour: 9 },
  { name: 'النور مول', area: 'طريق الملك عبدالله', base: 0.45, peakHour: 21 },
  { name: 'الراشد ميغا مول', area: 'طريق الملك عبدالله', base: 0.42, peakHour: 21 },
  { name: 'العالية مول', area: 'طريق قباء', base: 0.38, peakHour: 20 },
  { name: 'سوق بلال', area: 'قرب الحرم', base: 0.36, peakHour: 18 },
  { name: 'وادي العقيق', area: 'الجامعات', base: 0.3, peakHour: 17 },
  { name: 'حديقة الملك فهد', area: 'العوالي', base: 0.32, peakHour: 20 },
  { name: 'جبل أحد ومقبرة الشهداء', area: 'أحد', base: 0.34, peakHour: 10 },
];
export function placeBusy(p: { base: number; peakHour: number }, date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  const dow = date.getDay(); const weekend = dow === 4 || dow === 5 ? 0.12 : 0;
  return Math.max(0.05, Math.min(0.98, p.base * 0.4 + gauss(h, p.peakHour, 2.2) * 0.65 + weekend + patternFactor(h, dow, 0.3) * 0.15));
}
