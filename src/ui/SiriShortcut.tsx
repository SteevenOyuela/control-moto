import { useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import { Copy, KeyRound, Mic, ShieldOff } from 'lucide-react';
import { Btn, Card, Confirm } from './components';
import { errMsg, fmtDate } from './lib';

declare global {
    interface Window {
        __APPDEPLOY_APP_ID?: string;
    }
}

/** Dirección pública que llama el Atajo de iOS (el backend vive en api-v2.appdeploy.ai). */
export function shortcutUrl(): string {
    const appId = window.__APPDEPLOY_APP_ID || 'control-moto-2feidy';
    return `https://api-v2.appdeploy.ai/app/${appId}/api/shortcut/km`;
}

async function copy(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/** Ajustes → Atajo de Siri: genera un token personal y explica cómo armar el Atajo. */
export default function SiriShortcut({ notify }: { notify: (kind: 'ok' | 'error', text: string) => void }) {
    const [status, setStatus] = useState<{ enabled: boolean; createdAt: string | null } | null>(null);
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirmNew, setConfirmNew] = useState(false);
    const [confirmRevoke, setConfirmRevoke] = useState(false);
    const [showSteps, setShowSteps] = useState(false);
    const url = shortcutUrl();

    useEffect(() => {
        api.get('/api/shortcut')
            .then((r) => setStatus(r.data as { enabled: boolean; createdAt: string | null }))
            .catch(() => setStatus(null));
    }, []);

    const create = async () => {
        setConfirmNew(false);
        setBusy(true);
        try {
            const r = await api.post('/api/shortcut');
            const d = r.data as { token: string; createdAt: string };
            setToken(d.token);
            setStatus({ enabled: true, createdAt: d.createdAt });
            setShowSteps(true);
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    const revoke = async () => {
        setConfirmRevoke(false);
        setBusy(true);
        try {
            await api.delete('/api/shortcut');
            setToken('');
            setStatus({ enabled: false, createdAt: null });
            notify('ok', 'Atajo desactivado');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    const copyBtn = (text: string, label: string) => (
        <Btn
            variant="secondary"
            className="!px-2 !py-1.5"
            ariaLabel={`Copiar ${label}`}
            onClick={async () => {
                const ok = await copy(text);
                notify(ok ? 'ok' : 'error', ok ? `${label} copiado` : 'No se pudo copiar');
            }}
        >
            <Copy size={14} />
        </Btn>
    );

    return (
        <Card className="space-y-3">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-zinc-900 p-2 text-white dark:bg-zinc-100 dark:text-zinc-900">
                    <Mic size={20} />
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Actualiza el kilometraje en 2 segundos sin abrir la app: “Oye Siri, registrar kilometraje”, o
                    automáticamente al desconectar el Bluetooth del intercomunicador.
                </p>
            </div>

            {status?.enabled && !token && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                    Atajo activo{status.createdAt ? ` desde el ${fmtDate(status.createdAt.slice(0, 10))}` : ''}.
                </p>
            )}

            {token && (
                <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
                    <p className="font-semibold text-amber-900 dark:text-amber-200">
                        Tu token personal (solo se muestra esta vez):
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 break-all rounded-lg bg-white p-2 text-xs dark:bg-zinc-900">{token}</code>
                        {copyBtn(token, 'Token')}
                    </div>
                    <p className="text-xs text-amber-800 dark:text-amber-300">
                        Pégalo en el Atajo y no lo compartas: quien lo tenga puede registrar kilometraje en tu moto. Si lo
                        pierdes, genera uno nuevo y el anterior deja de funcionar.
                    </p>
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <Btn onClick={() => (status?.enabled ? setConfirmNew(true) : create())} disabled={busy}>
                    <KeyRound size={16} /> {status?.enabled ? 'Generar token nuevo' : 'Activar atajo'}
                </Btn>
                {status?.enabled && (
                    <Btn variant="danger" onClick={() => setConfirmRevoke(true)} disabled={busy}>
                        <ShieldOff size={16} /> Desactivar
                    </Btn>
                )}
                <Btn variant="ghost" onClick={() => setShowSteps((v) => !v)}>
                    {showSteps ? 'Ocultar pasos' : 'Ver cómo crearlo'}
                </Btn>
            </div>

            {showSteps && (
                <div className="space-y-3 text-sm">
                    <ol className="list-decimal space-y-2 pl-5 text-zinc-700 dark:text-zinc-300">
                        <li>
                            Abre la app <b>Atajos</b> → <b>+</b> → nómbralo <b>Registrar kilometraje</b>.
                        </li>
                        <li>
                            Agrega <b>Solicitar entrada</b>: tipo <b>Número</b>, pregunta “¿Cuántos km marca el tablero?”.
                        </li>
                        <li>
                            Agrega <b>Obtener contenido de URL</b> con esta URL:
                            <div className="mt-1 flex items-center gap-2">
                                <code className="min-w-0 flex-1 break-all rounded-lg bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
                                    {url}
                                </code>
                                {copyBtn(url, 'URL')}
                            </div>
                            Toca <b>Mostrar más</b>: Método <b>POST</b>, Cuerpo de la solicitud <b>JSON</b> y agrega dos
                            campos:
                            <ul className="mt-1 list-disc pl-5">
                                <li>
                                    <b>token</b> (Texto) = tu token
                                </li>
                                <li>
                                    <b>km</b> (Número) = la variable <b>Entrada proporcionada</b>
                                </li>
                            </ul>
                        </li>
                        <li>
                            Agrega <b>Obtener valor del diccionario</b> con la clave <b>message</b> y luego{' '}
                            <b>Mostrar resultado</b>.
                        </li>
                        <li>Pruébalo diciendo “Oye Siri, registrar kilometraje”.</li>
                    </ol>
                    <div className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <b>Automático al bajarte de la moto:</b> en Atajos → <b>Automatización</b> → <b>+</b> →{' '}
                        <b>Bluetooth</b> → elige tu intercomunicador → <b>Se desconecta</b> → <b>Ejecutar inmediatamente</b>{' '}
                        → acción <b>Ejecutar atajo</b> → “Registrar kilometraje”. El iPhone te pedirá los km cada vez que
                        apagues el intercomunicador.
                    </div>
                </div>
            )}

            <Confirm
                open={confirmNew}
                title="¿Generar un token nuevo?"
                confirmLabel="Generar"
                message="El token actual dejará de funcionar y tendrás que pegar el nuevo en tu Atajo."
                onCancel={() => setConfirmNew(false)}
                onConfirm={create}
            />
            <Confirm
                open={confirmRevoke}
                title="¿Desactivar el atajo?"
                confirmLabel="Desactivar"
                message="El Atajo de iOS dejará de poder registrar kilometraje hasta que generes un token nuevo."
                onCancel={() => setConfirmRevoke(false)}
                onConfirm={revoke}
            />
        </Card>
    );
}
