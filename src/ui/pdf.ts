// Generador de PDF mínimo, sin librerías: una imagen JPEG por página (A4).
// Se ejecuta en el celular, así que funciona sin conexión.

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 24;
const MAX_SIDE = 2400;

type Jpeg = { bytes: Uint8Array; w: number; h: number };

/** Re-codifica cualquier imagen a JPEG RGB (lo que el PDF espera con DCTDecode). */
async function toJpeg(blob: Blob): Promise<Jpeg> {
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('No se pudo leer una de las páginas.'));
            i.src = url;
        });
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k));
        const h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const out = await new Promise<Blob>((resolve, reject) =>
            c.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo preparar la página.'))), 'image/jpeg', 0.9),
        );
        return { bytes: new Uint8Array(await out.arrayBuffer()), w, h };
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** Une las imágenes en un solo PDF, cada una centrada en una hoja A4. */
export async function imagesToPdf(blobs: Blob[]): Promise<Blob> {
    const pages: Jpeg[] = [];
    for (const b of blobs) pages.push(await toJpeg(b));

    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    let length = 0;
    const offsets: number[] = [];
    const push = (x: string | Uint8Array) => {
        const bytes = typeof x === 'string' ? enc.encode(x) : x;
        parts.push(bytes);
        length += bytes.length;
    };
    const begin = (num: number) => {
        offsets[num] = length;
        push(`${num} 0 obj\n`);
    };

    // Objetos: 1 = catálogo, 2 = árbol de páginas, luego 3 por página (hoja, contenido, imagen).
    const pageObj = (i: number) => 3 + i * 3;
    const total = 2 + pages.length * 3;

    push('%PDF-1.4\n');
    begin(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    begin(2);
    push(
        `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    );

    pages.forEach((pg, i) => {
        const n = pageObj(i);
        const s = Math.min((A4_W - 2 * MARGIN) / pg.w, (A4_H - 2 * MARGIN) / pg.h);
        const dw = pg.w * s;
        const dh = pg.h * s;
        const x = (A4_W - dw) / 2;
        const y = (A4_H - dh) / 2;
        const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;

        begin(n);
        push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
                `/Resources << /XObject << /Im${i} ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>\nendobj\n`,
        );
        begin(n + 1);
        push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
        begin(n + 2);
        push(
            `<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB ` +
                `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.length} >>\nstream\n`,
        );
        push(pg.bytes);
        push('\nendstream\nendobj\n');
    });

    const xref = length;
    let table = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

/** Nombre de archivo seguro: "Licencia de conducción" → "Licencia_de_conduccion.pdf". */
export function fileName(title: string, ext: string): string {
    const base = title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `${base || 'documento'}.${ext}`;
}

/**
 * Abre la hoja de compartir del celular (WhatsApp, correo, "Guardar en Archivos"…).
 * Si el navegador no puede compartir archivos, descarga el archivo.
 */
export async function shareFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
        try {
            await nav.share({ files: [file], title: file.name });
            return 'shared';
        } catch (e) {
            if ((e as Error).name === 'AbortError') return 'cancelled';
        }
    }
    downloadFile(file);
    return 'downloaded';
}

export function downloadFile(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
}
