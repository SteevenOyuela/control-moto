import { useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Btn, Card, Modal } from './components';
import Cropper from './Cropper';
import { errMsg, squarePng } from './lib';

/** Sección de Ajustes para subir el logo que se ve al abrir la app. */
export default function LogoSettings({
    logo,
    setLogo,
    notify,
}: {
    logo: string | null;
    setLogo: (dataUrl: string | null) => void;
    notify: (kind: 'ok' | 'error', text: string) => void;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [raw, setRaw] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);

    const save = async (blob: Blob) => {
        setRaw(null);
        setBusy(true);
        try {
            const data = await squarePng(blob, 512);
            await api.post('/api/logo', { data });
            setLogo(`data:image/png;base64,${data}`);
            notify('ok', 'Logo guardado');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    const remove = async () => {
        setBusy(true);
        try {
            await api.delete('/api/logo');
            setLogo(null);
            notify('ok', 'Logo eliminado');
        } catch (e) {
            notify('error', errMsg(e));
        }
        setBusy(false);
    };

    return (
        <Card className="space-y-3">
            <div className="flex items-center gap-3">
                {logo ? (
                    <img src={logo} alt="Tu logo" className="h-16 w-16 rounded-2xl object-cover shadow" />
                ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 text-zinc-400 dark:border-zinc-700">
                        <ImagePlus size={24} />
                    </div>
                )}
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Tu logo aparece al abrir la app, en el encabezado y como ícono al agregarla a la pantalla de inicio.
                </p>
            </div>
            <div className="flex gap-2">
                <Btn className="flex-1" onClick={() => inputRef.current?.click()} disabled={busy}>
                    <ImagePlus size={16} /> {logo ? 'Cambiar logo' : 'Subir logo'}
                </Btn>
                {logo && (
                    <Btn variant="danger" onClick={remove} disabled={busy} ariaLabel="Quitar logo">
                        <Trash2 size={16} />
                    </Btn>
                )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                En iPhone, para que el ícono cambie elimina el acceso de la pantalla de inicio y vuelve a agregarlo desde
                Safari (Compartir → Agregar a inicio).
            </p>
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Imagen del logo"
                onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = '';
                    if (f) setRaw(f);
                }}
            />
            <Modal open={raw !== null} title="Recorta tu logo" onClose={() => setRaw(null)}>
                {raw && <Cropper file={raw} aspect={1} output="image/png" onCancel={() => setRaw(null)} onDone={save} />}
            </Modal>
        </Card>
    );
}
