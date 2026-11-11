import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, image } from '@appdeploy/client';
import { CloudOff, FileText, ScanText, Trash2, Upload, Eye } from 'lucide-react';
import { Btn, Card, Confirm, Field, Modal, inputCls } from './components';
import { errMsg, fmtDate } from './lib';
import { base64ToBlob, blobToBase64, deleteFile, getFile, getMeta, putFile, putMeta } from './vaultStore';
import type { Full, Run, VaultItem } from './types';

const KINDS: Array<{ value: string; label: string }> = [
    { value: 'SOAT', label: 'SOAT' },
    { value: 'TARJETA', label: 'Tarjeta de propiedad' },
    { value: 'LICENCIA', label: 'Licencia de conducción' },
    { value: 'RTM', label: 'Certificado técnico-mecánica' },
    { value: 'OTRO', label: 'Otro' },
];
const READABLE = ['SOAT', 'RTM', 'LICENCIA'];
const MAX_PDF_BYTES = 3_500_000;

type Extracted = {
    documentType: string;
    expiryDate: string | null;
    startDate: string | null;
    plate: string | null;
    documentNumber: string | null;
    issuer: string | null;
};

function fmtBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export default function Vault({
    data,
    run,
    userId,
    notify,
}: {
    data: Full;
    run: Run;
    userId: string;
    notify: (kind: 'ok' | 'error', text: string) => void;
}) {
    const [items, setItems] = useState<VaultItem[]>([]);
    const [urls, setUrls] = useState<Record<string, string>>({});
    const [online, setOnline] = useState(true);
    const [adding, setAdding] = useState(false);
    const [viewing, setViewing] = useState<VaultItem | null>(null);
    const [deleting, setDeleting] = useState<VaultItem | null>(null);
    const [reading, setReading] = useState<string | null>(null);
    const [found, setFound] = useState<{ item: VaultItem; result: Extracted } | null>(null);
    const urlsRef = useRef<Record<string, string>>({});

    const attach = (id: string, blob: Blob) => {
        if (urlsRef.current[id]) return;
        const u = URL.createObjectURL(blob);
        urlsRef.current = { ...urlsRef.current, [id]: u };
        setUrls(urlsRef.current);
    };

    const detach = (id: string) => {
        const u = urlsRef.current[id];
        if (u) URL.revokeObjectURL(u);
        const next = { ...urlsRef.current };
        delete next[id];
        urlsRef.current = next;
        setUrls(next);
    };

    useEffect(() => {
        let alive = true;
        (async () => {
            const meta = (await getMeta(userId)) ?? [];
            if (!alive) return;
            setItems(meta);
            for (const it of meta) {
                const b = await getFile(it.id);
                if (b && alive) attach(it.id, b);
            }
            try {
                const r = await api.get('/api/vault');
                const list = ((r.data as { items?: VaultItem[] })?.items ?? []) as VaultItem[];
                if (!alive) return;
                setItems(list);
                setOnline(true);
                await putMeta(userId, list);
                for (const it of list) {
                    if (urlsRef.current[it.id]) continue;
                    const cached = await getFile(it.id);
                    if (cached) {
                        attach(it.id, cached);
                        continue;
                    }
                    try {
                        const f = await api.get(`/api/vault/${it.id}/file`);
                        const fd = f.data as { data: string; mimeType: string };
                        const blob = base64ToBlob(fd.data, fd.mimeType);
                        await putFile(it.id, blob);
                        if (alive) attach(it.id, blob);
                    } catch {
                        /* se reintenta en la próxima apertura */
                    }
                }
            } catch {
                if (alive) setOnline(false);
            }
        })();
        return () => {
            alive = false;
            Object.values(urlsRef.current).forEach((u) => URL.revokeObjectURL(u));
            urlsRef.current = {};
        };
    }, [userId]);

    const readDoc = async (item: VaultItem) => {
        setReading(item.id);
        try {
            const r = await api.post(`/api/vault/${item.id}/extract`);
            const result = r.data as Extracted;
            if (!result.expiryDate) {
                notify('error', 'No encontré una fecha de vencimiento en la foto.');
            } else {
                setFound({ item, result });
            }
        } catch (e) {
            notify('error', errMsg(e));
        }
        setReading(null);
    };

    const applyExpiry = async () => {
        if (!found || !found.result.expiryDate) return;
        const type = READABLE.includes(found.result.documentType)
            ? found.result.documentType
            : READABLE.includes(found.item.kind)
              ? found.item.kind
              : 'OTRO';
        const existing = data.docs.find((d) => d.type === type);
        const notes = [found.result.issuer, found.result.documentNumber ? `N.º ${found.result.documentNumber}` : null]
            .filter(Boolean)
            .join(' · ');
        const body = {
            type,
            name: existing?.name ?? '',
            expiry: found.result.expiryDate,
            notes: notes || existing?.notes || '',
        };
        const ok = existing
            ? await run(api.put(`/api/docs/${existing.id}`, body), 'Vencimiento actualizado')
            : await run(api.post('/api/docs', body), 'Vencimiento agregado');
        if (ok) setFound(null);
    };

    const onUploaded = async (id: string, list: VaultItem[], blob: Blob) => {
        await putFile(id, blob);
        attach(id, blob);
        setItems(list);
        await putMeta(userId, list);
        setAdding(false);
        notify('ok', 'Documento guardado en la bóveda');
        const item = list.find((i) => i.id === id);
        if (item && item.mimeType.startsWith('image/') && READABLE.includes(item.kind)) {
            void readDoc(item);
        }
    };

    const plate = data.profile.plate.replace(/\s/g, '').toUpperCase();
    const foundPlate = found?.result.plate?.replace(/[\s-]/g, '').toUpperCase() ?? '';

    return (
        <div>
            <Card className="!p-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Guarda fotos o PDF de tus documentos. Quedan copiados en este celular para mostrarlos en un retén aunque
                    no tengas datos.
                </p>
                {!online && (
                    <p className="mt-2 flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                        <CloudOff size={14} /> Sin conexión: mostrando la copia guardada en el celular.
                    </p>
                )}
                <Btn className="mt-3 w-full" onClick={() => setAdding(true)} disabled={!online}>
                    <Upload size={16} /> Agregar documento
                </Btn>
            </Card>

            {items.length === 0 ? (
                <Card className="mt-3">
                    <p className="text-sm">Tu bóveda está vacía. Empieza con el SOAT y la tarjeta de propiedad.</p>
                </Card>
            ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                    {items.map((it) => {
                        const url = urls[it.id];
                        const isImg = it.mimeType.startsWith('image/');
                        return (
                            <Card key={it.id} className="!p-2">
                                <button
                                    type="button"
                                    onClick={() => setViewing(it)}
                                    className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800"
                                    aria-label={`Ver ${it.title}`}
                                >
                                    {url && isImg ? (
                                        <img src={url} alt={it.title} className="h-full w-full object-cover" />
                                    ) : (
                                        <FileText size={36} className="text-zinc-400" />
                                    )}
                                </button>
                                <div className="mt-2 truncate text-sm font-semibold">{it.title}</div>
                                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {fmtDate(it.createdAt.slice(0, 10))} · {fmtBytes(it.bytes)}
                                </div>
                                <div className={`text-[11px] font-semibold ${url ? 'text-emerald-600' : 'text-zinc-400'}`}>
                                    {url ? 'Disponible sin conexión' : 'Descargando…'}
                                </div>
                                <div className="mt-1 flex justify-end gap-1">
                                    {isImg && READABLE.includes(it.kind) && (
                                        <Btn
                                            variant="ghost"
                                            className="!px-2 !py-1"
                                            onClick={() => readDoc(it)}
                                            disabled={!online || reading !== null}
                                            ariaLabel={`Leer fecha de ${it.title}`}
                                        >
                                            <ScanText size={16} />
                                        </Btn>
                                    )}
                                    <Btn
                                        variant="ghost"
                                        className="!px-2 !py-1"
                                        onClick={() => setDeleting(it)}
                                        disabled={!online}
                                        ariaLabel={`Eliminar ${it.title}`}
                                    >
                                        <Trash2 size={16} />
                                    </Btn>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            {reading && (
                <div
                    role="status"
                    className="fixed inset-x-0 bottom-20 z-40 mx-auto w-fit rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
                >
                    Leyendo el documento con IA…
                </div>
            )}

            <Modal open={adding} title="Agregar a la bóveda" onClose={() => setAdding(false)}>
                {adding && <UploadForm onUploaded={onUploaded} />}
            </Modal>

            <Modal open={viewing !== null} title={viewing?.title ?? ''} onClose={() => setViewing(null)}>
                {viewing &&
                    (urls[viewing.id] ? (
                        viewing.mimeType.startsWith('image/') ? (
                            <img src={urls[viewing.id]} alt={viewing.title} className="w-full rounded-xl" />
                        ) : (
                            <Btn className="w-full" onClick={() => window.open(urls[viewing.id], '_blank')}>
                                <Eye size={16} /> Abrir PDF
                            </Btn>
                        )
                    ) : (
                        <p className="text-sm">El archivo aún se está descargando. Intenta de nuevo en un momento.</p>
                    ))}
            </Modal>

            <Modal open={found !== null} title="Esto leí en tu documento" onClose={() => setFound(null)}>
                {found && (
                    <div className="space-y-3">
                        <dl className="grid grid-cols-2 gap-2 text-sm">
                            <dt className="text-zinc-500">Tipo</dt>
                            <dd className="font-semibold">{found.result.documentType}</dd>
                            <dt className="text-zinc-500">Vence</dt>
                            <dd className="font-semibold">{found.result.expiryDate ? fmtDate(found.result.expiryDate) : '—'}</dd>
                            {found.result.issuer && (
                                <>
                                    <dt className="text-zinc-500">Entidad</dt>
                                    <dd>{found.result.issuer}</dd>
                                </>
                            )}
                            {found.result.documentNumber && (
                                <>
                                    <dt className="text-zinc-500">Número</dt>
                                    <dd className="break-all">{found.result.documentNumber}</dd>
                                </>
                            )}
                            {found.result.plate && (
                                <>
                                    <dt className="text-zinc-500">Placa</dt>
                                    <dd>{found.result.plate}</dd>
                                </>
                            )}
                        </dl>
                        {plate && foundPlate && plate !== foundPlate && (
                            <p className="rounded-xl bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                                Ojo: la placa del documento no coincide con la de tu moto ({data.profile.plate}).
                            </p>
                        )}
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Revisa que la fecha sea correcta antes de guardarla: la lectura automática puede equivocarse.
                        </p>
                        <div className="flex gap-2">
                            <Btn variant="secondary" className="flex-1" onClick={() => setFound(null)}>
                                Ignorar
                            </Btn>
                            <Btn className="flex-1" onClick={applyExpiry}>
                                Guardar vencimiento
                            </Btn>
                        </div>
                    </div>
                )}
            </Modal>

            <Confirm
                open={deleting !== null}
                title="Eliminar de la bóveda"
                message={`¿Eliminar "${deleting?.title ?? ''}"? Se borra de la nube y de este celular.`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const it = deleting;
                    setDeleting(null);
                    if (!it) return;
                    try {
                        const r = await api.delete(`/api/vault/${it.id}`);
                        const list = ((r.data as { items?: VaultItem[] })?.items ?? []) as VaultItem[];
                        await deleteFile(it.id);
                        detach(it.id);
                        setItems(list);
                        await putMeta(userId, list);
                        notify('ok', 'Documento eliminado');
                    } catch (e) {
                        notify('error', errMsg(e));
                    }
                }}
            />
        </div>
    );
}

function UploadForm({ onUploaded }: { onUploaded: (id: string, list: VaultItem[], blob: Blob) => Promise<void> }) {
    const [kind, setKind] = useState('SOAT');
    const [title, setTitle] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!file) {
            setErr('Elige una foto o un PDF.');
            return;
        }
        const isPdf = file.type === 'application/pdf';
        if (!isPdf && !file.type.startsWith('image/')) {
            setErr('Solo se permiten fotos o PDF.');
            return;
        }
        if (isPdf && file.size > MAX_PDF_BYTES) {
            setErr('El PDF pesa más de 3,5 MB. Toma una foto o captura de pantalla.');
            return;
        }
        setErr('');
        setBusy(true);
        try {
            let payload: string;
            let mimeType: string;
            let blob: Blob;
            if (isPdf) {
                payload = await blobToBase64(file);
                mimeType = 'application/pdf';
                blob = file;
            } else {
                const prepared = await image.resizeIfNeeded(file, {
                    maxDimension: 2000,
                    maxPixels: 3_000_000,
                    quality: 0.85,
                    mimeType: 'image/jpeg',
                });
                payload = prepared.data;
                mimeType = prepared.mimeType;
                blob = base64ToBlob(prepared.data, prepared.mimeType);
            }
            const r = await api.post('/api/vault', { kind, title, data: payload, mimeType });
            const res = r.data as { id: string; items: VaultItem[] };
            await onUploaded(res.id, res.items, blob);
        } catch (e2) {
            setErr(errMsg(e2));
        }
        setBusy(false);
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Tipo de documento">
                <select className={inputCls} aria-label="Tipo de documento" value={kind} onChange={(e) => setKind(e.target.value)}>
                    {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                            {k.label}
                        </option>
                    ))}
                </select>
            </Field>
            <Field label="Nombre (opcional)">
                <input className={inputCls} value={title} placeholder="SOAT 2026" onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field
                label="Foto o PDF"
                error={err}
                hint={READABLE.includes(kind) ? 'Si es una foto, leo la fecha de vencimiento automáticamente.' : undefined}
            >
                <input
                    type="file"
                    accept="image/*,application/pdf"
                    aria-label="Foto o PDF"
                    className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-red-600 file:px-3 file:py-2 file:font-semibold file:text-white"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
            </Field>
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Subiendo…' : 'Guardar en la bóveda'}
            </Btn>
        </form>
    );
}
