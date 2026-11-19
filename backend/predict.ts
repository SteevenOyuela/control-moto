// Modelo predictivo de kilometraje (fase 3).
//
// 1. Agrega las lecturas del odómetro por día y descarta datos raros
//    (km que bajan, saltos imposibles o atípicos frente al ritmo habitual).
// 2. Estima cuántos km se ruedan cada día de la semana con mínimos cuadrados
//    ponderados (lo reciente pesa más) y regularización hacia el promedio,
//    para no inventar patrones cuando hay pocos datos.
// 3. Calcula la incertidumbre (ruido diario + error del promedio) y proyecta
//    el kilometraje futuro con una banda del 80 %.

export type Reading = { id: string; date: string; km: number; source?: string; verified?: boolean };

export type Anomaly = { id: string; date: string; km: number; reason: string };

export type Confidence = 'sin datos' | 'baja' | 'media' | 'alta';

export type ForecastPoint = { date: string; mean: number; low: number; high: number };

export type Prediction = {
    ready: boolean;
    confidence: Confidence;
    rateAvg: number | null; // km/día promedio esperado
    weekdayRates: number[] | null; // lunes..domingo, km/día
    sigma: number | null; // desviación del ruido diario (km)
    historyDays: number;
    readings: number;
    lastDate: string | null;
    lastKm: number | null;
    daysSinceReading: number | null;
    estimatedKmToday: number | null;
    series: Array<{ date: string; km: number }>;
    forecast: ForecastPoint[];
    anomalies: Anomaly[];
};

export type DueRange = { mean: string; low: string; high: string } | null;

const HALF_LIFE_DAYS = 30;
const WINDOW_DAYS = 150;
const MAX_KM_PER_DAY = 700;
const RIDGE = 2;
const Z80 = 1.2816;
const HORIZON = 730;

export function dayNum(d: string): number {
    const [y, m, dd] = d.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, dd) / 86400000);
}

