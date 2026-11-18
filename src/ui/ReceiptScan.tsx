import { useRef, useState } from 'react';
import { api, image } from '@appdeploy/client';
import { Camera, Fuel } from 'lucide-react';
import { Btn, Card, Field, Modal, inputCls } from './components';
import Cropper from './Cropper';
import { errMsg, fmtMoney, fmtNum, parseNum, todayLocal } from './lib';
import type { Full, Run } from './types';

type Scan = {
    merchant: string | null;
    date: string | null;
    total: number | null;
    category: string;
    gallons: number | null;
    pricePerGallon: number | null;
    summary: string | null;
};

/** Botón "Escanear factura": foto → recorte → IA → revisión rápida → guardar. */
export default function ReceiptScan({ data, run }: { data: Full; run: Run }) {
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
            setScan(r.data as Scan);
        } catch (e) {
            setErr(errMsg(e));
        }
        setReading(false);
    };

    return (
        <>
            <Card className="!p-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="font-semibold">Escanear factura</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                            Toma la foto del recibo y lleno el gasto por ti. Solo revisas y guardas.
                        </div>
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

            <Modal open={scan !== null} title="Revisa y guarda" onClose={() => setScan(null)}>
                {scan && <Review scan={scan} data={data} run={run} onClose={() => setScan(null)} />}
            </Modal>
        </>
    );
}

function Review({ scan, data, run, onClose }: { scan: Scan; data: Full; run: Run; onClose: () => void }) {
    const categories = [...data.expenseCategories, 'Gasolina'];
    const [category, setCategory] = useState(scan.category);
    const [amount, setAmount] = useState(scan.total ? String(scan.total) : '');
    const [date, setDate] = useState(scan.date ?? todayLocal());
    const [note, setNote] = useState([scan.merchant, scan.summary].filter(Boolean).join(' · '));
    const [km, setKm] = useState('');
    const [gallons, setGallons] = useState(
        scan.gallons
            ? String(scan.gallons)
            : scan.total && scan.pricePerGallon
              ? (scan.total / scan.pricePerGallon).toFixed(3)
              : '',
    );
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);
    const isFuel = category === 'Gasolina';

    const save = async () => {
        const errs: Record<string, string> = {};
        const a = parseNum(amount);
        if (a === null || a <= 0) errs.amount = 'Revisa el valor.';
        let kmN: number | null = null;
        let gal: number | null = null;
        if (isFuel) {
            kmN = parseNum(km);
            gal = parseNum(gallons);
            if (kmN === null || kmN < 0) errs.km = 'Escribe el kilometraje del tablero.';
            if (gal === null || gal <= 0) errs.gallons = 'Escribe los galones.';
        }
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setBusy(true);
        const ok = isFuel
            ? await run(
                  api.post('/api/fuel', { date, km: kmN, gallons: gal, total: a, fullTank: true }),
                  'Tanqueo registrado desde la factura',
              )
            : await run(api.post('/api/expenses', { date, category, amount: a, note }), 'Gasto registrado desde la factura');
        setBusy(false);
        if (ok) onClose();
    };

    return (
        <div className="space-y-4">
            <div>
                <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Categoría</div>
                <div
                    className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1"
                    role="radiogroup"
                    aria-label="Categoría"
                >
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

            <Field label="Valor (COP)" error={errors.amount}>
                <input
                    className={`${inputCls} text-2xl font-bold`}
                    inputMode="numeric"
                    aria-label="Valor de la factura"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                />
            </Field>
            {parseNum(amount) !== null && (
                <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">{fmtMoney(parseNum(amount)!)}</p>
            )}

            <div className="grid grid-cols-2 gap-3">
                <Field label="Fecha" className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                {!isFuel && (
                    <Field label="Nota" className="col-span-2 sm:col-span-1">
                        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                )}
            </div>

            {isFuel && (
                <div className="space-y-3 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Fuel size={16} className="text-red-600" /> Se guardará como tanqueo
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Kilometraje" error={errors.km} className="col-span-2 sm:col-span-1">
                            <input
                                className={inputCls}
                                inputMode="numeric"
                                aria-label="Kilometraje del tanqueo"
                                placeholder={String(Math.round(data.profile.currentKm))}
                                value={km}
                                onChange={(e) => setKm(e.target.value)}
                            />
                        </Field>
                        <Field
                            label="Galones"
                            error={errors.gallons}
                            className="col-span-2 sm:col-span-1"
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
                    </div>
                    {parseNum(gallons) !== null && (
                        <p className="text-xs text-zinc-500">≈ {fmtNum(parseNum(gallons)! * 3.78541, 1)} litros</p>
                    )}
                </div>
            )}

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Revisa el valor y la categoría: la lectura automática puede equivocarse.
            </p>
            <div className="flex gap-2">
                <Btn variant="secondary" className="flex-1" onClick={onClose}>
                    Descartar
                </Btn>
                <Btn className="flex-1" onClick={save} disabled={busy}>
                    {busy ? 'Guardando…' : 'Guardar'}
                </Btn>
            </div>
        </div>
    );
}
