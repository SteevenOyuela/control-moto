import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, image } from '@appdeploy/client';
import {
    ArrowLeft,
    ArrowRight,
    Camera,
    CloudOff,
    Crop,
    Download,
    FilePlus2,
    FileText,
    Images,
    ScanText,
    Share2,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { Btn, Card, Confirm, Field, Modal, inputCls } from './components';
import Cropper from './Cropper';
import { errMsg, fmtDate } from './lib';
import { downloadFile, fileName, imagesToPdf, shareFile } from './pdf';
import { base64ToBlob, blobToBase64, deletePages, getMeta, getPage, putMeta, putPage } from './vaultStore';
import type { Full, Run, VaultItem } from './types';

const KINDS: Array<{ value: string; label: string }> = [
    { value: 'SOAT', label: 'SOAT' },
    { value: 'TARJETA', label: 'Tarjeta de propiedad' },
    { value: 'LICENCIA', label: 'Licencia de conducción' },
    { value: 'RTM', label: 'Certificado técnico-mecánica' },
    { value: 'OTRO', label: 'Otro' },
];
const READABLE = ['SOAT', 'RTM', 'LICENCIA'];
const TWO_SIDED = ['TARJETA', 'LICENCIA'];
const MAX_PDF_BYTES = 3_500_000;
const MAX_PAGES = 10;

type Notify = (kind: 'ok' | 'error', text: string) => void;

type Extracted = {
    documentType: string;
    expiryDate: string | null;
    startDate: string | null;
    plate: string | null;
    documentNumber: string | null;
    issuer: string | null;
};

const pageCount = (it: VaultItem) => Math.max(1, it.pages ?? 1);
const isImage = (it: VaultItem) => it.mimeType.startsWith('image/');

function fmtBytes(n: number): string {
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Comprime una página recortada a JPEG (máx. 2000 px) lista para subir. */
async function preparePage(blob: Blob) {
    const prepared = await image.resizeIfNeeded(blob, {
        maxDimension: 2000,
        maxPixels: 3_000_000,
        quality: 0.85,
        mimeType: 'image/jpeg',
    });
    return { data: prepared.data, mimeType: prepared.mimeType, blob: base64ToBlob(prepared.data, prepared.mimeType) };
}

/** Carga todas las páginas de un documento desde el celular (o la nube si faltan). */
async function loadPages(it: VaultItem): Promise<Blob[]> {
    const out: Blob[] = [];
    for (let n = 0; n < pageCount(it); n++) {
        let b = await getPage(it.id, n);
        if (!b) {
            const f = await api.get(`/api/vault/${it.id}/pages/${n}`);
            const fd = f.data as { data: string; mimeType: string };
            b = base64ToBlob(fd.data, fd.mimeType);
            await putPage(it.id, n, b);
        }
        out.push(b);
    }
    return out;
}

/** Botones para tomar una foto con la cámara o elegirla de la galería, seguidos del recorte. */
function PageCapture({
    allowPdf,
    onImage,
    onPdf,
}: {
    allowPdf?: boolean;
    onImage: (cropped: Blob) => void;
    onPdf?: (file: File) => void;
}) {
    const camRef = useRef<HTMLInputElement>(null);
    const galRef = useRef<HTMLInputElement>(null);
    const [raw, setRaw] = useState<File | null>(null);
    const [err, setErr] = useState('');

    const pick = (f: File | null) => {
        setErr('');
        if (!f) return;
        if (f.type === 'application/pdf') {
            if (!allowPdf || !onPdf) return setErr('Aquí solo se pueden agregar fotos.');
            if (f.size > MAX_PDF_BYTES) return setErr('El PDF pesa más de 3,5 MB. Escanéalo con la cámara.');
            return onPdf(f);
        }
        if (!f.type.startsWith('image/')) return setErr('Solo se permiten fotos o PDF.');
        setRaw(f);
    };

    if (raw) {
        return (
            <Cropper
                file={raw}
                onCancel={() => setRaw(null)}
                onDone={(b) => {
                    setRaw(null);
                    onImage(b);
                }}
            />
        );
    }

    return (
        <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
                <Btn onClick={() => camRef.current?.click()}>
                    <Camera size={16} /> Tomar foto
                </Btn>
                <Btn variant="secondary" onClick={() => galRef.current?.click()}>
                    <Images size={16} /> {allowPdf ? 'Galería o PDF' : 'Galería'}
                </Btn>
            </div>
            {err && (
                <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                    {err}
                </p>
            )}
            <input
                ref={camRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                aria-label="Tomar foto con la cámara"
                onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    pick(f);
                }}
            />
            <input
                ref={galRef}
                type="file"
                accept={allowPdf ? 'image/*,application/pdf' : 'image/*'}
                className="hidden"
                aria-label="Elegir archivo"
                onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    pick(f);
                }}
            />
        </div>
    );
}

