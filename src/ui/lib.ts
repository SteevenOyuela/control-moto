import type { Dashboard } from './types';

export const fmtKm = (n: number) => `${Math.round(n).toLocaleString('es-CO')} km`;

export const fmtMoney = (n: number) =>
    n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export const fmtNum = (n: number, d = 1) =>
    n.toLocaleString('es-CO', { maximumFractionDigits: d, minimumFractionDigits: d });

export function fmtDate(d: string): string {
    const [y, m, dd] = d.split('-').map(Number);
    if (!y || !m || !dd) return d;
    return new Date(y, m - 1, dd).toLocaleDateString('es-CO', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

export function todayLocal(): string {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${dd}`;
}

export function daysText(n: number): string {
    if (n < 0) return `Vencido hace ${-n} día${n === -1 ? '' : 's'}`;
    if (n === 0) return 'Vence hoy';
    if (n === 1) return 'Vence mañana';
    return `Faltan ${n} días`;
}

export function errMsg(e: unknown): string {
    const x = e as {
        response?: { data?: { error?: string; message?: string } | string };
        data?: { error?: string };
        message?: string;
    };
    const data = x?.response?.data;
    if (typeof data === 'string' && data) return data;
    if (data && typeof data === 'object') {
        if (data.error) return data.error;
        if (data.message) return data.message;
    }
    if (x?.data?.error) return x.data.error;
    return x?.message || 'Ocurrió un error. Intenta de nuevo.';
}

/** Convierte texto de un input numérico a número (acepta coma decimal). */
export function parseNum(s: string): number | null {
    const t = s.trim().replace(/\s/g, '').replace(',', '.');
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

// --- Persistencia local (caché offline y preferencias) ---

function safeGet(k: string): string | null {
    try {
        return localStorage.getItem(k);
    } catch {
        return null;
    }
}

function safeSet(k: string, v: string) {
    try {
        localStorage.setItem(k, v);
    } catch {
        /* sin almacenamiento disponible */
    }
}

export function loadCache(userId: string): Dashboard | null {
    const raw = safeGet(`moto-cache-${userId}`);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as Dashboard;
    } catch {
        return null;
    }
}

export function saveCache(userId: string, d: Dashboard) {
    safeSet(`moto-cache-${userId}`, JSON.stringify(d));
}

export type Theme = 'system' | 'dark' | 'light';

export function loadTheme(): Theme {
    const t = safeGet('moto-theme');
    return t === 'dark' || t === 'light' || t === 'system' ? t : 'system';
}

export function saveTheme(t: Theme) {
    safeSet('moto-theme', t);
}

// --- Último precio de la gasolina (para no escribirlo cada vez) ---

export function loadLastPrice(): string | null {
    const v = safeGet('moto-last-ppg');
    return v && /^\d+$/.test(v) ? v : null;
}

export function saveLastPrice(n: number) {
    safeSet('moto-last-ppg', String(Math.round(n)));
}

export function applyTheme(t: Theme) {
    const dark =
        t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090b' : '#dc2626');
}

// --- Logo del usuario (pantalla de apertura, encabezado e ícono) ---

const LOGO_KEY = 'moto-logo';

export function loadLogo(): string | null {
    const v = safeGet(LOGO_KEY);
    return v && v.startsWith('data:image/') ? v : null;
}

export function saveLogo(dataUrl: string | null) {
    try {
        if (dataUrl) localStorage.setItem(LOGO_KEY, dataUrl);
        else localStorage.removeItem(LOGO_KEY);
    } catch {
        /* sin almacenamiento disponible */
    }
}

/**
 * Cambia el ícono que usa Safari al "Agregar a pantalla de inicio".
 * iOS lo lee en el momento de agregar el acceso, así que basta con tenerlo en el DOM.
 */
export function setTouchIcon(dataUrl: string | null) {
    const link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!link) return;
    if (!link.dataset.default) link.dataset.default = link.getAttribute('href') ?? '';
    link.setAttribute('href', dataUrl ?? link.dataset.default);
}

/** Convierte una imagen en un PNG cuadrado (por defecto 512×512) y devuelve su base64. */
export async function squarePng(blob: Blob, size = 512): Promise<string> {
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('No se pudo abrir la imagen.'));
            i.src = url;
        });
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const ctx = c.getContext('2d')!;
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(
            img,
            (img.naturalWidth - side) / 2,
            (img.naturalHeight - side) / 2,
            side,
            side,
            0,
            0,
            size,
            size,
        );
        const d = c.toDataURL('image/png');
        return d.slice(d.indexOf(',') + 1);
    } finally {
        URL.revokeObjectURL(url);
    }
}
