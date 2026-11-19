export type Status = 'ok' | 'pronto' | 'urgente' | 'vencido';

export type Profile = {
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
};

export type DocView = {
    id: string;
    type: string;
    name: string;
    expiry: string;
    notes: string;
    daysLeft: number;
    status: Status;
};

export type ItemView = {
    id: string;
    name: string;
    category: string;
    intervalKm: number;
    intervalDays: number;
    lastKm: number;
    lastDate: string;
    notes: string;
    kmDue: number | null;
    kmLeft: number | null;
    dueDate: string | null;
    daysLeft: number | null;
    progress: number;
    status: Status;
    dueLow?: string | null;
    dueHigh?: string | null;
};

export type ReadingView = {
    id: string;
    date: string;
    km: number;
    source: string;
    verified: boolean;
    anomaly: boolean;
};

export type PredictionView = {
    ready: boolean;
    confidence: 'sin datos' | 'baja' | 'media' | 'alta';
    rateAvg: number | null;
    weekdayRates: number[] | null;
    sigma: number | null;
    historyDays: number;
    readings: number;
    lastDate: string | null;
    lastKm: number | null;
    daysSinceReading: number | null;
    estimatedKmToday: number | null;
    series: Array<{ date: string; km: number }>;
    forecast: Array<{ date: string; mean: number; low: number; high: number }>;
    anomalies: Array<{ id: string; date: string; km: number; reason: string }>;
    readingsList: ReadingView[];
};

export type FuelAlert = {
    segmentId: string;
    date: string;
    lastKmPerGal: number;
    baseline: number;
    dropPct: number;
};

export type ServiceView = {
    id: string;
    itemId: string;
    itemName: string;
    km: number;
    date: string;
    cost: number;
    notes?: string;
};

export type FuelView = {
    id: string;
    date: string;
    km: number;
    gallons: number;
    total: number;
    fullTank: boolean;
    kmPerGal: number | null;
};

export type FuelStats = {
    avgKmPerGal: number | null;
    avgKmPerL: number | null;
    costPerKm: number | null;
    lastKmPerGal: number | null;
    totalSpent: number;
    totalGallons: number;
    avgPricePerGallon: number | null;
};

export type Tax = {
    regime: 'impuesto' | 'semaforizacion';
    title: string;
    detail: string;
    estimate: number | null;
    license: string;
    licenseDetail: string;
};

export type ExpenseView = {
    id: string;
    date: string;
    category: string;
    amount: number;
    note: string;
};

export type Spending = {
    total: number;
    monthTotal: number;
    month: string;
    kmDriven: number;
    costPerKmTotal: number | null;
    byCategory: Array<{ category: string; amount: number }>;
    monthByCategory: Array<{ category: string; amount: number }>;
    byMonth: Array<{ month: string; amount: number }>;
};

export type VaultItem = {
    id: string;
    kind: string;
    title: string;
    mimeType: string;
    bytes: number;
    createdAt: string;
};

export type Full = {
    profile: Profile;
    today: string;
    rate: number | null;
    estimatedKmToday: number | null;
    rtmSuggested: string | null;
    tax: Tax;
    docs: DocView[];
    items: ItemView[];
    services: ServiceView[];
    fuel: FuelView[];
    fuelStats: FuelStats;
    expenses: ExpenseView[];
    expenseCategories: string[];
    spending: Spending;
    prediction?: PredictionView;
    fuelAlert?: FuelAlert | null;
};

export type Dashboard = Full | { profile: null; today: string };

export type Run = (p: Promise<{ data: Dashboard }>, okMsg?: string) => Promise<boolean>;
