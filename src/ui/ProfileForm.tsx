import { useState } from 'react';
import type { FormEvent } from 'react';
import { Btn, Field, inputCls } from './components';
import { parseNum } from './lib';
import type { Profile } from './types';

export type ProfilePayload = {
    brand: string;
    model: string;
    cc: number;
    plate: string;
    year: number;
    matriculaDate: string;
    currentKm: number;
    avaluo: number;
    city: string;
    soatExpiry?: string;
    licenseExpiry?: string;
    taxDue?: string;
};

export default function ProfileForm({
    initial,
    onSubmit,
    submitLabel,
    showDocs,
}: {
    initial?: Profile;
    onSubmit: (p: ProfilePayload) => Promise<boolean>;
    submitLabel: string;
    showDocs?: boolean;
}) {
    const [brand, setBrand] = useState(initial?.brand ?? 'Hero');
    const [model, setModel] = useState(initial?.model ?? 'Hunk 160R 4V');
    const [cc, setCc] = useState(String(initial?.cc ?? 163));
    const [plate, setPlate] = useState(initial?.plate ?? '');
    const [year, setYear] = useState(initial?.year ? String(initial.year) : String(new Date().getFullYear()));
    const [matriculaDate, setMatriculaDate] = useState(initial?.matriculaDate ?? '');
    const [currentKm, setCurrentKm] = useState(initial ? String(initial.currentKm) : '');
    const [avaluo, setAvaluo] = useState(initial?.avaluo ? String(initial.avaluo) : '');
    const [city, setCity] = useState(initial?.city ?? '');
    const [soatExpiry, setSoatExpiry] = useState('');
    const [licenseExpiry, setLicenseExpiry] = useState('');
    const [taxDue, setTaxDue] = useState('');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        const ccN = parseNum(cc);
        const kmN = parseNum(currentKm);
        if (ccN === null || ccN <= 0) errs.cc = 'Escribe el cilindraje (por ejemplo 163).';
        if (kmN === null || kmN < 0) errs.currentKm = 'Escribe el kilometraje actual del tablero.';
        if (!matriculaDate) errs.matriculaDate = 'La fecha de matrícula es obligatoria.';
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setBusy(true);
        await onSubmit({
            brand,
            model,
            cc: ccN!,
            plate,
            year: parseNum(year) ?? 0,
            matriculaDate,
            currentKm: kmN!,
            avaluo: parseNum(avaluo) ?? 0,
            city,
            ...(showDocs ? { soatExpiry, licenseExpiry, taxDue } : {}),
        });
        setBusy(false);
    };

    const ccN = parseNum(cc);

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Marca">
                    <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} />
                </Field>
                <Field label="Modelo">
                    <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} />
                </Field>
                <Field label="Placa">
                    <input
                        className={`${inputCls} uppercase`}
                        value={plate}
                        placeholder="ABC12D"
                        onChange={(e) => setPlate(e.target.value)}
                    />
                </Field>
                <Field label="Año modelo">
                    <input className={inputCls} inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
                </Field>
                <Field label="Cilindraje (cc)" error={errors.cc}>
                    <input
                        className={inputCls}
                        inputMode="numeric"
                        aria-label="Cilindraje (cc)"
                        value={cc}
                        onChange={(e) => setCc(e.target.value)}
                    />
                </Field>
                <Field label="Kilometraje actual" error={errors.currentKm}>
                    <input
                        className={inputCls}
                        inputMode="numeric"
                        aria-label="Kilometraje actual"
                        value={currentKm}
                        placeholder="0"
                        onChange={(e) => setCurrentKm(e.target.value)}
                    />
                </Field>
            </div>
            {ccN !== null && ccN > 0 && (
                <p className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {ccN > 125
                        ? 'Con más de 125 cc tu moto paga impuesto vehicular y necesitas licencia A2.'
                        : 'Con 125 cc o menos no pagas impuesto vehicular (solo semaforización en algunos municipios) y basta licencia A1.'}
                </p>
            )}
            <Field
                label="Fecha de matrícula"
                error={errors.matriculaDate}
                hint="Con esta fecha calculo cuándo te toca la revisión técnico-mecánica."
            >
                <input
                    type="date"
                    className={inputCls}
                    aria-label="Fecha de matrícula"
                    value={matriculaDate}
                    onChange={(e) => setMatriculaDate(e.target.value)}
                />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Ciudad">
                    <input className={inputCls} value={city} placeholder="Bogotá" onChange={(e) => setCity(e.target.value)} />
                </Field>
                <Field label="Avalúo comercial (COP)" hint="Opcional, para estimar el impuesto.">
                    <input
                        className={inputCls}
                        inputMode="numeric"
                        value={avaluo}
                        placeholder="9000000"
                        onChange={(e) => setAvaluo(e.target.value)}
                    />
                </Field>
            </div>
            {showDocs && (
                <div className="space-y-3 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                    <p className="text-sm font-semibold">Vencimientos (opcional, puedes agregarlos después)</p>
                    <Field label="SOAT vence el">
                        <input type="date" className={inputCls} value={soatExpiry} onChange={(e) => setSoatExpiry(e.target.value)} />
                    </Field>
                    <Field label="Licencia de conducción vence el">
                        <input
                            type="date"
                            className={inputCls}
                            value={licenseExpiry}
                            onChange={(e) => setLicenseExpiry(e.target.value)}
                        />
                    </Field>
                    {ccN !== null && ccN > 125 && (
                        <Field label="Fecha límite del impuesto vehicular">
                            <input type="date" className={inputCls} value={taxDue} onChange={(e) => setTaxDue(e.target.value)} />
                        </Field>
                    )}
                </div>
            )}
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Guardando…' : submitLabel}
            </Btn>
        </form>
    );
}