type DraftPage = { blob: Blob; url: string };

/** Nuevo documento: varias páginas escaneadas (frente, reverso…) o un PDF. */
function UploadForm({ onUploaded }: { onUploaded: (id: string, items: VaultItem[], blobs: Blob[]) => Promise<void> }) {
    const [kind, setKind] = useState('SOAT');
    const [title, setTitle] = useState('');
    const [pages, setPages] = useState<DraftPage[]>([]);
    const [pdf, setPdf] = useState<File | null>(null);
    const [capturing, setCapturing] = useState(true);
    const [recrop, setRecrop] = useState<number | null>(null);
    const [err, setErr] = useState('');
    const [progress, setProgress] = useState('');
    const pagesRef = useRef<DraftPage[]>([]);
    pagesRef.current = pages;

    useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

    const addPage = (blob: Blob) => {
        setPages((ps) => [...ps, { blob, url: URL.createObjectURL(blob) }]);
        setCapturing(false);
        setErr('');
    };
    const replacePage = (i: number, blob: Blob) =>
        setPages((ps) =>
            ps.map((p, j) => {
                if (j !== i) return p;
                URL.revokeObjectURL(p.url);
                return { blob, url: URL.createObjectURL(blob) };
            }),
        );
    const removePage = (i: number) =>
        setPages((ps) => {
            URL.revokeObjectURL(ps[i].url);
            return ps.filter((_, j) => j !== i);
        });
    const move = (i: number, d: -1 | 1) =>
        setPages((ps) => {
            const j = i + d;
            if (j < 0 || j >= ps.length) return ps;
            const next = [...ps];
            [next[i], next[j]] = [next[j], next[i]];
            return next;
        });

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!pdf && pages.length === 0) {
            setErr('Agrega al menos una página.');
            return;
        }
        setErr('');
        try {
            if (pdf) {
                setProgress('Subiendo PDF…');
                const data = await blobToBase64(pdf);
                const r = await api.post('/api/vault', { kind, title, data, mimeType: 'application/pdf' });
                const res = r.data as { id: string; items: VaultItem[] };
                await onUploaded(res.id, res.items, [pdf]);
                return;
            }
            const blobs: Blob[] = [];
            setProgress(`Subiendo página 1 de ${pages.length}…`);
            const first = await preparePage(pages[0].blob);
            blobs.push(first.blob);
            const r = await api.post('/api/vault', { kind, title, data: first.data, mimeType: first.mimeType });
            const res = r.data as { id: string; items: VaultItem[] };
            let items = res.items;
            for (let i = 1; i < pages.length; i++) {
                setProgress(`Subiendo página ${i + 1} de ${pages.length}…`);
                const pg = await preparePage(pages[i].blob);
                blobs.push(pg.blob);
                const r2 = await api.post(`/api/vault/${res.id}/pages`, { data: pg.data, mimeType: pg.mimeType });
                items = (r2.data as { items: VaultItem[] }).items;
            }
            await onUploaded(res.id, items, blobs);
        } catch (e2) {
            setErr(errMsg(e2));
            setProgress('');
        }
    };

    if (recrop !== null && pages[recrop]) {
        return (
            <Cropper
                file={pages[recrop].blob}
                onCancel={() => setRecrop(null)}
                onDone={(b) => {
                    replacePage(recrop, b);
                    setRecrop(null);
                }}
            />
        );
    }

    const twoSided = TWO_SIDED.includes(kind);
    const nextHint =
        twoSided && pages.length === 0 ? 'Empieza por el frente' : twoSided && pages.length === 1 ? 'Ahora el reverso' : '';

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Tipo" className="col-span-2 sm:col-span-1">
                    <select className={inputCls} aria-label="Tipo de documento" value={kind} onChange={(e) => setKind(e.target.value)}>
                        {KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                                {k.label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Nombre (opcional)" className="col-span-2 sm:col-span-1">
                    <input className={inputCls} value={title} placeholder="Licencia 2026" onChange={(e) => setTitle(e.target.value)} />
                </Field>
            </div>

            {pdf ? (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
                    <span className="flex min-w-0 items-center gap-2">
                        <FileText size={18} className="shrink-0" />
                        <span className="truncate">{pdf.name}</span>
                    </span>
                    <Btn variant="ghost" className="!px-2 !py-1" ariaLabel="Quitar PDF" onClick={() => setPdf(null)}>
                        <X size={16} />
                    </Btn>
                </div>
            ) : (
                <>
                    {pages.length > 0 && (
                        <div>
                            <div className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                                Páginas ({pages.length})
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {pages.map((p, i) => (
                                    <div key={p.url} className="rounded-xl border border-zinc-200 p-1 dark:border-zinc-700">
                                        <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                                            <img src={p.url} alt={`Página ${i + 1}`} className="h-full w-full object-contain" />
                                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[10px] font-semibold text-white">
                                                {i + 1}
                                                {twoSided && i < 2 ? (i === 0 ? ' · frente' : ' · reverso') : ''}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex justify-between">
                                            <button
                                                type="button"
                                                className="p-1 disabled:opacity-30"
                                                disabled={i === 0}
                                                onClick={() => move(i, -1)}
                                                aria-label={`Mover página ${i + 1} antes`}
                                            >
                                                <ArrowLeft size={14} />
                                            </button>
                                            <button type="button" className="p-1" onClick={() => setRecrop(i)} aria-label={`Recortar página ${i + 1}`}>
                                                <Crop size={14} />
                                            </button>
                                            <button type="button" className="p-1" onClick={() => removePage(i)} aria-label={`Quitar página ${i + 1}`}>
                                                <Trash2 size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                className="p-1 disabled:opacity-30"
                                                disabled={i === pages.length - 1}
                                                onClick={() => move(i, 1)}
                                                aria-label={`Mover página ${i + 1} después`}
                                            >
                                                <ArrowRight size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {capturing || pages.length === 0 ? (
                        <div className="space-y-2 rounded-2xl border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
                            <p className="text-sm font-semibold">
                                {pages.length === 0 ? 'Escanea la primera página' : `Página ${pages.length + 1}`}
                                {nextHint && <span className="font-normal text-zinc-500"> · {nextHint}</span>}
                            </p>
                            <PageCapture
                                allowPdf={pages.length === 0}
                                onImage={addPage}
                                onPdf={(f) => {
                                    setPdf(f);
                                    setCapturing(false);
                                }}
                            />
                            {pages.length > 0 && (
                                <Btn variant="ghost" className="w-full" onClick={() => setCapturing(false)}>
                                    Cancelar
                                </Btn>
                            )}
                        </div>
                    ) : (
                        pages.length < MAX_PAGES && (
                            <Btn variant="secondary" className="w-full" onClick={() => setCapturing(true)}>
                                <FilePlus2 size={16} /> {twoSided && pages.length === 1 ? 'Agregar el reverso' : 'Agregar otra página'}
                            </Btn>
                        )
                    )}
                </>
            )}

            {err && (
                <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                    {err}
                </p>
            )}
            <Btn type="submit" disabled={!!progress || (!pdf && pages.length === 0)} className="w-full">
                {progress || (pdf ? 'Guardar PDF' : `Guardar documento${pages.length > 1 ? ` (${pages.length} páginas)` : ''}`)}
            </Btn>
            {READABLE.includes(kind) && !pdf && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Al guardar leo la fecha de vencimiento con IA.</p>
            )}
        </form>
    );
}

/** Visor del documento: todas las páginas, compartir, descargar y editar páginas. */
function DocViewer({
    item,
    online,
    notify,
    onChanged,
    onRead,
}: {
    item: VaultItem;
    online: boolean;
    notify: Notify;
    onChanged: (items: VaultItem[]) => Promise<void>;
    onRead?: () => void;
}) {
    const [urls, setUrls] = useState<string[]>([]);
    const [blobs, setBlobs] = useState<Blob[]>([]);
    const [loadErr, setLoadErr] = useState('');
    const [busy, setBusy] = useState('');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<number | null>(null);
    const isPdf = item.mimeType === 'application/pdf';
    const count = pageCount(item);

    useEffect(() => {
        let alive = true;
        let made: string[] = [];
        setLoadErr('');
        loadPages(item)
            .then((bs) => {
                if (!alive) return;
                made = bs.map((b) => URL.createObjectURL(b));
                setBlobs(bs);
                setUrls(made);
            })
            .catch(() => alive && setLoadErr('No pude cargar todas las páginas. Conéctate a internet para descargarlas.'));
        return () => {
            alive = false;
            made.forEach((u) => URL.revokeObjectURL(u));
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id, count]);

    const buildFile = async (): Promise<File> => {
        if (isPdf) return new File([blobs[0]], fileName(item.title, 'pdf'), { type: 'application/pdf' });
        const pdf = await imagesToPdf(blobs);
        return new File([pdf], fileName(item.title, 'pdf'), { type: 'application/pdf' });
    };

    const doShare = async () => {
        setBusy('Preparando PDF…');
        try {
            const r = await shareFile(await buildFile());
            if (r === 'downloaded') notify('ok', 'PDF descargado');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy('');
    };

    const doDownload = async () => {
        setBusy('Preparando PDF…');
        try {
            downloadFile(await buildFile());
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy('');
    };

    const appendPage = async (cropped: Blob) => {
        setAdding(false);
        setBusy('Agregando página…');
        try {
            const pg = await preparePage(cropped);
            const r = await api.post(`/api/vault/${item.id}/pages`, { data: pg.data, mimeType: pg.mimeType });
            await putPage(item.id, count, pg.blob);
            await onChanged((r.data as { items: VaultItem[] }).items);
            notify('ok', 'Página agregada');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy('');
    };

    const removePage = async (n: number) => {
        setRemoving(null);
        setBusy('Quitando página…');
        try {
            const r = await api.delete(`/api/vault/${item.id}/pages/${n}`);
            // Las claves locales cambian de posición: se limpian y se vuelven a descargar.
            await deletePages(item.id, count);
            await onChanged((r.data as { items: VaultItem[] }).items);
            notify('ok', 'Página eliminada');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy('');
    };

    if (adding) {
        return (
            <div className="space-y-3">
                <p className="text-sm font-semibold">Agregar la página {count + 1}</p>
                <PageCapture onImage={appendPage} />
                <Btn variant="ghost" className="w-full" onClick={() => setAdding(false)}>
                    Cancelar
                </Btn>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
                <Btn onClick={doShare} disabled={!!busy || blobs.length < count}>
                    <Share2 size={16} /> Compartir
                </Btn>
                <Btn variant="secondary" onClick={doDownload} disabled={!!busy || blobs.length < count}>
                    <Download size={16} /> Descargar PDF
                </Btn>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Compartir abre el menú del celular: WhatsApp, correo o “Guardar en Archivos”.
                {count > 1 ? ` Se envía un solo PDF con las ${count} páginas.` : ''}
            </p>
            {busy && (
                <p role="status" className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">
                    {busy}
                </p>
            )}
            {loadErr && (
                <p role="alert" className="text-sm text-red-600">
                    {loadErr}
                </p>
            )}

            {isPdf ? (
                urls[0] && (
                    <Btn variant="secondary" className="w-full" onClick={() => window.open(urls[0], '_blank')}>
                        <FileText size={16} /> Abrir PDF
                    </Btn>
                )
            ) : (
                <div className="space-y-3">
                    {urls.map((u, i) => (
                        <figure key={u} className="space-y-1">
                            <img src={u} alt={`${item.title}, página ${i + 1}`} className="w-full rounded-xl border border-zinc-200 dark:border-zinc-700" />
                            <figcaption className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                <span>
                                    Página {i + 1} de {count}
                                </span>
                                {count > 1 && online && (
                                    <button
                                        type="button"
                                        className="flex items-center gap-1 font-semibold text-red-600"
                                        onClick={() => setRemoving(i)}
                                    >
                                        <Trash2 size={12} /> Quitar
                                    </button>
                                )}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            )}

            {!isPdf && online && (
                <div className="grid grid-cols-2 gap-2">
                    <Btn variant="secondary" onClick={() => setAdding(true)} disabled={!!busy || count >= MAX_PAGES}>
                        <FilePlus2 size={16} /> Agregar página
                    </Btn>
                    {onRead && (
                        <Btn variant="secondary" onClick={onRead} disabled={!!busy}>
                            <ScanText size={16} /> Leer fecha
                        </Btn>
                    )}
                </div>
            )}

            <Confirm
                open={removing !== null}
                title="Quitar página"
                message={`¿Quitar la página ${removing !== null ? removing + 1 : ''} de este documento?`}
                confirmLabel="Quitar"
                onCancel={() => setRemoving(null)}
                onConfirm={() => {
                    if (removing !== null) void removePage(removing);
                }}
            />
        </div>
    );
}

export default function Vault({ data, run, userId, notify }: { data: Full; run: Run; userId: string; notify: Notify }) {
    const [items, setItems] = useState<VaultItem[]>([]);
    const [thumbs, setThumbs] = useState<Record<string, string>>({});
    const [cached, setCached] = useState<Record<string, boolean>>({});
    const [online, setOnline] = useState(true);
    const [adding, setAdding] = useState(false);
    const [viewing, setViewing] = useState<VaultItem | null>(null);
    const [deleting, setDeleting] = useState<VaultItem | null>(null);
    const [reading, setReading] = useState<string | null>(null);
    const [found, setFound] = useState<{ item: VaultItem; result: Extracted } | null>(null);
    const thumbsRef = useRef<Record<string, string>>({});

    const setThumb = (id: string, blob: Blob | null) => {
        const old = thumbsRef.current[id];
        if (old) URL.revokeObjectURL(old);
        const next = { ...thumbsRef.current };
        if (blob) next[id] = URL.createObjectURL(blob);
        else delete next[id];
        thumbsRef.current = next;
        setThumbs(next);
    };

    /** Revisa que todas las páginas estén en el celular; descarga las que falten. */
    const syncItem = async (it: VaultItem) => {
        let complete = true;
        for (let n = 0; n < pageCount(it); n++) {
            let b = await getPage(it.id, n);
            if (!b) {
                try {
                    const f = await api.get(`/api/vault/${it.id}/pages/${n}`);
                    const fd = f.data as { data: string; mimeType: string };
                    b = base64ToBlob(fd.data, fd.mimeType);
                    await putPage(it.id, n, b);
                } catch {
                    complete = false;
                }
            }
            if (n === 0 && b && isImage(it)) setThumb(it.id, b);
        }
        setCached((c) => ({ ...c, [it.id]: complete }));
    };

    const applyItems = async (list: VaultItem[]) => {
        setItems(list);
        setViewing((v) => (v ? (list.find((x) => x.id === v.id) ?? null) : v));
        await putMeta(userId, list);
        for (const it of list) await syncItem(it);
    };

    useEffect(() => {
        let alive = true;
        (async () => {
            const meta = (await getMeta(userId)) ?? [];
            if (!alive) return;
            setItems(meta);
            for (const it of meta) {
                const b = await getPage(it.id, 0);
                if (b && isImage(it)) setThumb(it.id, b);
                let all = !!b;
                for (let n = 1; n < pageCount(it) && all; n++) all = !!(await getPage(it.id, n));
                if (alive) setCached((c) => ({ ...c, [it.id]: all }));
            }
            try {
                const r = await api.get('/api/vault');
                const list = ((r.data as { items?: VaultItem[] })?.items ?? []) as VaultItem[];
                if (!alive) return;
                setOnline(true);
                await applyItems(list);
            } catch {
                if (alive) setOnline(false);
            }
        })();
        return () => {
            alive = false;
            Object.values(thumbsRef.current).forEach((u) => URL.revokeObjectURL(u));
            thumbsRef.current = {};
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const readDoc = async (item: VaultItem) => {
        setReading(item.id);
        try {
            const r = await api.post(`/api/vault/${item.id}/extract`);
            const result = r.data as Extracted;
            if (!result.expiryDate) notify('error', 'No encontré una fecha de vencimiento en el documento.');
            else setFound({ item, result });
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
        const body = { type, name: existing?.name ?? '', expiry: found.result.expiryDate, notes: notes || existing?.notes || '' };
        const ok = existing
            ? await run(api.put(`/api/docs/${existing.id}`, body), 'Vencimiento actualizado')
            : await run(api.post('/api/docs', body), 'Vencimiento agregado');
        if (ok) setFound(null);
    };

    const onUploaded = async (id: string, list: VaultItem[], blobs: Blob[]) => {
        for (let n = 0; n < blobs.length; n++) await putPage(id, n, blobs[n]);
        setAdding(false);
        await applyItems(list);
        notify('ok', blobs.length > 1 ? `Documento guardado (${blobs.length} páginas)` : 'Documento guardado en la bóveda');
        const item = list.find((i) => i.id === id);
        if (item && isImage(item) && READABLE.includes(item.kind)) void readDoc(item);
    };

    const plate = data.profile.plate.replace(/\s/g, '').toUpperCase();
    const foundPlate = found?.result.plate?.replace(/[\s-]/g, '').toUpperCase() ?? '';

    return (
        <div>
            <Card className="!p-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Escanea tus documentos con la cámara (frente y reverso en el mismo archivo). Quedan copiados en este
                    celular para mostrarlos o compartirlos en un retén aunque no tengas datos.
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
                        const url = thumbs[it.id];
                        const n = pageCount(it);
                        return (
                            <Card key={it.id} className="!p-2">
                                <button
                                    type="button"
                                    onClick={() => setViewing(it)}
                                    className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800"
                                    aria-label={`Ver ${it.title}`}
                                >
                                    {url ? (
                                        <img src={url} alt={it.title} className="h-full w-full object-cover" />
                                    ) : (
                                        <FileText size={36} className="text-zinc-400" />
                                    )}
                                    {n > 1 && (
                                        <span className="absolute bottom-1 right-1 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white">
                                            {n} páginas
                                        </span>
                                    )}
                                </button>
                                <div className="mt-2 truncate text-sm font-semibold">{it.title}</div>
                                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {fmtDate(it.createdAt.slice(0, 10))} · {fmtBytes(it.bytes)}
                                </div>
                                <div className={`text-[11px] font-semibold ${cached[it.id] ? 'text-emerald-600' : 'text-zinc-400'}`}>
                                    {cached[it.id] ? 'Disponible sin conexión' : 'Descargando…'}
                                </div>
                                <div className="mt-1 flex justify-end gap-1">
                                    {isImage(it) && READABLE.includes(it.kind) && (
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

            <Modal open={adding} title="Nuevo documento" onClose={() => setAdding(false)}>
                {adding && <UploadForm onUploaded={onUploaded} />}
            </Modal>

            <Modal open={viewing !== null} title={viewing?.title ?? ''} onClose={() => setViewing(null)}>
                {viewing && (
                    <DocViewer
                        key={viewing.id}
                        item={viewing}
                        online={online}
                        notify={notify}
                        onChanged={applyItems}
                        onRead={
                            isImage(viewing) && READABLE.includes(viewing.kind)
                                ? () => {
                                      const it = viewing;
                                      setViewing(null);
                                      void readDoc(it);
                                  }
                                : undefined
                        }
                    />
                )}
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
                message={`¿Eliminar "${deleting?.title ?? ''}"${deleting && pageCount(deleting) > 1 ? ` y sus ${pageCount(deleting)} páginas` : ''}? Se borra de la nube y de este celular.`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const it = deleting;
                    setDeleting(null);
                    if (!it) return;
                    try {
                        const r = await api.delete(`/api/vault/${it.id}`);
                        const list = ((r.data as { items?: VaultItem[] })?.items ?? []) as VaultItem[];
                        await deletePages(it.id, pageCount(it));
                        setThumb(it.id, null);
                        await applyItems(list);
                        notify('ok', 'Documento eliminado');
                    } catch (e) {
                        notify('error', errMsg(e));
                    }
                }}
            />
        </div>
    );
}
