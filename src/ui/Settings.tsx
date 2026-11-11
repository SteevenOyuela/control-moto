import { useEffect, useState } from 'react';
import { api, auth, notifications } from '@appdeploy/client';
import { Bell, BellRing, LogOut, Monitor, Moon, RefreshCw, Sun } from 'lucide-react';
import { Btn, Card, SectionTitle } from './components';
import ProfileForm from './ProfileForm';
import { errMsg } from './lib';
import type { Theme } from './lib';
import type { Full, Run } from './types';

export default function Settings({
    data,
    run,
    theme,
    setTheme,
    notify,
}: {
    data: Full;
    run: Run;
    theme: Theme;
    setTheme: (t: Theme) => void;
    notify: (kind: 'ok' | 'error', text: string) => void;
}) {
    const [perm, setPerm] = useState<string>('');
    const [iosHint, setIosHint] = useState(false);
    const [busy, setBusy] = useState(false);
    const [reminders, setReminders] = useState<string[] | null>(null);

    const refreshEnv = async () => {
        try {
            const env = await notifications.getEnvironment();
            setPerm(env.permission);
            setIosHint(env.platform === 'ios' && env.mode === 'browser_tab');
        } catch {
            setPerm('');
        }
    };

    useEffect(() => {
        void refreshEnv();
    }, []);

    const enable = async () => {
        setBusy(true);
        try {
            await notifications.subscribe();
            notify('ok', 'Notificaciones activadas');
        } catch (e) {
            notify('error', errMsg(e));
        }
        await refreshEnv();
        setBusy(false);
    };

    const test = async () => {
        setBusy(true);
        try {
            const r = await api.post('/api/notify-test');
            const sent = (r.data as { sent?: number })?.sent ?? 0;
            notify(sent > 0 ? 'ok' : 'error', sent > 0 ? 'Notificación de prueba enviada' : 'Este dispositivo aún no está suscrito');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    const checkNow = async () => {
        setBusy(true);
        try {
            const r = await api.post('/api/reminders/run');
            setReminders(((r.data as { messages?: string[] })?.messages ?? []) as string[]);
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    const themes: Array<{ v: Theme; label: string; icon: typeof Sun }> = [
        { v: 'system', label: 'Sistema', icon: Monitor },
        { v: 'dark', label: 'Oscuro', icon: Moon },
        { v: 'light', label: 'Claro', icon: Sun },
    ];

    return (
        <div>
            <SectionTitle>Apariencia</SectionTitle>
            <div className="grid grid-cols-3 gap-2">
                {themes.map((t) => (
                    <button
                        key={t.v}
                        onClick={() => setTheme(t.v)}
                        className={`flex flex-col items-center gap-1 rounded-2xl border p-3 text-sm font-semibold ${
                            theme === t.v
                                ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                                : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                        }`}
                    >
                        <t.icon size={18} />
                        {t.label}
                    </button>
                ))}
            </div>

            <SectionTitle>Notificaciones</SectionTitle>
            <Card className="space-y-3">
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Todos los días a las 7:00 a. m. reviso tus vencimientos y mantenimientos y te aviso si algo se acerca.
                </p>
                {iosHint && (
                    <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        En iPhone, primero toca Compartir → "Agregar a pantalla de inicio" y abre la app desde ese ícono.
                    </p>
                )}
                {perm === 'denied' && (
                    <p className="text-xs text-red-600 dark:text-red-400">
                        Bloqueaste las notificaciones. Actívalas en la configuración del navegador para este sitio.
                    </p>
                )}
                <div className="flex flex-wrap gap-2">
                    <Btn onClick={enable} disabled={busy || perm === 'granted'}>
                        <Bell size={16} /> {perm === 'granted' ? 'Activadas' : 'Activar notificaciones'}
                    </Btn>
                    <Btn variant="secondary" onClick={test} disabled={busy}>
                        <BellRing size={16} /> Probar
                    </Btn>
                    <Btn variant="secondary" onClick={checkNow} disabled={busy}>
                        <RefreshCw size={16} /> Revisar alertas ahora
                    </Btn>
                </div>
                {reminders !== null && (
                    <div className="rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-800">
                        {reminders.length === 0 ? (
                            'No hay alertas nuevas.'
                        ) : (
                            <ul className="list-disc space-y-1 pl-4">
                                {reminders.map((m, i) => (
                                    <li key={i}>{m}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}
            </Card>

            <SectionTitle>Mi moto</SectionTitle>
            <Card>
                <ProfileForm
                    initial={data.profile}
                    submitLabel="Guardar cambios"
                    onSubmit={(p) => run(api.put('/api/profile', p), 'Datos de la moto guardados')}
                />
            </Card>

            <Btn
                variant="danger"
                className="mt-6 w-full"
                onClick={async () => {
                    await auth.signOut();
                    window.location.reload();
                }}
            >
                <LogOut size={16} /> Cerrar sesión
            </Btn>
        </div>
    );
}
