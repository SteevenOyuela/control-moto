import { useMemo, useRef, useState } from 'react';
import { api, image } from '@appdeploy/client';
import { Camera, Fuel, Wrench } from 'lucide-react';
import { Btn, Card, Confirm, Field, Modal, inputCls } from './components';
import Cropper from './Cropper';
import { errMsg, fmtKm, fmtMoney, fmtNum, parseNum, todayLocal } from './lib';
import type { Full, Run } from './types';

type Match = { id: string; name: string; price: number | null };

type Scan = {
    merchant: string | null;
    date: string | null;
    total: number | null;
    category: string;
    gallons: number | null;
    pricePerGallon: number | null;
    summary: string | null;
    odometer: number | null;
    maintMatches: Match[];
};

type Mode = 'expense' | 'maint';

/**
 * Escanear factura: foto → recorte → IA → revisión → el usuario confirma.
 * - mode "expense" (Gastos): llena el gasto; si detecta servicios de taller los ofrece para marcar en Taller.
 * - mode "maint" (Taller): marca como hechos los mantenimientos que aparecen en la factura.
 */
export default function ReceiptScan({ data, run, mode = 'expense' }: { data: Full; run: Run; mode?: Mode }) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [raw, setRaw] = useState<File | null>(null);
    const [reading, setReading] = useState(false);
    const [scan, setScan] = useState<Scan | null>(null);
    const [err, setErr] = useState('');

    const read = async (blob: Blob) => {
        setRaw(null);
        setErr('');
        setReading(true);
        try {
            const prepared = await image.resizeIfNeeded(blob, { maxDimension: 1600, mimeType: 'image/jpeg' });
            const r = await api.post('/api/expenses/scan', { data: prepared.data, mimeType: prepared.mimeType });
            const s = r.data as Scan;
            s.maintMatches = Array.isArray(s.maintMatches) ? s.maintMatches : [];
            if (mode === 'maint' && s.maintMatches.length === 0) {
                setErr('No encontré servicios de tu plan en la factura. Puedes elegirlos a mano en la revisión.');
            }
            setScan(s);
        } catch (e) {
            setErr(errMsg(e));
        }
        setReading(false);
    };

    const title = mode === 'maint' ? 'Escanear factura del taller' : 'Escanear factura';
    const desc =
        mode === 'maint'
            ? 'Toma la foto de la factura y detecto qué servicios se hicieron. Tú confirmas antes de guardar.'
            : 'Toma la foto del recibo y lleno el gasto por ti. Solo revisas y guardas.';

    return (
        <>
            <Card className="!p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-semibold">{title}</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{desc}</div>
                    </div>
                    <Btn onClick={() => inputRef.current?.click()} disabled={reading} className="shrink-0">
                        <Camera size={16} /> {reading ? 'Leyendo…' : 'Escanear'}
                    </Btn>
                </div>
                {err && (
                    <p role="alert" className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                        {err}
                    </p>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label="Foto de la factura"
                    onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        e.target.value = '';
                        if (f) setRaw(f);
                    }}
                />
            </Card>

            <Modal open={raw !== null} title="Recorta la factura" onClose={() => setRaw(null)}>
                {raw && <Cropper file={raw} onCancel={() => setRaw(null)} onDone={read} />}
            </Modal>

            <Modal open={scan !== null} title="Revisa y confirma" onClose={() => setScan(null)}>
                {scan && <Review scan={scan} data={data} run={run} mode={mode} onClose={() => setScan(null)} />}
            </Modal>
        </>
    );
}

/** Reparte el total entre los servicios: respeta los precios leídos y asigna el resto al primero sin precio. */
function allocate(matches: Match[], total: number | null): Record<string, string> {
    const out: Record<string, string> = {};
    const priced = matches.reduce((s, m) => s + (m.price ?? 0), 0);
    let rest = total !== null ? Math.max(0, total - priced) : 0;
    for (const m of matches) {
        let v = m.price ?? 0;
        if (m.price === null && rest > 0) {
            v = rest;
            rest = 0;
        }
        out[m.id] = v ? String(Math.round(v)) : '';
    }
    if (rest > 0 && matches.length) {
        const first = matches[0].id;
        out[first] = String(Math.round((parseNum(out[first]) ?? 0) + rest));
    }
    return out;
}

