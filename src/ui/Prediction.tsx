import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { api } from '@appdeploy/client';
import { AlertTriangle, Check, Trash2 } from 'lucide-react';
import { Btn, Card, Confirm, SectionTitle, Stat } from './components';
import { fmtDate, fmtKm, fmtNum } from './lib';
import type { Full, ItemView, PredictionView, ReadingView, Run } from './types';

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const SOURCES: Record<string, string> = {
    manual: 'Manual',
    tanqueo: 'Tanqueo',
    servicio: 'Taller',
    registro: 'Registro',
    ajuste: 'Ajuste',
    atajo: 'Siri',
};

const dayNum = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, dd) / 86400000);
};

export const CONF_STYLE: Record<PredictionView['confidence'], string> = {
    'sin datos': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
    baja: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    media: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
    alta: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};

export function ConfidenceBadge({ c }: { c: PredictionView['confidence'] }) {
    return (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CONF_STYLE[c]}`}>Confianza {c}</span>
    );
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "24 nov" (sin año) para rangos cortos. */
export function shortDate(d: string): string {
    const [, m, dd] = d.split('-').map(Number);
    return `${dd} ${MONTHS[m - 1]}`;
}

export function rangeLabel(i: Pick<ItemView, 'dueDate' | 'dueLow' | 'dueHigh'>): string {
    if (!i.dueDate) return '';
    if (i.dueLow && i.dueHigh && i.dueLow !== i.dueHigh) return `entre el ${shortDate(i.dueLow)} y el ${shortDate(i.dueHigh)}`;
    return fmtDate(i.dueDate);
}

/** Kilometraje real + proyección con banda del 80 % y líneas de los próximos mantenimientos. */
function KmChart({ p, items }: { p: PredictionView; items: ItemView[] }) {
    const wrap = useRef<HTMLDivElement>(null);
    const [hover, setHover] = useState<number | null>(null);
    const W = 340;
    const H = 210;
    const pad = { l: 46, r: 10, t: 12, b: 24 };

    const model = useMemo(() => {
        const real = p.series.slice(-60).map((s) => ({ x: dayNum(s.date), y: s.km, date: s.date }));
        const fc = p.forecast.slice(0, 60).map((f) => ({ x: dayNum(f.date), ...f }));
        if (!real.length) return null;
        const x0 = real[0].x;
        const x1 = fc.length ? fc[fc.length - 1].x : real[real.length - 1].x + 1;
        const yMax0 = Math.max(real[real.length - 1].y, ...fc.map((f) => f.high));
        const marks = items
            .filter((i) => i.kmDue !== null && i.kmDue > real[real.length - 1].y && i.kmDue <= yMax0 * 1.02)
            .sort((a, b) => (a.kmDue ?? 0) - (b.kmDue ?? 0))
            .slice(0, 3);
        const yMin = real[0].y;
        const yMax = Math.max(yMax0, ...marks.map((m) => m.kmDue ?? 0));
        const span = Math.max(1, yMax - yMin);
        const sx = (x: number) => pad.l + ((x - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
        const sy = (y: number) => H - pad.b - ((y - yMin) / span) * (H - pad.t - pad.b);
        // Solo se rotulan las líneas que no chocan con la anterior (mín. 13 px de separación).
        const labeled = new Set<string>();
        let lastY = Infinity;
        for (const m of marks) {
            const y = sy(m.kmDue!);
            if (Math.abs(lastY - y) >= 13) {
                labeled.add(m.id);
                lastY = y;
            }
        }
        return { real, fc, x0, x1, yMin, yMax, sx, sy, marks, labeled };
    }, [p, items]);

    if (!model) return null;
    const { real, fc, x0, x1, yMin, yMax, sx, sy, marks, labeled } = model;
    const lastReal = real[real.length - 1];
    const realPath = real.map((r, i) => `${i ? 'L' : 'M'}${sx(r.x).toFixed(1)},${sy(r.y).toFixed(1)}`).join(' ');
    const fcPath = [`M${sx(lastReal.x).toFixed(1)},${sy(lastReal.y).toFixed(1)}`]
        .concat(fc.map((f) => `L${sx(f.x).toFixed(1)},${sy(f.mean).toFixed(1)}`))
        .join(' ');
    const band =
        fc.length > 0
            ? `M${sx(lastReal.x)},${sy(lastReal.y)} ` +
              fc.map((f) => `L${sx(f.x).toFixed(1)},${sy(f.high).toFixed(1)}`).join(' ') +
              ' ' +
              [...fc]
                  .reverse()
                  .map((f) => `L${sx(f.x).toFixed(1)},${sy(f.low).toFixed(1)}`)
                  .join(' ') +
              ` L${sx(lastReal.x)},${sy(lastReal.y)} Z`
            : '';
    const ticks = [0, 0.5, 1].map((k) => yMin + (yMax - yMin) * k);

    const onMove = (e: RPointerEvent<SVGRectElement>) => {
        const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
        const px = ((e.clientX - rect.left) / rect.width) * W;
        const x = x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
        setHover(Math.round(Math.min(x1, Math.max(x0, x))));
    };

    let tip: { x: number; y: number; title: string; lines: string[] } | null = null;
    if (hover !== null) {
        if (hover <= lastReal.x) {
            const near = real.reduce((a, b) => (Math.abs(b.x - hover) < Math.abs(a.x - hover) ? b : a));
            tip = { x: near.x, y: near.y, title: fmtDate(near.date), lines: [`Registrado: ${fmtKm(near.y)}`] };
        } else {
            const f = fc.find((v) => v.x === hover) ?? fc[fc.length - 1];
            tip = {
                x: f.x,
                y: f.mean,
                title: fmtDate(f.date),
                lines: [`Proyección: ${fmtKm(f.mean)}`, `Rango 80 %: ${fmtKm(f.low)} – ${fmtKm(f.high)}`],
            };
        }
    }

    return (
        <div ref={wrap} className="relative">
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full touch-none text-zinc-500 dark:text-zinc-400"
                role="img"
                aria-label="Kilometraje registrado y proyección de los próximos 60 días"
            >
                {ticks.map((v) => (
                    <g key={v}>
                        <line x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
                        <text x={pad.l - 6} y={sy(v) + 3} textAnchor="end" className="fill-current text-[9px]">
                            {Math.round(v).toLocaleString('es-CO')}
                        </text>
                    </g>
                ))}
                <text x={pad.l} y={H - 6} className="fill-current text-[9px]">
                    {fmtDate(real[0].date)}
                </text>
                <text x={W - pad.r} y={H - 6} textAnchor="end" className="fill-current text-[9px]">
                    {fc.length ? fmtDate(fc[fc.length - 1].date) : ''}
                </text>

                {marks.map((m) => (
                    <g key={m.id}>
                        <line
                            x1={pad.l}
                            x2={W - pad.r}
                            y1={sy(m.kmDue!)}
                            y2={sy(m.kmDue!)}
                            className="stroke-zinc-400 dark:stroke-zinc-500"
                            strokeWidth={1}
                            strokeDasharray="2 3"
                        />
                        {labeled.has(m.id) && (
                            <text x={pad.l + 4} y={sy(m.kmDue!) - 3} className="fill-zinc-600 text-[9px] dark:fill-zinc-300">
                                {m.name} · {fmtKm(m.kmDue!)}
                            </text>
                        )}
                    </g>
                ))}

                {band && <path d={band} className="fill-red-500/15 dark:fill-red-400/20" />}
                <path d={fcPath} fill="none" className="stroke-red-500 dark:stroke-red-400" strokeWidth={2} strokeDasharray="5 4" />
                <path d={realPath} fill="none" className="stroke-red-600 dark:stroke-red-400" strokeWidth={2} strokeLinejoin="round" />
                <circle cx={sx(lastReal.x)} cy={sy(lastReal.y)} r={4} className="fill-red-600 stroke-white dark:fill-red-400 dark:stroke-zinc-900" strokeWidth={2} />

                {tip && (
                    <g pointerEvents="none">
                        <line x1={sx(tip.x)} x2={sx(tip.x)} y1={pad.t} y2={H - pad.b} className="stroke-zinc-400" strokeWidth={1} />
                        <circle cx={sx(tip.x)} cy={sy(tip.y)} r={4} className="fill-red-600 stroke-white dark:fill-red-400 dark:stroke-zinc-900" strokeWidth={2} />
                    </g>
                )}
                <rect
                    x={pad.l}
                    y={pad.t}
                    width={W - pad.l - pad.r}
                    height={H - pad.t - pad.b}
                    fill="transparent"
                    onPointerMove={onMove}
                    onPointerDown={onMove}
                    onPointerLeave={() => setHover(null)}
                />
            </svg>
            {tip && (
                <div
                    className="pointer-events-none absolute top-1 w-max max-w-[230px] rounded-lg bg-zinc-900 px-2 py-1 text-[11px] text-white shadow dark:bg-zinc-100 dark:text-zinc-900"
                    style={{
                        left: `${Math.min(70, Math.max(0, ((sx(tip.x) - 40) / W) * 100))}%`,
                    }}
                >
                    <div className="font-semibold">{tip.title}</div>
                    {tip.lines.map((l) => (
                        <div key={l}>{l}</div>
                    ))}
                </div>
            )}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-300">
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 bg-red-600 dark:bg-red-400" /> Registrado
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-red-500 dark:border-red-400" />{' '}
                    Proyección
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-4 rounded-sm bg-red-500/15 dark:bg-red-400/20" /> Rango probable (80 %)
                </span>
            </div>
        </div>
    );
}

/** Km por día de la semana (una sola serie; el día más fuerte se resalta). */
function WeekdayBars({ rates }: { rates: number[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(1, ...rates);
    const top = rates.indexOf(Math.max(...rates));
    return (
        <div>
            <div className="flex h-28 items-end gap-1.5" role="img" aria-label="Kilómetros por día de la semana">
                {rates.map((r, i) => (
                    <button
                        key={i}
                        type="button"
                        className="relative flex h-full flex-1 flex-col justify-end"
                        onPointerEnter={() => setHover(i)}
                        onPointerLeave={() => setHover(null)}
                        onClick={() => setHover(hover === i ? null : i)}
                        aria-label={`${DAYS[i]}: ${fmtNum(r, 0)} km`}
                    >
                        {hover === i && (
                            <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-zinc-100 dark:text-zinc-900">
                                {fmtNum(r, 0)} km
                            </span>
                        )}
                        <span
                            className={`block w-full rounded-t ${i === top ? 'bg-red-600 dark:bg-red-400' : 'bg-red-300 dark:bg-red-800'}`}
                            style={{ height: `${Math.max(2, (r / max) * 100)}%` }}
                        />
                    </button>
                ))}
            </div>
            <div className="mt-1 grid grid-cols-7 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                {rates.map((r, i) => (
                    <div key={i}>
                        <div className="font-semibold">{DAYS[i]}</div>
                        <div className="tabular-nums">{fmtNum(r, 0)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function PredictionPanel({ data, run }: { data: Full; run: Run }) {
    const p = data.prediction;
    const [deleting, setDeleting] = useState<ReadingView | null>(null);
    if (!p) return <p className="text-sm">Actualiza la app para ver el análisis.</p>;

    const upcoming = data.items
        .filter((i) => i.kmDue !== null && i.dueDate)
        .sort((a, b) => dayNum(a.dueDate!) - dayNum(b.dueDate!))
        .slice(0, 5);

    return (
        <div className="space-y-1">
            {!p.ready ? (
                <Card>
                    <p className="text-sm">
                        Todavía no tengo suficientes datos. Registra el kilometraje en al menos dos días distintos (mejor si
                        es cada 2 o 3 días) y aquí verás tu ritmo y las predicciones.
                    </p>
                </Card>
            ) : (
                <>
                    <div className="flex items-center justify-between">
                        <ConfidenceBadge c={p.confidence} />
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                            {p.readings} lecturas · {p.historyDays} días de historial
                        </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                        <Stat label="Ritmo promedio" value={`${fmtNum(p.rateAvg ?? 0, 1)} km/día`} />
                        <Stat
                            label="Variación típica"
                            value={`± ${fmtNum(p.sigma ?? 0, 0)} km/día`}
                            sub="Qué tanto cambia tu recorrido de un día a otro"
                        />
                    </div>

                    <SectionTitle>Kilometraje y proyección (60 días)</SectionTitle>
                    <Card>
                        <KmChart p={p} items={data.items} />
                    </Card>

                    {p.weekdayRates && (
                        <>
                            <SectionTitle>Tu ritmo por día de la semana (km)</SectionTitle>
                            <Card>
                                <WeekdayBars rates={p.weekdayRates} />
                            </Card>
                        </>
                    )}

                    <SectionTitle>Próximos mantenimientos</SectionTitle>
                    <Card className="!p-0">
                        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {upcoming.map((i) => (
                                <li key={i.id} className="px-4 py-2.5">
                                    <div className="flex justify-between gap-2">
                                        <span className="font-semibold">{i.name}</span>
                                        <span className="text-sm tabular-nums">{i.kmDue !== null ? fmtKm(i.kmDue) : ''}</span>
                                    </div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {fmtDate(i.dueDate!)}
                                        {i.dueLow && i.dueHigh && i.dueLow !== i.dueHigh ? ` · probable ${rangeLabel(i)}` : ''}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </Card>
                </>
            )}

            <SectionTitle>Lecturas recientes</SectionTitle>
            {p.anomalies.length > 0 && (
                <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                    <AlertTriangle size={16} className="shrink-0" />
                    Hay lecturas que no cuadran con tu ritmo y no las estoy usando. Confírmalas si son correctas o elimínalas
                    si fue un error.
                </p>
            )}
            <Card className="!p-0">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {p.readingsList.map((r) => {
                        const a = p.anomalies.find((x) => x.id === r.id);
                        return (
                            <li key={r.id} className={`px-4 py-2 ${a ? 'bg-amber-50/70 dark:bg-amber-950/30' : ''}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="font-semibold tabular-nums">{fmtKm(r.km)}</div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {fmtDate(r.date)} · {SOURCES[r.source] ?? r.source}
                                            {r.verified ? ' · confirmada' : ''}
                                        </div>
                                        {a && <div className="text-xs text-amber-800 dark:text-amber-300">{a.reason}</div>}
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        {a && (
                                            <Btn
                                                variant="secondary"
                                                className="!px-2 !py-1.5"
                                                ariaLabel={`Confirmar lectura de ${fmtKm(r.km)}`}
                                                onClick={() => run(api.post(`/api/odometer/${r.id}/verify`), 'Lectura confirmada')}
                                            >
                                                <Check size={16} />
                                            </Btn>
                                        )}
                                        <Btn
                                            variant="ghost"
                                            className="!px-2 !py-1.5"
                                            ariaLabel={`Eliminar lectura de ${fmtKm(r.km)}`}
                                            onClick={() => setDeleting(r)}
                                        >
                                            <Trash2 size={16} />
                                        </Btn>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </Card>

            <p className="pt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Cómo funciona: aprendo cuántos km haces cada día de la semana (lo reciente pesa más), descarto lecturas
                raras y calculo un rango del 80 %: en 8 de cada 10 casos la fecha real cae dentro de él. Entre más seguido
                registres el kilometraje, más estrecho será el rango.
            </p>

            <Confirm
                open={deleting !== null}
                title="Eliminar lectura"
                message={`¿Eliminar la lectura de ${deleting ? fmtKm(deleting.km) : ''} del ${deleting ? fmtDate(deleting.date) : ''}? Si era la más alta, el kilometraje actual se recalcula con la siguiente.`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const d = deleting;
                    setDeleting(null);
                    if (d) await run(api.delete(`/api/odometer/${d.id}`), 'Lectura eliminada');
                }}
            />
        </div>
    );
}
