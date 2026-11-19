import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { Bike, Gauge } from 'lucide-react';
import Insights from './Insights';
import { Btn, Card, Chip, Field, SectionTitle, Stat, inputCls } from './components';
import { daysText, fmtDate, fmtKm, fmtMoney, fmtNum, parseNum, todayLocal } from './lib';
import type { Full, Run, Status } from './types';

type Upcoming = { key: string; title: string; detail: string; status: Status; sort: number };

export default function Home({ data, run, goTo }: { data: Full; run: Run; goTo: (t: 'legal' | 'maint') => void }) {
    const { profile: p } = data;
    const [km, setKm] = useState('');
    const [kmErr, setKmErr] = useState('');
    const [busy, setBusy] = useState(false);

    const submitKm = async (e: FormEvent) => {
        e.preventDefault();
        const n = parseNum(km);
        if (n === null || n < 0) {
            setKmErr('Escribe el kilometraje que marca el tablero.');
            return;
        }
        setKmErr('');
        setBusy(true);
        const ok = await run(api.post('/api/odometer', { km: n, date: todayLocal() }), 'Kilometraje actualizado');
        setBusy(false);
        if (ok) setKm('');
    };

    const oil = data.items.find((i) => i.name.toLowerCase().includes('aceite de motor'));

    const upcoming: Upcoming[] = [
        ...data.docs
            .filter((d) => d.daysLeft <= 30)
            .map((d) => ({
                key: `d-${d.id}`,
                title: d.name,
                detail: `${daysText(d.daysLeft)} · ${fmtDate(d.expiry)}`,
                status: d.status,
                sort: d.daysLeft,
            })),
        ...data.items
            .filter((i) => i.status !== 'ok')
            .map((i) => ({
                key: `m-${i.id}`,
                title: i.name,
                detail:
                    i.kmLeft !== null
                        ? i.kmLeft > 0
                            ? `Faltan ${fmtKm(i.kmLeft)}`
                            : `Pasado por ${fmtKm(-i.kmLeft)}`
                        : i.dueDate
                          ? `Fecha: ${fmtDate(i.dueDate)}`
                          : '',
                status: i.status,
                sort: i.daysLeft ?? (i.status === 'vencido' ? -1 : 10),
            })),
    ]
        .sort((a, b) => a.sort - b.sort)
        .slice(0, 6);

    return (
        <div>
            <Card className="bg-gradient-to-br from-red-600 to-red-800 !border-0 text-white">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-sm opacity-90">
                            <Bike size={16} /> {p.brand} {p.model}
                        </div>
                        <div className="mt-1 text-3xl font-extrabold" data-testid="current-km">
                            {fmtKm(p.currentKm)}
                        </div>
                        <div className="text-xs opacity-80">Último registro: {fmtDate(p.currentKmDate)}</div>
                    </div>
                    {p.plate && (
                        <span className="rounded-lg border-2 border-black bg-yellow-300 px-2 py-1 font-mono text-sm font-bold text-black">
                            {p.plate}
                        </span>
                    )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-white/15 p-2">
                        <div className="text-xs opacity-80">Promedio diario</div>
                        <div className="font-bold">{data.rate ? `${fmtNum(data.rate)} km/día` : '—'}</div>
                    </div>
                    <div className="rounded-xl bg-white/15 p-2">
                        <div className="text-xs opacity-80">Estimado hoy</div>
                        <div className="font-bold">{data.estimatedKmToday !== null ? fmtKm(data.estimatedKmToday) : '—'}</div>
                    </div>
                </div>
            </Card>

            <Card className="mt-4">
                <form onSubmit={submitKm} className="space-y-2" noValidate>
                    <Field label="Actualizar kilometraje" error={kmErr}>
                        <div className="flex gap-2">
                            <input
                                className={inputCls}
                                inputMode="numeric"
                                aria-label="Nuevo kilometraje"
                                placeholder={String(Math.round(p.currentKm))}
                                value={km}
                                onChange={(e) => setKm(e.target.value)}
                            />
                            <Btn type="submit" disabled={busy}>
                                <Gauge size={16} /> Guardar
                            </Btn>
                        </div>
                    </Field>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Entre más seguido lo actualices, más precisa es la predicción de tus mantenimientos.
                    </p>
                </form>
            </Card>

            <Insights data={data} run={run} oil={oil} />

            <SectionTitle>Próximos vencimientos</SectionTitle>
            {upcoming.length === 0 ? (
                <Card>
                    <p className="text-sm">Todo al día ✅</p>
                </Card>
            ) : (
                <div className="space-y-2">
                    {upcoming.map((u) => (
                        <button
                            key={u.key}
                            onClick={() => goTo(u.key.startsWith('d-') ? 'legal' : 'maint')}
                            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-3 text-left dark:border-zinc-800 dark:bg-zinc-900"
                        >
                            <div className="min-w-0">
                                <div className="truncate font-semibold">{u.title}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">{u.detail}</div>
                            </div>
                            <Chip status={u.status} />
                        </button>
                    ))}
                </div>
            )}

            <SectionTitle>Consumo y gastos</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
                <Stat
                    label="Gastos de este mes"
                    value={fmtMoney(data.spending.monthTotal)}
                    sub="Gasolina, taller y otros"
                />
                <Stat
                    label="Rendimiento promedio"
                    value={data.fuelStats.avgKmPerGal !== null ? `${fmtNum(data.fuelStats.avgKmPerGal)} km/gal` : '—'}
                    sub={data.fuelStats.avgKmPerL !== null ? `${fmtNum(data.fuelStats.avgKmPerL)} km/L` : 'Necesito 2 tanqueos llenos'}
                />
                <Stat
                    label="Costo por km"
                    value={data.fuelStats.costPerKm !== null ? fmtMoney(data.fuelStats.costPerKm) : '—'}
                    sub={`Total gasolina: ${fmtMoney(data.fuelStats.totalSpent)}`}
                />
            </div>
        </div>
    );
}