function Review({
    scan,
    data,
    run,
    mode,
    onClose,
}: {
    scan: Scan;
    data: Full;
    run: Run;
    mode: Mode;
    onClose: () => void;
}) {
    const categories = [...data.expenseCategories, 'Gasolina'];
    const [category, setCategory] = useState(scan.category);
    const [amount, setAmount] = useState(scan.total ? String(scan.total) : '');
    const [date, setDate] = useState(scan.date ?? todayLocal());
    const [note, setNote] = useState([scan.merchant, scan.summary].filter(Boolean).join(' · '));
    const [km, setKm] = useState(scan.odometer ? String(scan.odometer) : '');
    const [gallons, setGallons] = useState(
        scan.gallons
            ? String(scan.gallons)
            : scan.total && scan.pricePerGallon
              ? (scan.total / scan.pricePerGallon).toFixed(3)
              : '',
    );
    // Servicios de taller: los detectados empiezan marcados, pero nada se guarda sin confirmar.
    const [services, setServices] = useState<Match[]>(scan.maintMatches);
    const [checked, setChecked] = useState<Record<string, boolean>>(
        Object.fromEntries(scan.maintMatches.map((m) => [m.id, true])),
    );
    const [costs, setCosts] = useState<Record<string, string>>(allocate(scan.maintMatches, scan.total));
    const [adding, setAdding] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const selected = services.filter((s) => checked[s.id]);
    const asService = mode === 'maint' || selected.length > 0;
    const isFuel = !asService && category === 'Gasolina';
    const available = useMemo(
        () => data.items.filter((i) => !services.some((s) => s.id === i.id)),
        [data.items, services],
    );
    const costSum = selected.reduce((s, m) => s + (parseNum(costs[m.id] ?? '') ?? 0), 0);

    const addService = (id: string) => {
        const it = data.items.find((i) => i.id === id);
        if (!it) return;
        setServices((s) => [...s, { id: it.id, name: it.name, price: null }]);
        setChecked((c) => ({ ...c, [it.id]: true }));
        setAdding('');
    };

    const validate = (): boolean => {
        const errs: Record<string, string> = {};
        const a = parseNum(amount);
        if (!asService && (a === null || a <= 0)) errs.amount = 'Revisa el valor.';
        if (asService) {
            if (selected.length === 0) errs.services = 'Marca al menos un servicio que se haya hecho.';
            const k = parseNum(km);
            if (k === null || k < 0) errs.km = 'Escribe el kilometraje en que se hizo el servicio.';
        }
        if (isFuel) {
            const k = parseNum(km);
            const g = parseNum(gallons);
            if (k === null || k < 0) errs.km = 'Escribe el kilometraje del tablero.';
            if (g === null || g <= 0) errs.gallons = 'Escribe los galones.';
        }
        setErrors(errs);
        return Object.keys(errs).length === 0;
    };

    const save = async () => {
        if (!validate()) return;
        if (asService) {
            setConfirming(true);
            return;
        }
        setBusy(true);
        const a = parseNum(amount)!;
        const ok = isFuel
            ? await run(
                  api.post('/api/fuel', { date, km: parseNum(km), gallons: parseNum(gallons), total: a, fullTank: true }),
                  'Tanqueo registrado desde la factura',
              )
            : await run(api.post('/api/expenses', { date, category, amount: a, note }), 'Gasto registrado desde la factura');
        setBusy(false);
        if (ok) onClose();
    };

    const saveServices = async () => {
        setConfirming(false);
        setBusy(true);
        const ok = await run(
            api.post('/api/maint/done-batch', {
                km: parseNum(km),
                date,
                notes: note,
                items: selected.map((s) => ({ id: s.id, cost: parseNum(costs[s.id] ?? '') ?? 0 })),
            }),
            selected.length === 1 ? 'Servicio registrado en Taller' : `${selected.length} servicios registrados en Taller`,
        );
        setBusy(false);
        if (ok) onClose();
    };

    return (
        <div className="space-y-4">
            {mode === 'expense' && !asService && (
                <div>
                    <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Categoría</div>
                    <div className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1" role="radiogroup" aria-label="Categoría">
                        {categories.map((c) => (
                            <button
                                key={c}
                                type="button"
                                role="radio"
                                aria-checked={category === c}
                                onClick={() => setCategory(c)}
                                className={`shrink-0 snap-start rounded-full px-3 py-1.5 text-sm font-semibold ${
                                    category === c
                                        ? 'bg-red-600 text-white'
                                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                                }`}
                            >
                                {c === 'Gasolina' ? '⛽ Gasolina' : c}
                            </button>
                        ))}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Desliza para cambiar la categoría.</p>
                </div>
            )}

            <Field label={asService ? 'Total de la factura (COP)' : 'Valor (COP)'} error={errors.amount}>
                <input
                    className={`${inputCls} text-2xl font-bold`}
                    inputMode="numeric"
                    aria-label="Valor de la factura"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                />
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha" className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                {(asService || isFuel) && (
                    <Field
                        label="Kilometraje"
                        error={errors.km}
                        className="col-span-2 sm:col-span-1"
                        hint={scan.odometer ? 'Leído de la factura' : `Actual: ${fmtKm(data.profile.currentKm)}`}
                    >
                        <input
                            className={inputCls}
                            inputMode="numeric"
                            aria-label="Kilometraje del servicio"
                            placeholder={String(Math.round(data.profile.currentKm))}
                            value={km}
                            onChange={(e) => setKm(e.target.value)}
                        />
                    </Field>
                )}
                {!isFuel && (
                    <Field label="Nota" className="col-span-2">
                        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                )}
            </div>

            {(mode === 'maint' || services.length > 0) && (
                <div className="space-y-2 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Wrench size={16} className="text-red-600" />
                        {services.length ? 'Servicios detectados en la factura' : 'Servicios hechos'}
                    </div>
                    {mode === 'expense' && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Si los dejas marcados se registran en Taller con su costo (en vez de un gasto suelto).
                            Desmárcalos para guardarlo solo como gasto.
                        </p>
                    )}
                    {services.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    className="h-5 w-5 shrink-0 accent-red-600"
                                    checked={!!checked[s.id]}
                                    onChange={(e) => setChecked((c) => ({ ...c, [s.id]: e.target.checked }))}
                                />
                                <span className="truncate">{s.name}</span>
                            </label>
                            <input
                                className={`${inputCls} !w-28 !py-1.5 text-right text-sm`}
                                inputMode="numeric"
                                aria-label={`Costo de ${s.name}`}
                                placeholder="$0"
                                value={costs[s.id] ?? ''}
                                disabled={!checked[s.id]}
                                onChange={(e) => setCosts((c) => ({ ...c, [s.id]: e.target.value }))}
                            />
                        </div>
                    ))}
                    {available.length > 0 && (
                        <select
                            className={`${inputCls} text-sm`}
                            aria-label="Agregar otro servicio"
                            value={adding}
                            onChange={(e) => addService(e.target.value)}
                        >
                            <option value="">+ Agregar otro servicio de la factura…</option>
                            {available.map((i) => (
                                <option key={i.id} value={i.id}>
                                    {i.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {selected.length > 0 && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Suma de costos: {fmtMoney(costSum)}
                            {parseNum(amount) !== null && Math.abs(costSum - parseNum(amount)!) >= 1
                                ? ` · total factura ${fmtMoney(parseNum(amount)!)}`
                                : ''}
                        </p>
                    )}
                    {errors.services && (
                        <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                            {errors.services}
                        </p>
                    )}
                </div>
            )}

            {isFuel && (
                <div className="space-y-3 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Fuel size={16} className="text-red-600" /> Se guardará como tanqueo
                    </div>
                    <Field
                        label="Galones"
                        error={errors.gallons}
                        hint={scan.pricePerGallon ? `Precio leído: ${fmtMoney(scan.pricePerGallon)}/gal` : undefined}
                    >
                        <input
                            className={inputCls}
                            inputMode="decimal"
                            aria-label="Galones"
                            value={gallons}
                            onChange={(e) => setGallons(e.target.value)}
                        />
                    </Field>
                    {parseNum(gallons) !== null && (
                        <p className="text-xs text-zinc-500">≈ {fmtNum(parseNum(gallons)! * 3.78541, 1)} litros</p>
                    )}
                </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Revisa los datos: la lectura automática puede equivocarse. Nada se guarda hasta que confirmes.
            </p>
            <div className="flex gap-2">
                <Btn variant="secondary" className="flex-1" onClick={onClose}>
                    Descartar
                </Btn>
                <Btn className="flex-1" onClick={save} disabled={busy}>
                    {busy
                        ? 'Guardando…'
                        : asService
                          ? `Confirmar ${selected.length || ''} servicio${selected.length === 1 ? '' : 's'}`
                          : 'Guardar'}
                </Btn>
            </div>

            <Confirm
                open={confirming}
                title="¿Se hicieron estos servicios?"
                confirmLabel="Sí, se hicieron"
                message={`Se marcarán como hechos a los ${fmtKm(parseNum(km) ?? 0)} y se reinicia su contador: ${selected
                    .map((s) => s.name)
                    .join(', ')}. Confirma solo si de verdad se realizaron.`}
                onCancel={() => setConfirming(false)}
                onConfirm={saveServices}
            />
        </div>
    );
}
