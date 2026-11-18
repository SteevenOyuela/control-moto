import {
    router,
    json,
    error,
    requireAuth,
    db,
    notifications,
    isAppDatabaseError,
    storage,
    ai,
} from '@appdeploy/sdk';
import type { RouterContext } from '@appdeploy/sdk';
import { createHash, randomBytes } from 'crypto';

function sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Profile = {
    userId: string;
    brand: string;
    model: string;
    cc: number;
    plate: string;
    year: number;
    matriculaDate: string;
    currentKm: number;
    currentKmDate: string;
    avaluo: number;
    city: string;
    createdAt: string;
    logoPath?: string;
    shortcutHash?: string;
    shortcutCreatedAt?: string;
};

type Doc = {
    type: string;
    name: string;
    expiry: string;
    notes?: string;
    notified?: string[];
};

type MaintItem = {
    name: string;
    category: string;
    intervalKm: number;
    intervalDays: number;
    lastKm: number;
    lastDate: string;
    notes?: string;
    notifiedFor?: string;
};

type Service = {
    itemId: string;
    itemName: string;
    km: number;
    date: string;
    cost: number;
    notes?: string;
};

type Fuel = {
    date: string;
    km: number;
    gallons: number;
    total: number;
    fullTank: boolean;
};

type Odo = { date: string; km: number; source: string };

type Expense = {
    date: string;
    category: string;
    amount: number;
    note?: string;
};

type VaultItem = {
    kind: string;
    title: string;
    path: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
};

type Status = 'ok' | 'pronto' | 'urgente' | 'vencido';

type WithId<T> = T & { id: string };

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TZ = 'America/Bogota';
const LITERS_PER_GALLON = 3.78541;
const DOC_TYPES = ['SOAT', 'RTM', 'LICENCIA', 'IMPUESTO', 'OTRO'];
const DOC_LABELS: Record<string, string> = {
    SOAT: 'SOAT',
    RTM: 'Revisión técnico-mecánica',
    LICENCIA: 'Licencia de conducción',
    IMPUESTO: 'Impuesto vehicular',
    OTRO: 'Documento',
};

const EXPENSE_CATEGORIES = [
    'Parqueadero',
    'Lavada',
    'Peajes',
    'Accesorios',
    'Repuestos',
    'Documentos e impuestos',
    'Multas',
    'Otros',
];

const SCAN_CATEGORIES = [...EXPENSE_CATEGORIES, 'Gasolina'];

const RECEIPT_SCHEMA = {
    type: 'object',
    properties: {
        merchant: { type: ['string', 'null'], description: 'Nombre del establecimiento' },
        date: { type: ['string', 'null'], description: 'Fecha de la compra en formato YYYY-MM-DD' },
        total: { type: ['number', 'null'], description: 'Total pagado en pesos colombianos, sin separadores' },
        category: { type: 'string', enum: SCAN_CATEGORIES, description: 'Categoría del gasto' },
        gallons: { type: ['number', 'null'], description: 'Galones de combustible, solo si es gasolina' },
        pricePerGallon: { type: ['number', 'null'], description: 'Precio por galón, solo si es gasolina' },
        summary: { type: ['string', 'null'], description: 'Descripción corta de lo comprado' },
    },
    required: ['total', 'category'],
};

/** Esquema de factura + servicios de taller que coinciden con las tarjetas del usuario. */
function receiptSchema(itemIds: string[]) {
    const props: Record<string, unknown> = {
        ...RECEIPT_SCHEMA.properties,
        odometer: {
            type: ['number', 'null'],
            description: 'Kilometraje de la moto si la factura del taller lo indica',
        },
    };
    if (itemIds.length) {
        props.maintenance = {
            type: 'array',
            description:
                'Mantenimientos de la lista del usuario que la factura muestra como realizados o comprados. Vacío si no hay ninguno.',
            items: {
                type: 'object',
                properties: {
                    itemId: { type: 'string', enum: itemIds },
                    price: { type: ['number', 'null'], description: 'Valor de esa línea en pesos, si aparece' },
                },
                required: ['itemId'],
            },
        };
    }
    return { ...RECEIPT_SCHEMA, properties: props };
}

function maintPromptList(items: Array<WithId<MaintItem>>): string {
    return (
        'Lista de mantenimientos del usuario (id | nombre). Si la factura incluye alguno, devuélvelo en "maintenance" ' +
        'usando exactamente su id. Ejemplos: aceite → "Aceite de motor"; filtro de aceite → "Filtro de aceite"; ' +
        'cadena, piñón o corona → "Kit de arrastre"; lubricación de cadena → "Lubricar y tensionar cadena".\n' +
        items.map((i) => `${i.id} | ${i.name}`).join('\n')
    );
}

function validOdometer(n: number | null): number | null {
    return n !== null && n > 0 && n < 2_000_000 ? Math.round(n) : null;
}

function parseMaintMatches(raw: unknown, items: Array<WithId<MaintItem>>) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; price: number | null }> = [];
    for (const r of raw) {
        const o = (r ?? {}) as Record<string, unknown>;
        const id = typeof o.itemId === 'string' ? o.itemId : '';
        const item = items.find((i) => i.id === id);
        if (!item || seen.has(id)) continue;
        seen.add(id);
        const price = num(o.price);
        out.push({ id, name: item.name, price: price !== null && price > 0 ? Math.round(price) : null });
    }
    return out;
}

const VAULT_KINDS = ['SOAT', 'TARJETA', 'LICENCIA', 'RTM', 'OTRO'];
const VAULT_LABELS: Record<string, string> = {
    SOAT: 'SOAT',
    TARJETA: 'Tarjeta de propiedad',
    LICENCIA: 'Licencia de conducción',
    RTM: 'Certificado técnico-mecánica',
    OTRO: 'Documento',
};
const VAULT_MIME: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
};
// ~3,5 MB decodificados: deja margen bajo el límite de 6 MB por petición.
const VAULT_MAX_BASE64 = 4_800_000;

