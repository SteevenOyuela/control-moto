/** Barra de filtros rápidos con desplazamiento horizontal; queda fija bajo el encabezado al hacer scroll. */
export default function FilterChips({
    value,
    onChange,
    options,
}: {
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string; count?: number }>;
}) {
    return (
        <div
            className="sticky z-30 -mx-4 bg-zinc-50/95 px-4 py-2 backdrop-blur dark:bg-zinc-950/95"
            style={{ top: 'calc(env(safe-area-inset-top) + 52px)' }}
        >
            <div className="flex gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="Filtros">
                {options.map((o) => (
                    <button
                        key={o.value}
                        type="button"
                        role="tab"
                        aria-selected={value === o.value}
                        onClick={() => onChange(o.value)}
                        className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ${
                            value === o.value
                                ? 'bg-red-600 text-white'
                                : 'bg-white text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800'
                        }`}
                    >
                        {o.label}
                        {o.count !== undefined && (
                            <span
                                className={`rounded-full px-1.5 text-xs ${
                                    value === o.value ? 'bg-white/25' : 'bg-zinc-100 dark:bg-zinc-800'
                                }`}
                            >
                                {o.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
