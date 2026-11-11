import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { Check, Pencil, Plus } from 'lucide-react';
import { Btn, Card, Chip, Confirm, Field, Modal, Progress, SectionTitle, inputCls } from './components';
import { fmtDate, fmtKm, fmtMoney, parseNum, todayLocal } from './lib';
import type { Full, ItemView, Run } from './types';

const CATEGORIES = ['Fluidos', 'Filtros y bujía', 'Kit de arrastre', 'Frenos y llantas', 'Sincronización', 'Otros'];

function DoneForm({
    item,
    currentKm,
    onSave,
}: {
    item: ItemView;
    currentKm: number;
    onSave: (d: { km: number; date: string; cost: number; notes: string }) => Promise<boolean>;
}) {
    const [km, setKm] = useState(String(Math.round(currentKm)));
    const [date, setDate] = useState(todayLocal());
    const [cost, setCost] = useState('');
    const [notes, setNotes] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const n = parseNum(km);
        if (n === null || n < 0) {
            setErr('Escribe el kilometraje del servicio.');
            return;
        }
        setErr('');
        setBusy(true);
        await onSave({ km: n, date, cost: parseNum(cost) ?? 0, notes });
        setBusy(false);
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{item.name}</p>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Kilometraje" error={err} className="col-span-2 sm:col-span-1">
                    <input className={inputCls} inputMode="numeric" aria-label="Kilometraje del servicio" value={km} onChange={(e) => setKm(e.target.value)} />
                </Field>
                <Field label="Fecha" className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
            </div>
            <Field label="Costo (COP)">
                <input className={inputCls} inputMode="numeric" aria-label="Costo" value={cost} placeholder="0" onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field label="Notas">
                <input className={inputCls} value={notes} placeholder="Marca del aceite, taller…" onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Guardando…' : 'Registrar servicio'}
            </Btn>
        </form>
    );
}

type ItemPayload = {
    name: string;
    category: string;
    intervalKm: number;
    intervalDays: number;
    lastKm: number;
    lastDate: string;
    notes: string;
};

function ItemForm({
    initial,
    currentKm,
    onSave,
    onDelete,
}: {
    initial?: ItemView;
    currentKm: number;
    onSave: (d: ItemPayload) => Promise<boolean>;
    onDelete?: () => void;
}) {
    const [name, setName] = useState(initial?.name ?? '');
    const [category, setCategory] = useState(initial?.category ?? 'Otros');
    const [intervalKm, setIntervalKm] = useState(initial ? String(initial.intervalKm) : '');
    const [intervalDays, setIntervalDays] = useState(initial ? String(initial.intervalDays) : '');
    const [lastKm, setLastKm] = useState(String(Math.round(initial?.lastKm ?? currentKm)));
    const [lastDate, setLastDate] = useState(initial?.lastDate ?? todayLocal());
    const [notes, setNotes] = useState(initial?.notes ?? '');
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const errs: Record<string, string> = {};
        const ik = parseNum(intervalKm) ?? 0;
        const id = parseNum(intervalDays) ?? 0;
        const lk = parseNum(lastKm);
        if (!name.trim()) errs.name = 'El nombre es obligatorio.';
        if (ik <= 0 && id <= 0) errs.interval = 'Define un intervalo en km o en días.';
        if (lk === null || lk < 0) errs.lastKm = 'Kilometraje no válido.';
        if (!lastDate) errs.lastDate = 'La fecha es obligatoria.';
        setErrors(errs);
        if (Object.keys(errs).length) return;
        setBusy(true);
        await onSave({ name, category, intervalKm: ik, intervalDays: id, lastKm: lk!, lastDate, notes });
        setBusy(false);
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Nombre" error={errors.name}>
                <input className={inputCls} aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Categoría">
                <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                    ))}
                </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Cada (km)" error={errors.interval}>
                    <input className={inputCls} inputMode="numeric" value={intervalKm} placeholder="0 = no aplica" onChange={(e) => setIntervalKm(e.target.value)} />
                </Field>
                <Field label="Cada (días)">
                    <input className={inputCls} inputMode="numeric" value={intervalDays} placeholder="0 = no aplica" onChange={(e) => setIntervalDays(e.target.value)} />
                </Field>
                <Field label="Último cambio (km)" error={errors.lastKm}>
                    <input className={inputCls} inputMode="numeric" value={lastKm} onChange={(e) => setLastKm(e.target.value)} />
                </Field>
                <Field label="Fecha último cambio" error={errors.lastDate} className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
                </Field>
            </div>
            <Field label="Notas">
                <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Guardando…' : 'Guardar'}
            </Btn>
            {onDelete && (
                <Btn variant="danger" onClick={onDelete} className="w-full">
                    Eliminar de la lista
                </Btn>
            )}
        </form>
    );
}

function remainingText(i: ItemView): string {
    const parts: string[] = [];
    if (i.kmLeft !== null) parts.push(i.kmLeft > 0 ? `Faltan ${fmtKm(i.kmLeft)}` : `Pasado por ${fmtKm(-i.kmLeft)}`);
    if (i.dueDate) parts.push(`Fecha estimada ${fmtDate(i.dueDate)}`);
    return parts.join(' · ') || 'Sin datos suficientes';
}

