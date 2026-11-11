import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { Pencil, Plus, Trash2, Landmark, CreditCard, Bell } from 'lucide-react';
import { Btn, Card, Chip, Confirm, Field, Modal, SectionTitle, inputCls } from './components';
import { daysText, fmtDate, fmtMoney } from './lib';
import type { DocView, Full, Run } from './types';

const TYPES: Array<{ value: string; label: string }> = [
    { value: 'SOAT', label: 'SOAT' },
    { value: 'RTM', label: 'Revisión técnico-mecánica' },
    { value: 'LICENCIA', label: 'Licencia de conducción' },
    { value: 'IMPUESTO', label: 'Impuesto vehicular' },
    { value: 'OTRO', label: 'Otro' },
];

function DocForm({
    initial,
    rtmSuggested,
    onSave,
}: {
    initial?: DocView;
    rtmSuggested: string | null;
    onSave: (d: { type: string; name: string; expiry: string; notes: string }) => Promise<boolean>;
}) {
    const [type, setType] = useState(initial?.type ?? 'SOAT');
    const [name, setName] = useState(initial?.name ?? '');
    const [expiry, setExpiry] = useState(initial?.expiry ?? '');
    const [notes, setNotes] = useState(initial?.notes ?? '');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!expiry) {
            setErr('La fecha de vencimiento es obligatoria.');
            return;
        }
        setErr('');
        setBusy(true);
        await onSave({ type, name, expiry, notes });
        setBusy(false);
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Tipo">
                <select className={inputCls} aria-label="Tipo" value={type} onChange={(e) => setType(e.target.value)}>
                    {TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                            {t.label}
                        </option>
                    ))}
                </select>
            </Field>
            <Field label="Nombre (opcional)">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
                label="Fecha de vencimiento"
                error={err}
                hint={
                    type === 'RTM' && rtmSuggested ? (
                        <button type="button" className="font-semibold text-red-600" onClick={() => setExpiry(rtmSuggested)}>
                            Usar fecha sugerida: {fmtDate(rtmSuggested)}
                        </button>
                    ) : undefined
                }
            >
                <input
                    type="date"
                    className={inputCls}
                    aria-label="Fecha de vencimiento"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                />
            </Field>
            <Field label="Notas">
                <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Guardando…' : 'Guardar documento'}
            </Btn>
        </form>
    );
}

export default function Legal({ data, run }: { data: Full; run: Run }) {
    const [editing, setEditing] = useState<DocView | 'new' | null>(null);
    const [deleting, setDeleting] = useState<DocView | null>(null);
    const { tax } = data;

    const save = async (d: { type: string; name: string; expiry: string; notes: string }) => {
        const ok =
            editing && editing !== 'new'
                ? await run(api.put(`/api/docs/${editing.id}`, d), 'Documento actualizado')
                : await run(api.post('/api/docs', d), 'Documento agregado');
        if (ok) setEditing(null);
        return ok;
    };

    return (
        <div>
            <Card>
                <div className="flex items-center gap-2 font-semibold">
                    <Landmark size={18} className="text-red-600" /> {tax.title}
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{tax.detail}</p>
                {tax.regime === 'impuesto' && (
                    <p className="mt-2 text-sm">
                        {tax.estimate !== null ? (
                            <>
                                Estimado según tu avalúo: <b>{fmtMoney(tax.estimate)}</b>
                            </>
                        ) : (
                            'Agrega el avalúo comercial en Ajustes para estimar el valor.'
                        )}
                    </p>
                )}
            </Card>

            <Card className="mt-3">
                <div className="flex items-center gap-2 font-semibold">
                    <CreditCard size={18} className="text-red-600" /> Licencia requerida: {tax.license}
                </div>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    {tax.licenseDetail} Si tienes menos de 60 años la licencia de servicio particular se refrenda cada 10
                    años.
                </p>
            </Card>

            <SectionTitle
                action={
                    <Btn variant="secondary" onClick={() => setEditing('new')} className="!py-1.5">
                        <Plus size={16} /> Agregar
                    </Btn>
                }
            >
                Documentos
            </SectionTitle>

            <p className="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <Bell size={14} /> Te avisamos 15, 5 y 1 día antes de cada vencimiento.
            </p>

            {data.docs.length === 0 && (
                <Card>
                    <p className="text-sm">Aún no tienes documentos. Agrega tu SOAT para empezar.</p>
                </Card>
            )}

            <div className="space-y-2">
                {data.docs.map((d) => (
                    <Card key={d.id} className="!p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{d.type}</div>
                                <div className="font-semibold">{d.name}</div>
                                <div className="text-sm text-zinc-600 dark:text-zinc-300">
                                    {fmtDate(d.expiry)} · {daysText(d.daysLeft)}
                                </div>
                                {d.notes && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{d.notes}</div>}
                            </div>
                            <Chip status={d.status} />
                        </div>
                        <div className="mt-2 flex justify-end gap-1">
                            <Btn variant="ghost" className="!px-2 !py-1.5" onClick={() => setEditing(d)} ariaLabel={`Editar ${d.name}`}>
                                <Pencil size={16} />
                            </Btn>
                            <Btn variant="ghost" className="!px-2 !py-1.5" onClick={() => setDeleting(d)} ariaLabel={`Eliminar ${d.name}`}>
                                <Trash2 size={16} />
                            </Btn>
                        </div>
                    </Card>
                ))}
            </div>

            <Modal
                open={editing !== null}
                title={editing && editing !== 'new' ? 'Editar documento' : 'Nuevo documento'}
                onClose={() => setEditing(null)}
            >
                {editing !== null && (
                    <DocForm
                        key={editing === 'new' ? 'new' : editing.id}
                        initial={editing === 'new' ? undefined : editing}
                        rtmSuggested={data.rtmSuggested}
                        onSave={save}
                    />
                )}
            </Modal>

            <Confirm
                open={deleting !== null}
                title="Eliminar documento"
                message={`¿Seguro que quieres eliminar "${deleting?.name ?? ''}"? Esta acción no se puede deshacer.`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const d = deleting;
                    setDeleting(null);
                    if (d) await run(api.delete(`/api/docs/${d.id}`), 'Documento eliminado');
                }}
            />
        </div>
    );
}