// Intervalos de referencia para Hero Hunk 160R 4V (refrigerada por aire/aceite).
// El usuario puede ajustarlos desde la app.
const DEFAULT_ITEMS: Array<Pick<MaintItem, 'name' | 'category' | 'intervalKm' | 'intervalDays'>> = [
    { name: 'Aceite de motor', category: 'Fluidos', intervalKm: 3000, intervalDays: 180 },
    { name: 'Líquido de frenos', category: 'Fluidos', intervalKm: 20000, intervalDays: 730 },
    { name: 'Filtro de aceite', category: 'Filtros y bujía', intervalKm: 6000, intervalDays: 365 },
    { name: 'Limpieza filtro de aire', category: 'Filtros y bujía', intervalKm: 3000, intervalDays: 0 },
    { name: 'Cambio filtro de aire', category: 'Filtros y bujía', intervalKm: 12000, intervalDays: 0 },
    { name: 'Bujía', category: 'Filtros y bujía', intervalKm: 12000, intervalDays: 0 },
    { name: 'Lubricar y tensionar cadena', category: 'Kit de arrastre', intervalKm: 500, intervalDays: 15 },
    { name: 'Kit de arrastre (cadena, piñón y corona)', category: 'Kit de arrastre', intervalKm: 18000, intervalDays: 0 },
    { name: 'Pastillas de freno delanteras', category: 'Frenos y llantas', intervalKm: 3000, intervalDays: 0 },
    { name: 'Pastillas / bandas traseras', category: 'Frenos y llantas', intervalKm: 3000, intervalDays: 0 },
    { name: 'Presión de llantas', category: 'Frenos y llantas', intervalKm: 0, intervalDays: 15 },
    { name: 'Desgaste de llantas', category: 'Frenos y llantas', intervalKm: 5000, intervalDays: 0 },
    { name: 'Limpieza de cuerpo de aceleración e inyector', category: 'Sincronización', intervalKm: 12000, intervalDays: 0 },
    { name: 'Calibración de válvulas', category: 'Sincronización', intervalKm: 12000, intervalDays: 0 },
];

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function userKey(userId: string): string {
    const k = userId.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 64);
    return k || 'anon';
}

function tbl(base: string, key: string): string {
    return `${base}_${key}`;
}

function today(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function isDate(v: unknown): v is string {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    return !Number.isNaN(dayNum(v));
}

function dayNum(d: string): number {
    const [y, m, dd] = d.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, dd) / 86400000);
}

function addDays(d: string, n: number): string {
    return new Date((dayNum(d) + n) * 86400000).toISOString().slice(0, 10);
}

function addYears(d: string, n: number): string {
    const [y, m, dd] = d.split('-');
    const day = m === '02' && dd === '29' ? '28' : dd;
    return `${Number(y) + n}-${m}-${day}`;
}

function num(v: unknown): number | null {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function str(v: unknown, max = 120): string {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function bodyOf(ctx: RouterContext): Record<string, unknown> {
    const b = ctx.body;
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {};
}

function keyOf(ctx: RouterContext): string {
    return userKey(ctx.user!.userId);
}

function isQuota(e: unknown): boolean {
    return isAppDatabaseError(e) && e.code === 'AppDatabaseQuotaExceeded';
}

async function listAll<T>(table: string): Promise<Array<WithId<T>>> {
    const out: Array<WithId<T>> = [];
    let token: string | undefined;
    try {
        for (let i = 0; i < 5; i++) {
            const page = await db.list<T>(table, { limit: 200, nextToken: token });
            out.push(...(page.items as unknown as Array<WithId<T>>));
            token = page.nextToken;
            if (!token) break;
        }
    } catch (e) {
        if (isQuota(e)) throw e;
        console.warn('list failed', table, e);
    }
    return out;
}

async function getOne<T>(table: string, id: string): Promise<T | null> {
    try {
        const [item] = await db.get<T>(table, [id], { consistent: true });
        return item ?? null;
    } catch (e) {
        if (isQuota(e)) throw e;
        console.warn('get failed', table, e);
        return null;
    }
}

function estimateRtm(matricula: string, t: string): string {
    // Motos: primera revisión a los 2 años de la matrícula, luego cada año.
    let d = addYears(matricula, 2);
    let guard = 0;
    while (dayNum(d) < dayNum(t) && guard < 60) {
        d = addYears(d, 1);
        guard++;
    }
    return d;
}

// ---------------------------------------------------------------------------
// Lógica de negocio
// ---------------------------------------------------------------------------

/**
 * Promedio diario de recorrido con mínimos cuadrados ponderados.
 * Los registros recientes pesan más (vida media de 30 días), así la predicción
 * se adapta si cambias tu rutina.
 */
function dailyRate(points: Array<{ date: string; km: number }>, t: string): number | null {
    const t0 = dayNum(t);
    const valid = points.filter((p) => isDate(p.date) && Number.isFinite(p.km));
    let pts = valid.filter((p) => t0 - dayNum(p.date) <= 120);
    if (pts.length < 2) pts = valid;
    if (pts.length < 2) return null;
    const xs = pts.map((p) => dayNum(p.date) - t0);
    if (Math.max(...xs) - Math.min(...xs) < 1) return null;
    let sw = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    pts.forEach((p, i) => {
        const x = xs[i];
        const w = Math.pow(0.5, Math.max(0, -x) / 30);
        sw += w;
        sx += w * x;
        sy += w * p.km;
        sxx += w * x * x;
        sxy += w * x * p.km;
    });
    const den = sw * sxx - sx * sx;
    if (den <= 0) return null;
    const slope = (sw * sxy - sx * sy) / den;
    if (!Number.isFinite(slope) || slope <= 0 || slope > 1500) return null;
    return slope;
}

function docStatus(daysLeft: number): Status {
    if (daysLeft < 0) return 'vencido';
    if (daysLeft <= 5) return 'urgente';
    if (daysLeft <= 15) return 'pronto';
    return 'ok';
}

function computeItem(item: WithId<MaintItem>, p: Profile, rate: number | null, t: string) {
    const lastDate = isDate(item.lastDate) ? item.lastDate : p.createdAt;
    const kmDue = item.intervalKm > 0 ? item.lastKm + item.intervalKm : null;
    const kmLeft = kmDue !== null ? kmDue - p.currentKm : null;
    const timeDue = item.intervalDays > 0 ? addDays(lastDate, item.intervalDays) : null;
    let kmDate: string | null = null;
    if (kmLeft !== null && rate) {
        kmDate = addDays(p.currentKmDate, Math.max(0, Math.ceil(kmLeft / rate)));
    }
    const candidates = [kmDate, timeDue].filter((d): d is string => d !== null);
    const dueDate = candidates.length
        ? candidates.reduce((a, b) => (dayNum(a) <= dayNum(b) ? a : b))
        : null;
    const daysLeft = dueDate ? dayNum(dueDate) - dayNum(t) : null;

    let progress = 0;
    if (item.intervalKm > 0) progress = (p.currentKm - item.lastKm) / item.intervalKm;
    if (item.intervalDays > 0) {
        progress = Math.max(progress, (dayNum(t) - dayNum(lastDate)) / item.intervalDays);
    }
    progress = Math.max(0, Math.min(1.2, progress));

    let status: Status = 'ok';
    if (progress >= 1) status = 'vencido';
    else if (progress >= 0.85 || (daysLeft !== null && daysLeft <= 7)) status = 'pronto';

    return {
        ...item,
        lastDate,
        kmDue,
        kmLeft,
        timeDue,
        dueDate,
        daysLeft,
        progress,
        status,
    };
}

function fuelStats(fuel: Array<WithId<Fuel>>) {
    const sorted = [...fuel].sort((a, b) => a.km - b.km || dayNum(a.date) - dayNum(b.date));
    const perEntry: Record<string, number> = {};
    let lastFull = -1;
    let gal = 0;
    let cost = 0;
    let totKm = 0;
    let totGal = 0;
    let totCost = 0;
    let lastKmPerGal: number | null = null;
    sorted.forEach((f, i) => {
        if (lastFull >= 0) {
            gal += f.gallons;
            cost += f.total;
        }
        if (f.fullTank) {
            if (lastFull >= 0) {
                const km = f.km - sorted[lastFull].km;
                if (km > 0 && gal > 0) {
                    perEntry[f.id] = km / gal;
                    lastKmPerGal = km / gal;
                    totKm += km;
                    totGal += gal;
                    totCost += cost;
                }
            }
            lastFull = i;
            gal = 0;
            cost = 0;
        }
    });
    const allGal = fuel.reduce((s, f) => s + f.gallons, 0);
    const allSpent = fuel.reduce((s, f) => s + f.total, 0);
    const avgKmPerGal = totGal > 0 ? totKm / totGal : null;
    return {
        perEntry,
        stats: {
            avgKmPerGal,
            avgKmPerL: avgKmPerGal !== null ? avgKmPerGal / LITERS_PER_GALLON : null,
            costPerKm: totKm > 0 ? totCost / totKm : null,
            lastKmPerGal,
            totalSpent: allSpent,
            totalGallons: allGal,
            avgPricePerGallon: allGal > 0 ? allSpent / allGal : null,
        },
    };
}

function taxInfo(p: Profile) {
    if (p.cc > 125) {
        return {
            regime: 'impuesto',
            title: 'Impuesto vehicular (departamental)',
            detail:
                'Las motos de más de 125 cc pagan impuesto vehicular cada año. La tarifa es el 1,5 % del avalúo comercial que publica el Ministerio de Transporte (Ley 488 de 1998, art. 145). La fecha límite la fija cada departamento.',
            estimate: p.avaluo > 0 ? Math.round(p.avaluo * 0.015) : null,
            license: 'A2',
            licenseDetail: 'Para motos de más de 125 cc necesitas licencia categoría A2.',
        };
    }
    return {
        regime: 'semaforizacion',
        title: 'Derechos de semaforización (municipal)',
        detail:
            'Las motos de 125 cc o menos no pagan impuesto vehicular. En algunos municipios pagan derechos de semaforización; el valor lo fija cada municipio.',
        estimate: null,
        license: 'A1',
        licenseDetail: 'Para motos de hasta 125 cc basta la licencia categoría A1.',
    };
}

function monthsBack(t: string, n: number): string[] {
    const [y, m] = t.split('-').map(Number);
    const out: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
        out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7));
    }
    return out;
}