function intervalText(i: ItemView): string {
    const parts: string[] = [];
    if (i.intervalKm > 0) parts.push(`cada ${fmtKm(i.intervalKm)}`);
    if (i.intervalDays > 0) parts.push(`cada ${i.intervalDays} días`);
    return parts.join(' o ');
}

export default function Maint({ data, run }: { data: Full; run: Run }) {
    const [done, setDone] = useState<ItemView | null>(null);
    const [editing, setEditing] = useState<ItemView | 'new' | null>(null);
    const [deleting, setDeleting] = useState<ItemView | null>(null);
    const currentKm = data.profile.currentKm;

    const groups = CATEGORIES.map((c) => ({ c, items: data.items.filter((i) => (i.category || 'Otros') === c) }))
        .concat([{ c: '', items: data.items.filter((i) => !CATEGORIES.includes(i.category || 'Otros')) }])
        .filter((g) => g.items.length > 0);

    return (
        <div>
            <p className="rounded-2xl bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300">
                Intervalos de referencia para la Hunk 160R 4V. Ajústalos según tu manual y tu taller. Esta moto es
                refrigerada por aire y aceite, así que no lleva líquido refrigerante.
            </p>

            {groups.map((g) => (
                <div key={g.c || 'otros'}>
                    <SectionTitle>{g.c || 'Otros'}</SectionTitle>
                    <div className="space-y-2">
                        {g.items.map((i) => (
                            <Card key={i.id} className="!p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="font-semibold">{i.name}</div>
                                        <div className="text-xs text-zinc-500 dark:text-zinc-400">{intervalText(i)}</div>
                                    </div>
                                    <Chip status={i.status} />
                                </div>
                                <div className="my-2">
                                    <Progress value={i.progress} status={i.status} />
                                </div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-300">{remainingText(i)}</div>
                                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                    Último: {fmtKm(i.lastKm)} · {fmtDate(i.lastDate)}
                                </div>
                                <div className="mt-2 flex justify-end gap-1">
                                    <Btn variant="ghost" className="!px-2 !py-1.5" onClick={() => setEditing(i)} ariaLabel={`Editar ${i.name}`}>
                                        <Pencil size={16} />
                                    </Btn>
                                    <Btn variant="secondary" className="!py-1.5" onClick={() => setDone(i)} ariaLabel={`Marcar hecho ${i.name}`}>
                                        <Check size={16} /> Hecho
                                    </Btn>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>
            ))}

            <Btn variant="secondary" className="mt-4 w-full" onClick={() => setEditing('new')}>
                <Plus size={16} /> Agregar elemento
            </Btn>

            <SectionTitle>Historial de servicios</SectionTitle>
            {data.services.length === 0 ? (
                <Card>
                    <p className="text-sm">Cuando marques un mantenimiento como hecho aparecerá aquí.</p>
                </Card>
            ) : (
                <div className="space-y-2">
                    {data.services.map((s) => (
                        <Card key={s.id} className="!p-3">
                            <div className="flex justify-between gap-2">
                                <div className="font-semibold">{s.itemName}</div>
                                {s.cost > 0 && <div className="text-sm font-semibold">{fmtMoney(s.cost)}</div>}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400">
                                {fmtDate(s.date)} · {fmtKm(s.km)}
                                {s.notes ? ` · ${s.notes}` : ''}
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <Modal open={done !== null} title="Registrar mantenimiento" onClose={() => setDone(null)}>
                {done && (
                    <DoneForm
                        key={done.id}
                        item={done}
                        currentKm={currentKm}
                        onSave={async (d) => {
                            const ok = await run(api.post(`/api/maint/${done.id}/done`, d), 'Mantenimiento registrado');
                            if (ok) setDone(null);
                            return ok;
                        }}
                    />
                )}
            </Modal>

            <Modal
                open={editing !== null}
                title={editing && editing !== 'new' ? 'Editar elemento' : 'Nuevo elemento'}
                onClose={() => setEditing(null)}
            >
                {editing !== null && (
                    <ItemForm
                        key={editing === 'new' ? 'new' : editing.id}
                        initial={editing === 'new' ? undefined : editing}
                        currentKm={currentKm}
                        onDelete={
                            editing === 'new'
                                ? undefined
                                : () => {
                                      setDeleting(editing);
                                      setEditing(null);
                                  }
                        }
                        onSave={async (d) => {
                            const ok =
                                editing === 'new'
                                    ? await run(api.post('/api/maint', d), 'Elemento agregado')
                                    : await run(api.put(`/api/maint/${editing.id}`, d), 'Cambios guardados');
                            if (ok) setEditing(null);
                            return ok;
                        }}
                    />
                )}
            </Modal>

            <Confirm
                open={deleting !== null}
                title="Eliminar elemento"
                message={`¿Quitar "${deleting?.name ?? ''}" de tu plan de mantenimiento?`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const d = deleting;
                    setDeleting(null);
                    if (d) await run(api.delete(`/api/maint/${d.id}`), 'Elemento eliminado');
                }}
            />
        </div>
    );
}
