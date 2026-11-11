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

export function applyTheme(t: Theme) {
    const dark =
        t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#09090b' : '#ffffff');
}