function spending(
    fuel: Array<WithId<Fuel>>,
    services: Array<WithId<Service>>,
    expenses: Array<WithId<Expense>>,
    odo: Array<WithId<Odo>>,
    profile: Profile,
    t: string,
) {
    const rows = [
        ...fuel.map((f) => ({ date: f.date, amount: f.total, category: 'Gasolina' })),
        ...services.map((s) => ({ date: s.date, amount: s.cost, category: 'Mantenimiento' })),
        ...expenses.map((e) => ({ date: e.date, amount: e.amount, category: e.category || 'Otros' })),
    ].filter((r) => isDate(r.date) && Number.isFinite(r.amount) && r.amount > 0);

    const month = t.slice(0, 7);
    const months = monthsBack(t, 6);
    const byCategory: Record<string, number> = {};
    const monthByCategory: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    for (const m of months) byMonth[m] = 0;
    let total = 0;
    let monthTotal = 0;
    for (const r of rows) {
        total += r.amount;
        byCategory[r.category] = (byCategory[r.category] ?? 0) + r.amount;
        const m = r.date.slice(0, 7);
        if (m in byMonth) byMonth[m] += r.amount;
        if (m === month) {
            monthTotal += r.amount;
            monthByCategory[r.category] = (monthByCategory[r.category] ?? 0) + r.amount;
        }
    }
    const kms = odo.map((o) => o.km).filter((k) => Number.isFinite(k));
    const firstKm = kms.length ? Math.min(...kms) : profile.currentKm;
    const kmDriven = profile.currentKm - firstKm;
    const sorted = (o: Record<string, number>) =>
        Object.entries(o)
            .map(([category, amount]) => ({ category, amount }))
            .sort((a, b) => b.amount - a.amount);
    return {
        total,
        monthTotal,
        month,
        kmDriven,
        costPerKmTotal: kmDriven > 0 ? total / kmDriven : null,
        byCategory: sorted(byCategory),
        monthByCategory: sorted(monthByCategory),
        byMonth: months.map((m) => ({ month: m, amount: byMonth[m] })),
    };
}

const STATUS_ORDER: Record<Status, number> = { vencido: 0, urgente: 1, pronto: 2, ok: 3 };

