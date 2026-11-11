import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { Trash2 } from 'lucide-react';
import { Btn, Card, Confirm, Field, SectionTitle, Stat, inputCls } from './components';
import { fmtDate, fmtKm, fmtMoney, fmtNum, parseNum, todayLocal } from './lib';
import type { FuelView, Full, Run } from './types';

export default function FuelPage({ data, run }: { data: Full; run: Run }) {
    const [mode, setMode] = useState<'galones' | 'pesos'>('galones');
    const [date, setDate] = useState(todayLocal());
    const [km, setKm] = useState('');
    const [gallons, setGallons] = useState('');
    const [total, setTotal] = useState('');
    const [price, setPrice] = useState(
        data.fuelStats.avgPricePerGallon ? String(Math.round(data.fuelStats.avgPricePerGallon)) : '',
    );
    const [fullTank, setFullTank] = useState(true);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [deleting, setDeleting] = useState<FuelView | null>(null);
    const s = data.fuelStats;

    const priceN = parseNum(price);
    const totalN = parseNum(total);
    const computedGallons = mode === 'pesos' && priceN && totalN ? totalN / priceN : null;

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        const kmN = parseNum(km);
        let gal: number | null = null;
        if (kmN === null || kmN < 0) errs.km = 'Escribe el kilometraje del tablero.';
        if (totalN === null || totalN < 0) errs.total = 'Escribe cuánto pagaste.';
        if (mode === 'galones') {
            gal = parseNum(gallons);
            if (gal === null || gal <= 0) errs.gallons = 'Escribe los galones tanqueados.';
        } else {
            if (priceN === null || priceN <= 0) errs.price = 'Escribe el precio por galón.';
            gal = computedGallons;
        }
        setErrors(errs);
        if (Object.keys(errs).length || gal === null) return;
        setBusy(true);
        const ok = await run(
            api.post('/api/fuel', { date, km: kmN, gallons: Math.round(gal * 1000) / 1000, total: totalN, fullTank }),
            'Tanqueo registrado',
        );
        setBusy(false);
        if (ok) {
            setKm('');
            setGallons('');
            setTotal('');
        }
    };

    return (
        <div>
            <div className="grid grid-cols-2 gap-2">
                <Stat
                    label="Promedio"
                    value={s.avgKmPerGal !== null ? `${fmtNum(s.avgKmPerGal)} km/gal` : '—'}
                    sub={s.avgKmPerL !== null ? `${fmtNum(s.avgKmPerL)} km/L` : undefined}
                />
                <Stat label="Último tanque" value={s.lastKmPerGal !== null ? `${fmtNum(s.lastKmPerGal)} km/gal` : '—'} />
                <Stat label="Costo por km" value={s.costPerKm !== null ? fmtMoney(s.costPerKm) : '—'} />
                <Stat
                    label="Total gastado"
                    value={fmtMoney(s.totalSpent)}
                    sub={`${fmtNum(s.totalGallons, 2)} galones`}
                />
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                El consumo se calcula entre dos tanqueos con tanque lleno (1 galón = 3,785 litros).
            </p>

            <SectionTitle>Registrar tanqueo</SectionTitle>
            <Card>
                <form onSubmit={submit} className="space-y-4" noValidate>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
                        {(['galones', 'pesos'] as const).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setMode(m)}
                                className={`rounded-lg py-2 text-sm font-semibold ${mode === m ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500'}`}
                            >
                                {m === 'galones' ? 'Sé los galones' : 'Solo sé los pesos'}
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Fecha">
                            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
                        </Field>
                        <Field label="Kilometraje" error={errors.km}>
                            <input
                                className={inputCls}
                                inputMode="numeric"
                                aria-label="Kilometraje del tanqueo"
                                placeholder={String(Math.round(data.profile.currentKm))}
                                value={km}
                                onChange={(e) => setKm(e.target.value)}
                            />
                        </Field>
                        {mode === 'galones' ? (
                            <Field label="Galones" error={errors.gallons}>
                                <input
                                    className={inputCls}
                                    inputMode="decimal"
                                    aria-label="Galones"
                                    placeholder="2,5"
                                    value={gallons}
                                    onChange={(e) => setGallons(e.target.value)}
                                />
                            </Field>
                        ) : (
                            <Field
                                label="Precio por galón"
                                error={errors.price}
                                hint={computedGallons ? `≈ ${fmtNum(computedGallons, 2)} galones` : undefined}
                            >
                                <input
                                    className={inputCls}
                                    inputMode="numeric"
                                    aria-label="Precio por galón"
                                    placeholder="16000"
                                    value={price}
                                    onChange={(e) => setPrice(e.target.value)}
                                />
                            </Field>
                        )}
                        <Field label="Total pagado (COP)" error={errors.total}>
                            <input
                                className={inputCls}
                                inputMode="numeric"
                                aria-label="Total pagado"
                                placeholder="40000"
                                value={total}
                                onChange={(e) => setTotal(e.target.value)}
                            />
                        </Field>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            className="h-5 w-5 accent-red-600"
                            checked={fullTank}
                            onChange={(e) => setFullTank(e.target.checked)}
                        />
                        Llené el tanque
                    </label>
                    <Btn type="submit" disabled={busy} className="w-full">
                        {busy ? 'Guardando…' : 'Guardar tanqueo'}
                    </Btn>
                </form>
            </Card>

            <SectionTitle>Historial</SectionTitle>
            {data.fuel.length === 0 ? (
                <Card>
                    <p className="text-sm">Aún no hay tanqueos registrados.</p>
                </Card>
            ) : (
                <div className="space-y-2">
                    {data.fuel.map((f) => (
                        <Card key={f.id} className="!p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <div className="font-semibold">
                                        {fmtKm(f.km)} · {fmtNum(f.gallons, 2)} gal
                                    </div>
                                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {fmtDate(f.date)} · {fmtMoney(f.total)}
                                        {f.fullTank ? ' · lleno' : ' · parcial'}
                                        {f.kmPerGal !== null ? ` · ${fmtNum(f.kmPerGal)} km/gal` : ''}
                                    </div>
                                </div>
                                <Btn
                                    variant="ghost"
                                    className="!px-2 !py-1.5"
                                    onClick={() => setDeleting(f)}
                                    ariaLabel={`Eliminar tanqueo de ${fmtKm(f.km)}`}
                                >
                                    <Trash2 size={16} />
                                </Btn>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <Confirm
                open={deleting !== null}
                title="Eliminar tanqueo"
                message="¿Seguro que quieres eliminar este tanqueo? Se recalculará tu consumo."
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const d = deleting;
                    setDeleting(null);
                    if (d) await run(api.delete(`/api/fuel/${d.id}`), 'Tanqueo eliminado');
                }}
            />
        </div>
    );
}