export function dateOf(n: number): string {
    return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** 0 = lunes … 6 = domingo. */
function dow(n: number): number {
    return (new Date(n * 86400000).getUTCDay() + 6) % 7;
}

function median(xs: number[]): number {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Resuelve A x = b (Gauss con pivoteo parcial). A es n×n. */
function solve(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-12) return null;
        [M[c], M[p]] = [M[p], M[c]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((row, i) => row[n] / M[i][i]);
}

/** Una lectura por día (la mayor) y detección de datos raros. */
function clean(readings: Reading[], today: number) {
    const byDay = new Map<number, Reading>();
    for (const r of readings) {
        if (!Number.isFinite(r.km) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
        const d = dayNum(r.date);
        if (d > today) continue;
        const prev = byDay.get(d);
        if (!prev || r.km > prev.km) byDay.set(d, r);
    }
    const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
    const anomalies: Anomaly[] = [];
    const valid: Array<{ d: number; km: number; r: Reading }> = [];

    // Paso 1: monotonía y saltos imposibles respecto al último punto válido.
    for (const [d, r] of days) {
        const last = valid[valid.length - 1];
        if (!last) {
            valid.push({ d, km: r.km, r });
            continue;
        }
        const gap = d - last.d;
        const delta = r.km - last.km;
        if (!r.verified && delta < 0) {
            anomalies.push({ id: r.id, date: r.date, km: r.km, reason: 'Es menor que una lectura anterior.' });
            continue;
        }
        if (!r.verified && delta > MAX_KM_PER_DAY * Math.max(1, gap)) {
            anomalies.push({
                id: r.id,
                date: r.date,
                km: r.km,
                reason: `Implica ${Math.round(delta / Math.max(1, gap))} km por día; puede ser un error de digitación.`,
            });
            continue;
        }
        valid.push({ d, km: r.km, r });
    }

    // Paso 2: atípicos frente al ritmo habitual (mediana y desviación robusta).
    if (valid.length >= 6) {
        const rates: number[] = [];
        for (let i = 1; i < valid.length; i++) {
            rates.push((valid[i].km - valid[i - 1].km) / Math.max(1, valid[i].d - valid[i - 1].d));
        }
        const med = median(rates);
        const mad = median(rates.map((x) => Math.abs(x - med))) || Math.max(5, med * 0.3);
        const keep = [valid[0]];
        for (let i = 1; i < valid.length; i++) {
            const prev = keep[keep.length - 1];
            const gap = Math.max(1, valid[i].d - prev.d);
            const rate = (valid[i].km - prev.km) / gap;
            const nextOk =
                i + 1 < valid.length
                    ? (valid[i + 1].km - prev.km) / Math.max(1, valid[i + 1].d - prev.d) <= med + 8 * mad
                    : true; // la última lectura no tiene con qué contrastarse: se marca para que la confirmes
            // Un salto atípico seguido de lecturas que vuelven al ritmo normal = probable error.
            if (!valid[i].r.verified && rate > med + 12 * mad && rate > 150 && nextOk) {
                anomalies.push({
                    id: valid[i].r.id,
                    date: valid[i].r.date,
                    km: valid[i].km,
                    reason: 'No coincide con tu ritmo habitual ni con las lecturas siguientes.',
                });
                continue;
            }
            keep.push(valid[i]);
        }
        return { valid: keep, anomalies };
    }
    return { valid, anomalies };
}

export function buildPrediction(readings: Reading[], todayStr: string): Prediction {
    const today = dayNum(todayStr);
    const { valid, anomalies } = clean(readings, today);
    const series = valid.filter((v) => today - v.d <= 180).map((v) => ({ date: dateOf(v.d), km: v.km }));
    const last = valid[valid.length - 1];
    const base: Prediction = {
        ready: false,
        confidence: 'sin datos',
        rateAvg: null,
        weekdayRates: null,
        sigma: null,
        historyDays: valid.length ? valid[valid.length - 1].d - valid[0].d : 0,
        readings: valid.length,
        lastDate: last ? dateOf(last.d) : null,
        lastKm: last ? last.km : null,
        daysSinceReading: last ? today - last.d : null,
        estimatedKmToday: null,
        series,
        forecast: [],
        anomalies,
    };

    const recent = valid.filter((v) => today - v.d <= WINDOW_DAYS);
    const pts = recent.length >= 2 ? recent : valid;
    if (pts.length < 2 || pts[pts.length - 1].d - pts[0].d < 1) return base;

    // Intervalos entre lecturas: cuántos días de cada tipo hubo y cuántos km se rodaron.
    type Interval = { counts: number[]; n: number; delta: number; w: number };
    const intervals: Interval[] = [];
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const counts = [0, 0, 0, 0, 0, 0, 0];
        for (let d = a.d + 1; d <= b.d; d++) counts[dow(d)]++;
        const age = today - (a.d + b.d) / 2;
        intervals.push({ counts, n: b.d - a.d, delta: b.km - a.km, w: Math.pow(0.5, age / HALF_LIFE_DAYS) });
    }
    const sw = intervals.reduce((s, x) => s + x.w * x.n, 0);
    const mean = intervals.reduce((s, x) => s + x.w * x.delta, 0) / sw;

    // Mínimos cuadrados ponderados con ridge hacia el promedio (7 parámetros).
    const A = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => (i === j ? RIDGE : 0)));
    const bvec = Array.from({ length: 7 }, () => RIDGE * mean);
    for (const it of intervals) {
        for (let i = 0; i < 7; i++) {
            if (!it.counts[i]) continue;
            bvec[i] += it.w * it.counts[i] * it.delta;
            for (let j = 0; j < 7; j++) A[i][j] += it.w * it.counts[i] * it.counts[j];
        }
    }
    const sol = solve(A, bvec);
    const rates = (sol ?? Array(7).fill(mean)).map((r) => Math.max(0, Math.min(MAX_KM_PER_DAY, r)));
    const rateAvg = rates.reduce((s, r) => s + r, 0) / 7;
    if (!(rateAvg > 0)) return { ...base, rateAvg: 0 };

    // Ruido diario: Var(Δ) ≈ n·σ².
    let num = 0;
    let den = 0;
    for (const it of intervals) {
        const pred = it.counts.reduce((s, c, i) => s + c * rates[i], 0);
        const e = it.delta - pred;
        num += (it.w * e * e) / it.n;
        den += it.w;
    }
    const dof = Math.max(1, intervals.length - 1);
    let sigma = Math.sqrt((num / Math.max(den, 1e-9)) * (intervals.length / dof));
    if (!Number.isFinite(sigma) || intervals.length < 3) sigma = Math.max(sigma || 0, rateAvg * 0.8);
    sigma = Math.max(sigma, rateAvg * 0.15);
    const totalDays = intervals.reduce((s, x) => s + x.n, 0);
    const seMean = sigma / Math.sqrt(Math.max(1, totalDays));

    const historyDays = pts[pts.length - 1].d - pts[0].d;
    let confidence: Confidence = 'alta';
    if (historyDays < 14 || intervals.length < 3) confidence = 'baja';
    else if (historyDays < 45 || intervals.length < 6) confidence = 'media';

    // Proyección desde la última lectura válida.
    const start = last.d;
    const forecast: ForecastPoint[] = [];
    let cum = 0;
    for (let h = 1; h <= HORIZON; h++) {
        cum += rates[dow(start + h)];
        const sd = Math.sqrt(h * sigma * sigma + (h * seMean) ** 2);
        forecast.push({
            date: dateOf(start + h),
            mean: last.km + cum,
            low: last.km + Math.max(0, cum - Z80 * sd),
            high: last.km + cum + Z80 * sd,
        });
    }
    const sinceToday = today - start;
    const estimatedKmToday = sinceToday > 0 ? Math.round(forecast[sinceToday - 1].mean) : last.km;

    return {
        ...base,
        ready: true,
        confidence,
        rateAvg,
        weekdayRates: rates,
        sigma,
        historyDays,
        estimatedKmToday,
        forecast,
    };
}

/** Fecha esperada (y rango del 80 %) en que se alcanzará `targetKm`. */
export function dueRange(p: Prediction, targetKm: number): DueRange {
    if (!p.ready || p.lastKm === null || !p.lastDate) return null;
    if (targetKm <= p.lastKm) return { mean: p.lastDate, low: p.lastDate, high: p.lastDate };
    const f = p.forecast;
    const first = (pred: (x: ForecastPoint) => boolean) => f.find(pred)?.date ?? f[f.length - 1].date;
    return {
        mean: first((x) => x.mean >= targetKm),
        low: first((x) => x.high >= targetKm),
        high: first((x) => x.low >= targetKm),
    };
}