async function buildDashboard(key: string, profile: Profile) {
    const t = today();
    const [docs, items, services, fuel, odo, expenses] = await Promise.all([
        listAll<Doc>(tbl('docs', key)),
        listAll<MaintItem>(tbl('maint', key)),
        listAll<Service>(tbl('service', key)),
        listAll<Fuel>(tbl('fuel', key)),
        listAll<Odo>(tbl('odo', key)),
        listAll<Expense>(tbl('expense', key)),
    ]);
    const rate = dailyRate(odo, t);
    const estimatedKmToday = rate
        ? Math.round(profile.currentKm + rate * Math.max(0, dayNum(t) - dayNum(profile.currentKmDate)))
        : null;

    const docViews = docs
        .filter((d) => isDate(d.expiry))
        .map((d) => {
            const daysLeft = dayNum(d.expiry) - dayNum(t);
            return {
                id: d.id,
                type: d.type,
                name: d.name,
                expiry: d.expiry,
                notes: d.notes ?? '',
                daysLeft,
                status: docStatus(daysLeft),
            };
        })
        .sort((a, b) => a.daysLeft - b.daysLeft);

    const itemViews = items
        .map((i) => {
            const c = computeItem(i, profile, rate, t);
            return {
                id: c.id,
                name: c.name,
                category: c.category,
                intervalKm: c.intervalKm,
                intervalDays: c.intervalDays,
                lastKm: c.lastKm,
                lastDate: c.lastDate,
                notes: c.notes ?? '',
                kmDue: c.kmDue,
                kmLeft: c.kmLeft,
                dueDate: c.dueDate,
                daysLeft: c.daysLeft,
                progress: c.progress,
                status: c.status,
            };
        })
        .sort(
            (a, b) =>
                STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
                (a.daysLeft ?? 99999) - (b.daysLeft ?? 99999) ||
                b.progress - a.progress,
        );

    const fs = fuelStats(fuel);
    const fuelViews = [...fuel]
        .sort((a, b) => b.km - a.km || dayNum(b.date) - dayNum(a.date))
        .map((f) => ({ ...f, kmPerGal: fs.perEntry[f.id] ?? null }));

    const serviceViews = [...services]
        .sort((a, b) => dayNum(b.date) - dayNum(a.date) || b.km - a.km)
        .slice(0, 50);

    return {
        profile,
        today: t,
        rate,
        estimatedKmToday,
        rtmSuggested: isDate(profile.matriculaDate) ? estimateRtm(profile.matriculaDate, t) : null,
        tax: taxInfo(profile),
        docs: docViews,
        items: itemViews,
        services: serviceViews,
        fuel: fuelViews,
        fuelStats: fs.stats,
        expenses: [...expenses]
            .sort((a, b) => dayNum(b.date) - dayNum(a.date))
            .slice(0, 100)
            .map((e) => ({ id: e.id, date: e.date, category: e.category, amount: e.amount, note: e.note ?? '' })),
        expenseCategories: EXPENSE_CATEGORIES,
        spending: spending(fuel, services, expenses, odo, profile, t),
    };
}

