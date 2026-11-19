import { useState } from 'react';
import { AlertTriangle, ChevronRight, Clock, Fuel, TrendingUp } from 'lucide-react';
import { Btn, Card, Modal } from './components';
import PredictionPanel, { ConfidenceBadge, rangeLabel } from './Prediction';
import { fmtDate, fmtKm, fmtNum } from './lib';
import type { Full, ItemView, Run } from './types';

function Banner({
    tone,
    icon,
    children,
    action,
}: {
    tone: 'amber' | 'red' | 'zinc';
    icon: React.ReactNode;
    children: React.ReactNode;
    action?: React.ReactNode;
}) {
    const tones = {
        amber: 'bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
        red: 'bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-200',
        zinc: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200',
    };
    return (
        <div role="status" className={`mt-3 flex items-start gap-2 rounded-2xl p-3 text-sm ${tones[tone]}`}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div className="min-w-0 flex-1">{children}</div>
            {action}
        </div>
    );
}

/** Avisos inteligentes + tarjeta de predicción en Inicio. */
export default function Insights({ data, run, oil }: { data: Full; run: Run; oil?: ItemView }) {
    const [open, setOpen] = useState(false);
    const p = data.prediction;
    const fa = data.fuelAlert;
    const since = p?.daysSinceReading ?? null;

    return (
        <>
            {p && p.anomalies.length > 0 && (
                <Banner
                    tone="amber"
                    icon={<AlertTriangle size={16} />}
                    action={
                        <Btn variant="secondary" className="!px-2 !py-1 text-xs" onClick={() => setOpen(true)}>
                            Revisar
                        </Btn>
                    }
                >
                    {p.anomalies.length === 1
                        ? `La lectura de ${fmtKm(p.anomalies[0].km)} (${fmtDate(p.anomalies[0].date)}) no cuadra con tu ritmo.`
                        : `${p.anomalies.length} lecturas no cuadran con tu ritmo.`}{' '}
                    ¿Es correcta o fue un error?
                </Banner>
            )}

            {since !== null && since >= 4 && (
                <Banner tone="zinc" icon={<Clock size={16} />}>
                    Llevas <b>{since} días</b> sin registrar el kilometraje. Actualízalo arriba (o con el Atajo de Siri) para
                    que las predicciones no pierdan precisión.
                </Banner>
            )}

            {fa && (
                <Banner tone="red" icon={<Fuel size={16} />}>
                    Tu último tanque rindió <b>{fmtNum(fa.lastKmPerGal, 0)} km/gal</b>, un {Math.round(fa.dropPct * 100)} % menos
                    que tu promedio ({fmtNum(fa.baseline, 0)} km/gal). Revisa la tensión de la cadena, la presión de las
                    llantas y el filtro de aire.
                </Banner>
            )}

            {oil && (
                <Card className="mt-4">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            <TrendingUp size={16} className="text-red-600" /> Próximo cambio de aceite
                        </div>
                        {p && <ConfidenceBadge c={p.confidence} />}
                    </div>
                    <div className="mt-2 text-2xl font-bold">{oil.kmDue !== null ? fmtKm(oil.kmDue) : '—'}</div>
                    <div className="text-sm text-zinc-600 dark:text-zinc-300">
                        {oil.dueDate ? (
                            <>
                                Fecha esperada: <b>{fmtDate(oil.dueDate)}</b>
                                {oil.daysLeft !== null && ` (${oil.daysLeft <= 0 ? 'ya' : `en ${oil.daysLeft} días`})`}
                                {oil.dueLow && oil.dueHigh && oil.dueLow !== oil.dueHigh && (
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        Probablemente {rangeLabel(oil)}
                                    </div>
                                )}
                            </>
                        ) : (
                            'Registra el kilometraje en días distintos para que aprenda tu ritmo.'
                        )}
                    </div>
                    <Btn variant="secondary" className="mt-3 w-full" onClick={() => setOpen(true)}>
                        Ver análisis completo <ChevronRight size={16} />
                    </Btn>
                </Card>
            )}

            <Modal open={open} title="Predicciones" onClose={() => setOpen(false)}>
                {open && <PredictionPanel data={data} run={run} />}
            </Modal>
        </>
    );
}
