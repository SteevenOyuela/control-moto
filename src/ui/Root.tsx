import { useCallback, useEffect, useRef, useState } from 'react';
import { api, auth } from '@appdeploy/client';
import { Bike, Fuel, House, Settings as SettingsIcon, ShieldCheck, WifiOff, Wrench } from 'lucide-react';
import { Btn, Card } from './components';
import Home from './Home';
import Legal from './Legal';
import Maint from './Maint';
import FuelPage from './FuelPage';
import Settings from './Settings';
import ProfileForm from './ProfileForm';
import { applyTheme, errMsg, loadCache, loadTheme, saveCache, saveTheme } from './lib';
import type { Theme } from './lib';
import type { Dashboard, Full, Run } from './types';

type Tab = 'home' | 'legal' | 'maint' | 'fuel' | 'settings';
type Toast = { kind: 'ok' | 'error'; text: string };

const TABS: Array<{ id: Tab; label: string; icon: typeof House }> = [
    { id: 'home', label: 'Inicio', icon: House },
    { id: 'legal', label: 'Legal', icon: ShieldCheck },
    { id: 'maint', label: 'Taller', icon: Wrench },
    { id: 'fuel', label: 'Gasolina', icon: Fuel },
    { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
];

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
    const toastTimer = useRef<number | undefined>(undefined);

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
            } catch (e) {
                setSignInError(errMsg(e));
                setAuthState('out');
            }
        })();
    }, [load]);

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

    const toastEl = toast && (
        <div
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`fixed left-1/2 top-4 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl px-4 py-3 text-sm font-semibold shadow-lg ${
                toast.kind === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
            }`}
        >
            {toast.text}
        </div>
    );

    if (authState === 'loading') {
        return <div className="flex min-h-screen items-center justify-center text-zinc-500">Cargando…</div>;
    }

    if (authState === 'out') {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
                <div className="rounded-3xl bg-red-600 p-5 text-white shadow-lg">
                    <Bike size={48} />
                </div>
                <div>
                    <h1 className="text-3xl font-extrabold">Control Moto</h1>
                    <p className="mt-2 max-w-sm text-zinc-600 dark:text-zinc-300">
                        SOAT, tecnomecánica, mantenimientos y gasolina de tu moto en un solo lugar, con alertas antes de
                        que se te pase algo.
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
        );
    }

    if (!dash) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
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
        );
    }

    if (!dash.profile) {
        return (
            <div className="mx-auto max-w-xl px-4 py-8">
                {toastEl}
                <div className="mb-6 flex items-center gap-3">
                    <div className="rounded-2xl bg-red-600 p-3 text-white">
                        <Bike size={28} />
                    </div>
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
        );
    }

    const data = dash as Full;

    return (
        <div className="min-h-screen pb-24">
            {toastEl}
            <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
                <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Bike size={22} className="text-red-600" />
                        <span className="text-lg font-extrabold">Control Moto</span>
                    </div>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{TABS.find((t) => t.id === tab)?.label}</span>
                </div>
                {offline && (
                    <div className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        <WifiOff size={14} /> Sin conexión: mostrando tus últimos datos guardados
                    </div>
                )}
            </header>

            <main className="mx-auto max-w-xl px-4 pt-4">
                {tab === 'home' && <Home data={data} run={run} goTo={setTab} />}
                {tab === 'legal' && <Legal data={data} run={run} />}
                {tab === 'maint' && <Maint data={data} run={run} />}
                {tab === 'fuel' && <FuelPage data={data} run={run} />}
                {tab === 'settings' && (
                    <Settings data={data} run={run} theme={theme} setTheme={setTheme} notify={notify} />
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
