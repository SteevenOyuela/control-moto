import { useCallback, useEffect, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { Bike, House, Settings as SettingsIcon, ShieldCheck, Wallet, WifiOff, Wrench } from 'lucide-react';
import { Btn, Card } from './components';
import Home from './Home';
import Legal from './Legal';
import Maint from './Maint';
import Expenses from './Expenses';
import Settings from './Settings';
import ProfileForm from './ProfileForm';
import {
    applyTheme,
    errMsg,
    loadCache,
    loadLogo,
    loadTheme,
    saveCache,
    saveLogo,
    saveTheme,
    setTouchIcon,
} from './lib';
import type { Theme } from './lib';
import type { Dashboard, Full, Run } from './types';

type Tab = 'home' | 'legal' | 'maint' | 'fuel' | 'settings';
type Toast = { kind: 'ok' | 'error'; text: string };

const TABS: Array<{ id: Tab; label: string; icon: typeof House }> = [
    { id: 'home', label: 'Inicio', icon: House },
    { id: 'legal', label: 'Legal', icon: ShieldCheck },
    { id: 'maint', label: 'Taller', icon: Wrench },
    { id: 'fuel', label: 'Gastos', icon: Wallet },
    { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
];

const SPLASH_MIN_MS = 1100;

/** Logo del usuario si lo subió; si no, el ícono de la app. */
function BrandMark({ logo, size }: { logo: string | null; size: number }) {
    if (logo) {
        return (
            <img
                src={logo}
                alt="Logo"
                className="rounded-[22%] object-cover shadow-lg"
                style={{ width: size, height: size }}
            />
        );
    }
    return (
        <div
            className="flex items-center justify-center rounded-[22%] bg-red-600 text-white shadow-lg"
            style={{ width: size, height: size }}
        >
            <Bike size={Math.round(size * 0.55)} />
        </div>
    );
}

export default function Root() {
    const [authState, setAuthState] = useState<'loading' | 'out' | 'in'>('loading');
    const [userId, setUserId] = useState('');
    const [dash, setDash] = useState<Dashboard | null>(null);
    const [offline, setOffline] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [signInError, setSignInError] = useState('');
    const [tab, setTab] = useState<Tab>('home');
    const [toast, setToast] = useState<Toast | null>(null);
    const [theme, setTheme] = useState<Theme>(loadTheme());
    const [logo, setLogoState] = useState<string | null>(loadLogo());
    const [minSplashDone, setMinSplashDone] = useState(false);
    const [splashGone, setSplashGone] = useState(false);
    const toastTimer = useRef<number | undefined>(undefined);

    const setLogo = useCallback((dataUrl: string | null) => {
        saveLogo(dataUrl);
        setLogoState(dataUrl);
        setTouchIcon(dataUrl);
    }, []);

    useEffect(() => {
        setTouchIcon(loadLogo());
        const t = window.setTimeout(() => setMinSplashDone(true), SPLASH_MIN_MS);
        return () => window.clearTimeout(t);
    }, []);

    useEffect(() => {
        applyTheme(theme);
        saveTheme(theme);
        if (theme !== 'system') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const fn = () => applyTheme('system');
        mq.addEventListener('change', fn);
        return () => mq.removeEventListener('change', fn);
    }, [theme]);

    const notify = useCallback((kind: Toast['kind'], text: string) => {
        setToast({ kind, text });
        window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 4500);
    }, []);

    const load = useCallback(async (uid: string) => {
        setLoadError('');
        try {
            const r = await api.get('/api/dashboard');
            setDash(r.data as Dashboard);
            setOffline(false);
            saveCache(uid, r.data as Dashboard);
        } catch (e) {
            const cached = loadCache(uid);
            if (cached) {
                setDash(cached);
                setOffline(true);
            } else {
                setLoadError(errMsg(e));
            }
        }
    }, []);

    const syncLogo = useCallback(async () => {
        try {
            const r = await api.get('/api/logo');
            const d = r.data as { data: string | null; mimeType?: string };
            setLogo(d.data ? `data:${d.mimeType || 'image/png'};base64,${d.data}` : null);
        } catch {
            /* sin conexión: se mantiene el logo guardado en el celular */
        }
    }, [setLogo]);

    useEffect(() => {
        (async () => {
            try {
                const u = await auth.getUser();
                if (!u) {
                    setAuthState('out');
                    return;
                }
                setUserId(u.userId);
                setAuthState('in');
                await load(u.userId);
                void syncLogo();
            } catch (e) {
                setSignInError(errMsg(e));
                setAuthState('out');
            }
        })();
    }, [load, syncLogo]);

    const run: Run = useCallback(
        async (p, okMsg) => {
            try {
                const r = await p;
                setDash(r.data);
                saveCache(userId, r.data);
                setOffline(false);
                if (okMsg) notify('ok', okMsg);
                return true;
            } catch (e) {
                notify('error', errMsg(e));
                return false;
            }
        },
        [userId, notify],
    );

    const ready = authState === 'out' || (authState === 'in' && (dash !== null || loadError !== ''));
    const showSplash = !(ready && minSplashDone);
    useEffect(() => {
        if (showSplash) return;
        const t = window.setTimeout(() => setSplashGone(true), 400);
        return () => window.clearTimeout(t);
    }, [showSplash]);

    const overlays = (
        <>
            {/* Franja bajo la barra de estado del iPhone (notch / Dynamic Island). */}
            <div
                aria-hidden="true"
                className="fixed inset-x-0 top-0 z-[70] bg-red-600 dark:bg-zinc-950"
                style={{ height: 'env(safe-area-inset-top)' }}
            />
            {!splashGone && (
                <div
                    aria-hidden={!showSplash}
                    className={`fixed inset-0 z-[80] flex flex-col items-center justify-center gap-5 bg-zinc-50 transition-opacity duration-300 dark:bg-zinc-950 ${
                        showSplash ? 'opacity-100' : 'pointer-events-none opacity-0'
                    }`}
                >
                    <div className="animate-[pulse_1.6s_ease-in-out_infinite]">
                        <BrandMark logo={logo} size={120} />
                    </div>
                    <div className="text-2xl font-extrabold tracking-tight">Control Moto</div>
                </div>
            )}
            {toast && (
                <div
                    role={toast.kind === 'error' ? 'alert' : 'status'}
                    className={`fixed left-1/2 z-[75] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${
                        toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                    }`}
                    style={{ top: 'calc(env(safe-area-inset-top) + 0.75rem)' }}
                >
                    {toast.text}
                </div>
            )}
        </>
    );

    const safeTop = { paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' };

    if (authState === 'loading') {
        return <>{overlays}</>;
    }

    if (authState === 'out') {
        return (
            <>
                {overlays}
                <div
                    className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center"
                    style={safeTop}
                >
                    <BrandMark logo={logo} size={88} />
                    <div>
                        <h1 className="text-3xl font-extrabold">Control Moto</h1>
                        <p className="mt-2 max-w-sm text-zinc-600 dark:text-zinc-300">
                            SOAT, tecnomecánica, mantenimientos y gasolina de tu moto en un solo lugar, con alertas antes
                            de que se te pase algo.
                        </p>
                    </div>
                    <Btn
                        className="w-full max-w-xs"
                        onClick={async () => {
                            setSignInError('');
                            try {
                                await auth.signInWithRedirect();
                            } catch (e) {
                                setSignInError(errMsg(e));
                            }
                        }}
                    >
                        Iniciar sesión
                    </Btn>
                    {signInError && (
                        <p role="alert" className="text-sm text-red-600">
                            {signInError}
                        </p>
                    )}
                </div>
            </>
        );
    }

    if (!dash) {
        return (
            <>
                {overlays}
                <div
                    className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
                    style={safeTop}
                >
                    {loadError ? (
                        <>
                            <p role="alert" className="text-red-600">
                                No pude cargar tus datos: {loadError}
                            </p>
                            <Btn onClick={() => load(userId)}>Reintentar</Btn>
                        </>
                    ) : (
                        <p className="text-zinc-500">Cargando tu moto…</p>
                    )}
                </div>
            </>
        );
    }

    if (!dash.profile) {
        return (
            <>
                {overlays}
                <div className="mx-auto max-w-xl px-4 pb-8" style={safeTop}>
                    <div className="mb-6 mt-4 flex items-center gap-3">
                        <BrandMark logo={logo} size={52} />
                        <div>
                            <h1 className="text-2xl font-extrabold">Registra tu moto</h1>
                            <p className="text-sm text-zinc-500 dark:text-zinc-400">Solo toma un minuto.</p>
                        </div>
                    </div>
                    <Card>
                        <ProfileForm
                            showDocs
                            submitLabel="Empezar"
                            onSubmit={(p) => run(api.put('/api/profile', p), '¡Listo! Tu moto quedó registrada')}
                        />
                    </Card>
                </div>
            </>
        );
    }

    const data = dash as Full;

    return (
        <div className="min-h-screen pb-24">
            {overlays}
            <header
                className="sticky top-0 z-40 bg-red-600 text-white shadow-sm dark:border-b dark:border-zinc-800 dark:bg-zinc-950/95 dark:backdrop-blur"
                style={{ paddingTop: 'env(safe-area-inset-top)' }}
            >
                <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                        {logo ? (
                            <img src={logo} alt="Logo" className="h-7 w-7 rounded-lg object-cover" />
                        ) : (
                            <Bike size={22} className="dark:text-red-500" />
                        )}
                        <span className="truncate text-lg font-extrabold">Control Moto</span>
                    </div>
                    <span className="text-sm text-white/80 dark:text-zinc-400">
                        {TABS.find((t) => t.id === tab)?.label}
                    </span>
                </div>
                {offline && (
                    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        <WifiOff size={14} /> Sin conexión: mostrando tus últimos datos guardados
                    </div>
                )}
            </header>

            <main className="mx-auto max-w-xl px-4 pt-4">
                {tab === 'home' && <Home data={data} run={run} goTo={setTab} />}
                {tab === 'legal' && <Legal data={data} run={run} userId={userId} notify={notify} />}
                {tab === 'maint' && <Maint data={data} run={run} />}
                {tab === 'fuel' && <Expenses data={data} run={run} />}
                {tab === 'settings' && (
                    <Settings
                        data={data}
                        run={run}
                        theme={theme}
                        setTheme={setTheme}
                        notify={notify}
                        logo={logo}
                        setLogo={setLogo}
                    />
                )}
            </main>

            <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
                <div className="mx-auto grid max-w-xl grid-cols-5">
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => {
                                setTab(t.id);
                                window.scrollTo(0, 0);
                            }}
                            aria-current={tab === t.id ? 'page' : undefined}
                            className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${
                                tab === t.id ? 'text-red-600' : 'text-zinc-500 dark:text-zinc-400'
                            }`}
                        >
                            <t.icon size={22} />
                            {t.label}
                        </button>
                    ))}
                </div>
            </nav>
        </div>
    );
}