async function vaultList(key: string) {
    const items = await listAll<VaultItem>(tbl('vault', key));
    return items
        .map((v) => ({
            id: v.id,
            kind: v.kind,
            title: v.title,
            mimeType: v.mimeType,
            bytes: v.bytes,
            createdAt: v.createdAt,
        }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const EXTRACT_SCHEMA = {
    type: 'object',
    properties: {
        documentType: {
            type: 'string',
            enum: ['SOAT', 'RTM', 'LICENCIA', 'TARJETA', 'OTRO'],
            description: 'Tipo de documento colombiano detectado',
        },
        expiryDate: {
            type: ['string', 'null'],
            description: 'Fecha de vencimiento o fin de vigencia en formato YYYY-MM-DD, o null si no aparece',
        },
        startDate: {
            type: ['string', 'null'],
            description: 'Fecha de inicio de vigencia o de expedición en formato YYYY-MM-DD, o null',
        },
        plate: { type: ['string', 'null'], description: 'Placa del vehículo si aparece' },
        documentNumber: { type: ['string', 'null'], description: 'Número de póliza, certificado o licencia' },
        issuer: { type: ['string', 'null'], description: 'Aseguradora, CDA o entidad que lo expide' },
    },
    required: ['documentType', 'expiryDate'],
};

async function dashboardResponse(key: string) {
    const p = await getOne<Profile>('profiles', key);
    if (!p) return json({ profile: null, today: today() });
    return json(await buildDashboard(key, p));
}

/** Registra una lectura del odómetro y sube el km actual si es mayor. */
async function recordKm(key: string, profile: Profile, km: number, date: string, source: string) {
    await db.add(tbl('odo', key), [{ date, km, source }]);
    if (km > profile.currentKm) {
        const newDate = dayNum(date) >= dayNum(profile.currentKmDate) ? date : profile.currentKmDate;
        await db.tx.update('profiles', [{ id: key, record: { currentKm: km, currentKmDate: newDate } }], {
            patch: true,
        });
    }
}

// ---------------------------------------------------------------------------
// Recordatorios (cron diario + manual)
// ---------------------------------------------------------------------------

async function remindUser(key: string, profile: Profile): Promise<string[]> {
    const dash = await buildDashboard(key, profile);
    const messages: string[] = [];

    const docsRaw = await listAll<Doc>(tbl('docs', key));
    for (const d of dash.docs) {
        let level: string | null = null;
        if (d.daysLeft < 0) level = 'vencido';
        else if (d.daysLeft <= 1) level = 'd1';
        else if (d.daysLeft <= 5) level = 'd5';
        else if (d.daysLeft <= 15) level = 'd15';
        if (!level) continue;
        const raw = docsRaw.find((r) => r.id === d.id);
        const notified = raw?.notified ?? [];
        const mark = `${d.expiry}:${level}`;
        if (notified.includes(mark)) continue;
        let when = `vence en ${d.daysLeft} días`;
        if (d.daysLeft < 0) when = `está VENCIDO desde hace ${-d.daysLeft} día(s)`;
        else if (d.daysLeft === 0) when = 'vence HOY';
        else if (d.daysLeft === 1) when = 'vence mañana';
        messages.push(`${d.name} ${when}.`);
        await db.tx.update(tbl('docs', key), [{ id: d.id, record: { notified: [...notified, mark] } }], {
            patch: true,
        });
    }

    const itemsRaw = await listAll<MaintItem>(tbl('maint', key));
    for (const it of dash.items) {
        if (it.status === 'ok') continue;
        const raw = itemsRaw.find((r) => r.id === it.id);
        const mark = `${it.lastKm}|${it.lastDate}|${it.status}`;
        if (raw?.notifiedFor === mark) continue;
        let detail = '';
        if (it.kmLeft !== null) {
            detail = it.kmLeft > 0 ? `faltan ${Math.round(it.kmLeft)} km` : `pasado por ${Math.round(-it.kmLeft)} km`;
        }
        if (it.dueDate) detail += `${detail ? ', ' : ''}fecha estimada ${it.dueDate}`;
        messages.push(`${it.name}: ${it.status === 'vencido' ? 'toca ya' : 'se acerca'}${detail ? ` (${detail})` : ''}.`);
        await db.tx.update(tbl('maint', key), [{ id: it.id, record: { notifiedFor: mark } }], { patch: true });
    }

    if (messages.length > 0) {
        const title =
            messages.length === 1 ? `Tu ${profile.model || 'moto'}` : `${messages.length} recordatorios para tu moto`;
        await notifications.send({
            userIds: [profile.userId],
            notification: { title, body: messages.join('\n').slice(0, 900) },
            data: { kind: 'reminder' },
            ttlSeconds: 86400,
        });
    }
    return messages;
}

export const dailyReminders = async () => {
    let token: string | undefined;
    for (let page = 0; page < 10; page++) {
        let res: { items: Array<Profile & { id: string }>; nextToken?: string };
        try {
            res = (await db.list<Profile>('profiles', { limit: 50, nextToken: token })) as unknown as {
                items: Array<Profile & { id: string }>;
                nextToken?: string;
            };
        } catch (e) {
            console.error('cron list profiles failed', e);
            break;
        }
        for (const p of res.items) {
            try {
                await remindUser(p.id, p);
            } catch (e) {
                console.error('remind failed', p.id, e);
            }
        }
        token = res.nextToken;
        if (!token) break;
    }
    return { statusCode: 200 };
};

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export const handler = router({
    'GET /api/_healthcheck': [async () => json({ message: 'Success' })],

    'GET /api/dashboard': [requireAuth(), async (ctx) => dashboardResponse(keyOf(ctx))],

    'PUT /api/profile': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const cc = num(b.cc);
            const currentKm = num(b.currentKm);
            const year = num(b.year);
            const avaluo = num(b.avaluo) ?? 0;
            if (cc === null || cc <= 0 || cc > 2500) return error('El cilindraje no es válido.', 400);
            if (currentKm === null || currentKm < 0) return error('El kilometraje no es válido.', 400);
            if (!isDate(b.matriculaDate)) return error('La fecha de matrícula no es válida.', 400);
            const t = today();
            const fields = {
                brand: str(b.brand, 40) || 'Hero',
                model: str(b.model, 60) || 'Hunk 160R 4V',
                cc,
                plate: str(b.plate, 10).toUpperCase(),
                year: year ?? 0,
                matriculaDate: b.matriculaDate,
                avaluo: Math.max(0, avaluo),
                city: str(b.city, 60),
            };

            const existing = await getOne<Profile>('profiles', key);
            if (existing) {
                const record: Record<string, unknown> = { ...fields };
                if (currentKm !== existing.currentKm) {
                    record.currentKm = currentKm;
                    record.currentKmDate = t;
                    await db.add(tbl('odo', key), [{ date: t, km: currentKm, source: 'ajuste' }]);
                }
                await db.tx.update('profiles', [{ id: key, record }], { patch: true });
                return dashboardResponse(key);
            }

            const profile: Profile = {
                userId: ctx.user!.userId,
                ...fields,
                currentKm,
                currentKmDate: t,
                createdAt: t,
            };
            await db.tx.add('profiles', [{ id: key, ...profile }]);
            await db.add(
                tbl('maint', key),
                DEFAULT_ITEMS.map((i) => ({ ...i, lastKm: currentKm, lastDate: t })),
            );
            await db.add(tbl('odo', key), [{ date: t, km: currentKm, source: 'registro' }]);

            const docs: Doc[] = [];
            if (isDate(b.soatExpiry)) docs.push({ type: 'SOAT', name: 'SOAT', expiry: b.soatExpiry, notified: [] });
            docs.push({
                type: 'RTM',
                name: DOC_LABELS.RTM,
                expiry: estimateRtm(fields.matriculaDate, t),
                notes: 'Fecha estimada (2 años desde la matrícula y luego cada año). Ajústala con tu certificado.',
                notified: [],
            });
            if (isDate(b.licenseExpiry)) {
                docs.push({ type: 'LICENCIA', name: DOC_LABELS.LICENCIA, expiry: b.licenseExpiry, notified: [] });
            }
            if (isDate(b.taxDue)) {
                docs.push({ type: 'IMPUESTO', name: DOC_LABELS.IMPUESTO, expiry: b.taxDue, notified: [] });
            }
            await db.add(tbl('docs', key), docs);
            return dashboardResponse(key);
        },
    ],

    'POST /api/odometer': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const km = num(b.km);
            const date = isDate(b.date) ? b.date : today();
            if (km === null || km < 0) return error('Escribe un kilometraje válido.', 400);
            if (km < p.currentKm) {
                return error(
                    `El kilometraje no puede ser menor al último registrado (${Math.round(p.currentKm)} km).`,
                    400,
                );
            }
            await recordKm(key, p, km, date, 'manual');
            return dashboardResponse(key);
        },
    ],

    'POST /api/docs': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const type = str(b.type, 20).toUpperCase();
            if (!DOC_TYPES.includes(type)) return error('Tipo de documento no válido.', 400);
            if (!isDate(b.expiry)) return error('La fecha de vencimiento es obligatoria.', 400);
            const doc: Doc = {
                type,
                name: str(b.name, 80) || DOC_LABELS[type],
                expiry: b.expiry,
                notes: str(b.notes, 300),
                notified: [],
            };
            await db.add(tbl('docs', key), [doc]);
            return dashboardResponse(key);
        },
    ],

    'PUT /api/docs/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const id = ctx.params.id;
            const existing = await getOne<Doc>(tbl('docs', key), id);
            if (!existing) return error('Documento no encontrado.', 404);
            const type = str(b.type, 20).toUpperCase() || existing.type;
            if (!DOC_TYPES.includes(type)) return error('Tipo de documento no válido.', 400);
            if (!isDate(b.expiry)) return error('La fecha de vencimiento es obligatoria.', 400);
            const record: Record<string, unknown> = {
                type,
                name: str(b.name, 80) || DOC_LABELS[type],
                expiry: b.expiry,
                notes: str(b.notes, 300),
            };
            if (b.expiry !== existing.expiry) record.notified = [];
            await db.tx.update(tbl('docs', key), [{ id, record }], { patch: true });
            return dashboardResponse(key);
        },
    ],

    'DELETE /api/docs/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            await db.delete(tbl('docs', key), [ctx.params.id]);
            return dashboardResponse(key);
        },
    ],

    'POST /api/maint': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const name = str(b.name, 80);
            if (!name) return error('El nombre es obligatorio.', 400);
            const intervalKm = Math.max(0, num(b.intervalKm) ?? 0);
            const intervalDays = Math.max(0, Math.round(num(b.intervalDays) ?? 0));
            if (intervalKm === 0 && intervalDays === 0) {
                return error('Define un intervalo en km o en días.', 400);
            }
            const p = await getOne<Profile>('profiles', key);
            const item: MaintItem = {
                name,
                category: str(b.category, 40) || 'Otros',
                intervalKm,
                intervalDays,
                lastKm: Math.max(0, num(b.lastKm) ?? p?.currentKm ?? 0),
                lastDate: isDate(b.lastDate) ? b.lastDate : today(),
                notes: str(b.notes, 300),
            };
            await db.add(tbl('maint', key), [item]);
            return dashboardResponse(key);
        },
    ],

    'PUT /api/maint/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const name = str(b.name, 80);
            if (!name) return error('El nombre es obligatorio.', 400);
            const intervalKm = Math.max(0, num(b.intervalKm) ?? 0);
            const intervalDays = Math.max(0, Math.round(num(b.intervalDays) ?? 0));
            if (intervalKm === 0 && intervalDays === 0) {
                return error('Define un intervalo en km o en días.', 400);
            }
            const lastKm = num(b.lastKm);
            if (lastKm === null || lastKm < 0) return error('El kilometraje del último cambio no es válido.', 400);
            if (!isDate(b.lastDate)) return error('La fecha del último cambio no es válida.', 400);
            const [ok] = await db.tx.update(
                tbl('maint', key),
                [
                    {
                        id: ctx.params.id,
                        record: {
                            name,
                            category: str(b.category, 40) || 'Otros',
                            intervalKm,
                            intervalDays,
                            lastKm,
                            lastDate: b.lastDate,
                            notes: str(b.notes, 300),
                            notifiedFor: undefined,
                        },
                    },
                ],
                { patch: true },
            );
            if (!ok) return error('Elemento no encontrado.', 404);
            return dashboardResponse(key);
        },
    ],

    'DELETE /api/maint/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            await db.delete(tbl('maint', key), [ctx.params.id]);
            return dashboardResponse(key);
        },
    ],

    'POST /api/maint/:id/done': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const id = ctx.params.id;
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const item = await getOne<MaintItem>(tbl('maint', key), id);
            if (!item) return error('Elemento no encontrado.', 404);
            const km = num(b.km);
            if (km === null || km < 0) return error('Escribe el kilometraje del servicio.', 400);
            const date = isDate(b.date) ? b.date : today();
            const cost = Math.max(0, num(b.cost) ?? 0);
            await db.tx.update(
                tbl('maint', key),
                [{ id, record: { lastKm: km, lastDate: date, notifiedFor: undefined } }],
                { patch: true },
            );
            const service: Service = {
                itemId: id,
                itemName: item.name,
                km,
                date,
                cost,
                notes: str(b.notes, 300),
            };
            await db.add(tbl('service', key), [service]);
            await recordKm(key, p, km, date, 'servicio');
            return dashboardResponse(key);
        },
    ],

    'POST /api/fuel': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const km = num(b.km);
            const gallons = num(b.gallons);
            const total = num(b.total);
            if (km === null || km < 0) return error('Escribe el kilometraje del tanqueo.', 400);
            if (gallons === null || gallons <= 0 || gallons > 20) return error('Los galones no son válidos.', 400);
            if (total === null || total < 0) return error('El valor pagado no es válido.', 400);
            const date = isDate(b.date) ? b.date : today();
            const fuel: Fuel = { date, km, gallons, total, fullTank: b.fullTank !== false };
            await db.add(tbl('fuel', key), [fuel]);
            await recordKm(key, p, km, date, 'tanqueo');
            return dashboardResponse(key);
        },
    ],

    'DELETE /api/fuel/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            await db.delete(tbl('fuel', key), [ctx.params.id]);
            return dashboardResponse(key);
        },
    ],

    'POST /api/expenses': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const amount = num(b.amount);
            if (amount === null || amount <= 0) return error('Escribe el valor del gasto.', 400);
            const category = str(b.category, 40);
            if (!EXPENSE_CATEGORIES.includes(category)) return error('Elige una categoría válida.', 400);
            const expense: Expense = {
                date: isDate(b.date) ? b.date : today(),
                category,
                amount,
                note: str(b.note, 200),
            };
            await db.add(tbl('expense', key), [expense]);
            return dashboardResponse(key);
        },
    ],

    'POST /api/expenses/scan': [
        requireAuth(),
        async (ctx) => {
            const b = bodyOf(ctx);
            const mimeType = str(b.mimeType, 40);
            if (!mimeType.startsWith('image/') || !VAULT_MIME[mimeType]) {
                return error('Envía una foto de la factura (JPG, PNG o WEBP).', 400);
            }
            const data = typeof b.data === 'string' ? b.data : '';
            if (!data) return error('No llegó la foto.', 400);
            if (data.length > VAULT_MAX_BASE64) return error('La foto es muy grande.', 400);
            const maintItems = await listAll<MaintItem>(tbl('maint', keyOf(ctx)));
            try {
                const result = await ai.extract({
                    system: 'Lees facturas y recibos de Colombia para una app de gastos de una moto.',
                    prompt:
                        'Extrae los datos de esta factura o recibo. Los valores están en pesos colombianos: el punto separa miles ("$45.000" = 45000). Usa el TOTAL pagado, no subtotales. La fecha va en formato YYYY-MM-DD (en Colombia suele escribirse DD/MM/AAAA). Elige la categoría que mejor describa el gasto de la moto: Gasolina (estaciones de servicio, combustible), Parqueadero, Lavada, Peajes, Accesorios (cascos, guantes, impermeables), Repuestos (taller, aceite, llantas, piezas), Documentos e impuestos (SOAT, RTM, impuesto, trámites), Multas u Otros. Si es gasolina, extrae también los galones y el precio por galón. Si un dato no aparece, usa null.',
                    images: [{ data, mimeType }],
                    content: maintItems.length ? maintPromptList(maintItems) : undefined,
                    schema: receiptSchema(maintItems.map((i) => i.id)),
                    maxRetries: 2,
                });
                const d = (result.data ?? {}) as Record<string, unknown>;
                const category = SCAN_CATEGORIES.includes(str(d.category, 40)) ? str(d.category, 40) : 'Otros';
                const total = num(d.total);
                const gallons = num(d.gallons);
                const ppg = num(d.pricePerGallon);
                return json({
                    merchant: str(d.merchant, 80) || null,
                    date: isDate(d.date) ? d.date : null,
                    total: total !== null && total > 0 ? Math.round(total) : null,
                    category,
                    gallons: gallons !== null && gallons > 0 && gallons <= 20 ? gallons : null,
                    pricePerGallon: ppg !== null && ppg > 0 ? Math.round(ppg) : null,
                    summary: str(d.summary, 120) || null,
                    odometer: validOdometer(num(d.odometer)),
                    maintMatches: parseMaintMatches(d.maintenance, maintItems),
                });
            } catch (err) {
                const rpc = err as { statusCode?: number; responseText?: string };
                console.error('receipt scan failed', rpc?.statusCode, rpc?.responseText);
                if (rpc?.statusCode === 429) {
                    return error('La IA está ocupada en este momento. Intenta en unos minutos.', 429);
                }
                return error('No pude leer la factura. Prueba con una foto más nítida y bien recortada.', 502);
            }
        },
    ],

    'DELETE /api/expenses/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            await db.delete(tbl('expense', key), [ctx.params.id]);
            return dashboardResponse(key);
        },
    ],

    'GET /api/vault': [requireAuth(), async (ctx) => json({ items: await vaultList(keyOf(ctx)) })],

    'POST /api/vault': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const kind = str(b.kind, 20).toUpperCase();
            if (!VAULT_KINDS.includes(kind)) return error('Tipo de documento no válido.', 400);
            const mimeType = str(b.mimeType, 40);
            const ext = VAULT_MIME[mimeType];
            if (!ext) return error('Solo se permiten fotos (JPG, PNG, WEBP) o PDF.', 400);
            const data = typeof b.data === 'string' ? b.data : '';
            if (!data) return error('No llegó el archivo.', 400);
            if (data.length > VAULT_MAX_BASE64) return error('El archivo es muy grande (máximo 3,5 MB).', 400);
            const path = `vault/${key}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const [ok] = await storage.write([{ path, content: data, contentType: mimeType }]);
            if (!ok) return error('No se pudo guardar el archivo. Intenta de nuevo.', 500);
            const item: VaultItem = {
                kind,
                title: str(b.title, 80) || VAULT_LABELS[kind],
                path,
                mimeType,
                bytes: Math.round((data.length * 3) / 4),
                createdAt: new Date().toISOString(),
            };
            const [id] = await db.add(tbl('vault', key), [item]);
            if (!id) {
                await storage.delete([path]);
                return error('No se pudo registrar el archivo.', 500);
            }
            return json({ id, items: await vaultList(key) });
        },
    ],

    'GET /api/vault/:id/file': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const item = await getOne<VaultItem>(tbl('vault', key), ctx.params.id);
            if (!item) return error('Archivo no encontrado.', 404);
            const [file] = await storage.read([item.path]);
            if (!file || file.content === null) return error('Archivo no encontrado.', 404);
            return json({ data: file.content, mimeType: item.mimeType });
        },
    ],

    'DELETE /api/vault/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const item = await getOne<VaultItem>(tbl('vault', key), ctx.params.id);
            if (item) {
                await storage.delete([item.path]);
                await db.delete(tbl('vault', key), [ctx.params.id]);
            }
            return json({ items: await vaultList(key) });
        },
    ],

    'POST /api/vault/:id/extract': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const item = await getOne<VaultItem>(tbl('vault', key), ctx.params.id);
            if (!item) return error('Archivo no encontrado.', 404);
            if (!item.mimeType.startsWith('image/')) {
                return error('La lectura automática funciona con fotos, no con PDF.', 400);
            }
            const [file] = await storage.read([item.path]);
            if (!file || file.content === null) return error('Archivo no encontrado.', 404);
            try {
                const result = await ai.extract({
                    system:
                        'Eres un asistente que lee documentos de tránsito de Colombia (SOAT, revisión técnico-mecánica, licencia de conducción, tarjeta de propiedad).',
                    prompt:
                        'Lee el documento de la imagen y devuelve el tipo de documento y sus fechas en formato YYYY-MM-DD. Las fechas en Colombia suelen escribirse DD/MM/AAAA. Para el SOAT la fecha de vencimiento es el fin de vigencia. Si un dato no aparece, usa null.',
                    images: [{ data: file.content, mimeType: item.mimeType }],
                    schema: EXTRACT_SCHEMA,
                    maxRetries: 2,
                });
                const d = (result.data ?? {}) as Record<string, unknown>;
                return json({
                    documentType: str(d.documentType, 20) || item.kind,
                    expiryDate: isDate(d.expiryDate) ? d.expiryDate : null,
                    startDate: isDate(d.startDate) ? d.startDate : null,
                    plate: str(d.plate, 12) || null,
                    documentNumber: str(d.documentNumber, 40) || null,
                    issuer: str(d.issuer, 60) || null,
                });
            } catch (err) {
                const rpc = err as { statusCode?: number; responseText?: string };
                console.error('extract failed', rpc?.statusCode, rpc?.responseText);
                if (rpc?.statusCode === 429) {
                    return error('La IA está ocupada en este momento. Intenta en unos minutos.', 429);
                }
                return error('No pude leer el documento. Prueba con una foto más nítida.', 502);
            }
        },
    ],

    'GET /api/logo': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p?.logoPath) return json({ data: null });
            const [file] = await storage.read([p.logoPath]);
            if (!file || file.content === null) return json({ data: null });
            return json({ data: file.content, mimeType: 'image/png' });
        },
    ],

    'POST /api/logo': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const data = typeof b.data === 'string' ? b.data : '';
            if (!data) return error('No llegó la imagen del logo.', 400);
            if (data.length > 2_000_000) return error('El logo es muy pesado.', 400);
            const path = `logo/${key}.png`;
            const [ok] = await storage.write([{ path, content: data, contentType: 'image/png' }]);
            if (!ok) return error('No se pudo guardar el logo.', 500);
            await db.tx.update('profiles', [{ id: key, record: { logoPath: path } }], { patch: true });
            return json({ ok: true });
        },
    ],

    'DELETE /api/logo': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (p?.logoPath) {
                await storage.delete([p.logoPath]);
                await db.tx.update('profiles', [{ id: key, record: { logoPath: undefined } }], { patch: true });
            }
            return json({ ok: true });
        },
    ],

    'PUT /api/expenses/:id': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const amount = num(b.amount);
            if (amount === null || amount <= 0) return error('Escribe el valor del gasto.', 400);
            const category = str(b.category, 40);
            if (!EXPENSE_CATEGORIES.includes(category)) return error('Elige una categoría válida.', 400);
            const [ok] = await db.tx.update(
                tbl('expense', key),
                [
                    {
                        id: ctx.params.id,
                        record: {
                            date: isDate(b.date) ? b.date : today(),
                            category,
                            amount,
                            note: str(b.note, 200),
                        },
                    },
                ],
                { patch: true },
            );
            if (!ok) return error('Gasto no encontrado.', 404);
            return dashboardResponse(key);
        },
    ],

    'POST /api/maint/done-batch': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const b = bodyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const km = num(b.km);
            if (km === null || km < 0) return error('Escribe el kilometraje del servicio.', 400);
            const date = isDate(b.date) ? b.date : today();
            const notes = str(b.notes, 300);
            const raw = Array.isArray(b.items) ? (b.items as unknown[]).slice(0, 20) : [];
            const all = await listAll<MaintItem>(tbl('maint', key));
            const chosen: Array<{ item: WithId<MaintItem>; cost: number }> = [];
            for (const r of raw) {
                const o = (r ?? {}) as Record<string, unknown>;
                const item = all.find((i) => i.id === o.id);
                if (item && !chosen.some((c) => c.item.id === item.id)) {
                    chosen.push({ item, cost: Math.max(0, num(o.cost) ?? 0) });
                }
            }
            if (!chosen.length) return error('Elige al menos un mantenimiento.', 400);
            await db.tx.update(
                tbl('maint', key),
                chosen.map((c) => ({
                    id: c.item.id,
                    record: { lastKm: km, lastDate: date, notifiedFor: undefined },
                })),
                { patch: true },
            );
            await db.add(
                tbl('service', key),
                chosen.map((c) => ({ itemId: c.item.id, itemName: c.item.name, km, date, cost: c.cost, notes })),
            );
            await recordKm(key, p, km, date, 'servicio');
            return dashboardResponse(key);
        },
    ],

    'GET /api/shortcut': [
        requireAuth(),
        async (ctx) => {
            const p = await getOne<Profile>('profiles', keyOf(ctx));
            return json({ enabled: !!p?.shortcutHash, createdAt: p?.shortcutCreatedAt ?? null });
        },
    ],

    'POST /api/shortcut': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            if (p.shortcutHash) await db.delete('shortcut_tokens', [p.shortcutHash]);
            const token = `cm_${randomBytes(24).toString('hex')}`;
            const hash = sha256(token);
            const createdAt = new Date().toISOString();
            await db.tx.add('shortcut_tokens', [{ id: hash, key, createdAt }]);
            await db.tx.update('profiles', [{ id: key, record: { shortcutHash: hash, shortcutCreatedAt: createdAt } }], {
                patch: true,
            });
            return json({ token, createdAt });
        },
    ],

    'DELETE /api/shortcut': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (p?.shortcutHash) {
                await db.delete('shortcut_tokens', [p.shortcutHash]);
                await db.tx.update(
                    'profiles',
                    [{ id: key, record: { shortcutHash: undefined, shortcutCreatedAt: undefined } }],
                    { patch: true },
                );
            }
            return json({ enabled: false });
        },
    ],

    // Ruta pública para el Atajo de iOS: se autentica con el token personal.
    'POST /api/shortcut/km': [
        async (ctx) => {
            const b = bodyOf(ctx);
            const token = str(b.token, 120);
            if (!token.startsWith('cm_')) return error('Token inválido. Genera uno nuevo en Ajustes.', 401);
            const hash = sha256(token);
            const rec = await getOne<{ key: string }>('shortcut_tokens', hash);
            if (!rec) return error('Token inválido o revocado. Genera uno nuevo en Ajustes.', 401);
            const p = await getOne<Profile>('profiles', rec.key);
            if (!p || p.shortcutHash !== hash) return error('Token revocado. Genera uno nuevo en Ajustes.', 401);
            // Acepta "12345", "12.345" (separador de miles) o un número.
            let kmRaw: unknown = b.km;
            if (typeof kmRaw === 'string') {
                const t = kmRaw.trim().replace(/\s/g, '');
                kmRaw = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t.replace(',', '.');
            }
            const km = num(kmRaw);
            if (km === null || km < 0) return error('Escribe un kilometraje válido.', 400);
            if (km < p.currentKm) {
                return error(
                    `El kilometraje no puede ser menor al último registrado (${Math.round(p.currentKm)} km).`,
                    400,
                );
            }
            await recordKm(rec.key, p, km, today(), 'atajo');
            const delta = Math.round(km - p.currentKm);
            return json({
                ok: true,
                message: `Listo: ${Math.round(km).toLocaleString('es-CO')} km registrados${delta > 0 ? ` (+${delta} km)` : ''}.`,
            });
        },
    ],

    'POST /api/notify-test': [
        requireAuth(),
        async (ctx) => {
            const r = await notifications.send({
                userIds: [ctx.user!.userId],
                notification: { title: 'Control Moto', body: '¡Las notificaciones funcionan! 🏍️' },
                data: { kind: 'test' },
            });
            return json(r);
        },
    ],

    'POST /api/reminders/run': [
        requireAuth(),
        async (ctx) => {
            const key = keyOf(ctx);
            const p = await getOne<Profile>('profiles', key);
            if (!p) return error('Primero registra tu moto.', 400);
            const messages = await remindUser(key, p);
            return json({ messages });
        },
    ],
});
