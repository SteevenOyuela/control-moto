import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { RotateCw, Maximize } from 'lucide-react';
import { Btn } from './components';

type Rect = { x: number; y: number; w: number; h: number };
type Mode = 'move' | 'nw' | 'ne' | 'sw' | 'se';

const MAX_SOURCE = 3000;
const MIN_SIZE = 48;

/** Carga la imagen (reducida si es enorme) y la gira en un canvas. */
async function loadRotated(blob: Blob, rotation: number): Promise<HTMLCanvasElement> {
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
            i.src = url;
        });
        const k = Math.min(1, MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k);
        const h = Math.round(img.naturalHeight * k);
        const swap = rotation % 180 !== 0;
        const c = document.createElement('canvas');
        c.width = swap ? h : w;
        c.height = swap ? w : h;
        const ctx = c.getContext('2d')!;
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
        return c;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function fullRect(W: number, H: number, aspect?: number): Rect {
    if (!aspect) {
        const m = Math.round(Math.min(W, H) * 0.04);
        return { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
    }
    let w = W * 0.9;
    let h = w / aspect;
    if (h > H * 0.9) {
        h = H * 0.9;
        w = h * aspect;
    }
    return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/**
 * Recorte manual: el usuario arrastra las esquinas (o el recuadro completo)
 * para ajustar el área. `aspect` fija la proporción (1 = cuadrado).
 */
export default function Cropper({
    file,
    aspect,
    output = 'image/jpeg',
    onDone,
    onCancel,
}: {
    file: Blob;
    aspect?: number;
    output?: 'image/jpeg' | 'image/png';
    onDone: (blob: Blob) => void;
    onCancel: () => void;
}) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [source, setSource] = useState<HTMLCanvasElement | null>(null);
    const [rotation, setRotation] = useState(0);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const drag = useRef<{ mode: Mode; px: number; py: number; start: Rect } | null>(null);

    useEffect(() => {
        let alive = true;
        loadRotated(file, rotation)
            .then((c) => alive && setSource(c))
            .catch((e: Error) => alive && setErr(e.message));
        return () => {
            alive = false;
        };
    }, [file, rotation]);

    useLayoutEffect(() => {
        if (!source || !wrapRef.current) return;
        const maxW = Math.max(120, wrapRef.current.clientWidth - 36);
        const maxH = Math.min(window.innerHeight * 0.58, 560);
        const k = Math.min(maxW / source.width, maxH / source.height);
        const w = Math.round(source.width * k);
        const h = Math.round(source.height * k);
        setSize({ w, h });
        setRect(fullRect(w, h, aspect));
        const cv = canvasRef.current;
        if (cv) {
            cv.width = w * 2;
            cv.height = h * 2;
            cv.getContext('2d')!.drawImage(source, 0, 0, w * 2, h * 2);
        }
    }, [source, aspect]);

    const onDown = (mode: Mode) => (e: RPointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        drag.current = { mode, px: e.clientX, py: e.clientY, start: rect };
    };

    const onMove = (e: RPointerEvent<HTMLDivElement>) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.px;
        const dy = e.clientY - d.py;
        const { w: W, h: H } = size;
        const s = d.start;
        if (d.mode === 'move') {
            setRect({
                ...s,
                x: Math.min(Math.max(0, s.x + dx), W - s.w),
                y: Math.min(Math.max(0, s.y + dy), H - s.h),
            });
            return;
        }
        let x1 = s.x;
        let y1 = s.y;
        let x2 = s.x + s.w;
        let y2 = s.y + s.h;
        if (d.mode.includes('w')) x1 = Math.min(Math.max(0, s.x + dx), x2 - MIN_SIZE);
        if (d.mode.includes('e')) x2 = Math.max(Math.min(W, x2 + dx), x1 + MIN_SIZE);
        if (d.mode.includes('n')) y1 = Math.min(Math.max(0, s.y + dy), y2 - MIN_SIZE);
        if (d.mode.includes('s')) y2 = Math.max(Math.min(H, y2 + dy), y1 + MIN_SIZE);
        if (aspect) {
            // Mantiene la proporción tomando el ancho como guía.
            let w = x2 - x1;
            let h = w / aspect;
            const maxH = d.mode.includes('n') ? s.y + s.h : H - s.y;
            if (h > maxH) {
                h = maxH;
                w = h * aspect;
            }
            if (d.mode.includes('w')) x1 = x2 - w;
            else x2 = x1 + w;
            if (d.mode.includes('n')) y1 = y2 - h;
            else y2 = y1 + h;
        }
        setRect({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    };

    const onUp = () => {
        drag.current = null;
    };

    const confirm = async () => {
        if (!source || !size.w) return;
        setBusy(true);
        const k = source.width / size.w;
        const sw = Math.max(1, Math.round(rect.w * k));
        const sh = Math.max(1, Math.round(rect.h * k));
        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext('2d')!;
        if (output === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, sw, sh);
        }
        ctx.drawImage(source, Math.round(rect.x * k), Math.round(rect.y * k), sw, sh, 0, 0, sw, sh);
        out.toBlob(
            (b) => {
                setBusy(false);
                if (b) onDone(b);
                else setErr('No se pudo recortar la imagen.');
            },
            output,
            0.92,
        );
    };

    const corner = (mode: Mode, cls: string) => (
        <div
            onPointerDown={onDown(mode)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            className={`absolute h-9 w-9 ${cls}`}
            style={{ touchAction: 'none' }}
            aria-label="Ajustar esquina"
        >
            <div className="absolute inset-2 rounded-full border-2 border-white bg-red-600 shadow" />
        </div>
    );

    return (
        <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
                Arrastra las esquinas para ajustar el recorte. Mueve el recuadro tocando en el centro.
            </p>
            <div ref={wrapRef} className="flex w-full justify-center">
                {err ? (
                    <p role="alert" className="text-sm text-red-600">
                        {err}
                    </p>
                ) : !source ? (
                    <p className="py-10 text-sm text-zinc-500">Cargando imagen…</p>
                ) : (
                    <div
                        className="relative my-3 select-none"
                        style={{ width: size.w, height: size.h, touchAction: 'none' }}
                    >
                        <div className="absolute inset-0 overflow-hidden rounded-lg bg-black">
                            <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} className="block" />
                            <div
                                className="pointer-events-none absolute"
                                style={{
                                    left: rect.x,
                                    top: rect.y,
                                    width: rect.w,
                                    height: rect.h,
                                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                                }}
                            />
                        </div>
                        <div
                            onPointerDown={onDown('move')}
                            onPointerMove={onMove}
                            onPointerUp={onUp}
                            onPointerCancel={onUp}
                            className="absolute cursor-move border-2 border-white"
                            style={{
                                left: rect.x,
                                top: rect.y,
                                width: rect.w,
                                height: rect.h,
                                touchAction: 'none',
                            }}
                        >
                            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                                {Array.from({ length: 9 }).map((_, i) => (
                                    <div key={i} className="border border-white/20" />
                                ))}
                            </div>
                            {corner('nw', '-left-[18px] -top-[18px]')}
                            {corner('ne', '-right-[18px] -top-[18px]')}
                            {corner('sw', '-bottom-[18px] -left-[18px]')}
                            {corner('se', '-bottom-[18px] -right-[18px]')}
                        </div>
                    </div>
                )}
            </div>
            <div className="flex gap-2">
                <Btn variant="secondary" className="flex-1" onClick={() => setRotation((r) => (r + 90) % 360)}>
                    <RotateCw size={16} /> Girar
                </Btn>
                <Btn variant="secondary" className="flex-1" onClick={() => setRect(fullRect(size.w, size.h, aspect))}>
                    <Maximize size={16} /> Restablecer
                </Btn>
            </div>
            <div className="flex gap-2">
                <Btn variant="ghost" className="flex-1" onClick={onCancel}>
                    Cancelar
                </Btn>
                <Btn className="flex-1" onClick={confirm} disabled={busy || !source}>
                    {busy ? 'Recortando…' : 'Usar recorte'}
                </Btn>
            </div>
        </div>
    );
}
