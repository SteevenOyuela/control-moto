import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { Status } from './types';

export const inputCls =
    'w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none ' +
    'focus:border-red-500 focus:ring-2 focus:ring-red-500/30 ' +
    'dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return (
        <div
            className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
        >
            {children}
        </div>
    );
}

type BtnProps = {
    children: ReactNode;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    type?: 'button' | 'submit';
    disabled?: boolean;
    className?: string;
    ariaLabel?: string;
};

export function Btn({
    children,
    onClick,
    variant = 'primary',
    type = 'button',
    disabled,
    className = '',
    ariaLabel,
}: BtnProps) {
    const styles: Record<string, string> = {
        primary: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
        secondary:
            'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
        danger: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900/60',
        ghost: 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
    };
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            aria-label={ariaLabel}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
        >
            {children}
        </button>
    );
}

export function Field({
    label,
    children,
    error,
    hint,
}: {
    label: string;
    children: ReactNode;
    error?: string;
    hint?: ReactNode;
}) {
    return (
        <label className="block space-y-1">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
            {children}
            {hint && !error && <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
            {error && (
                <span role="alert" className="block text-xs font-medium text-red-600 dark:text-red-400">
                    {error}
                </span>
            )}
        </label>
    );
}

export function Modal({
    open,
    title,
    onClose,
    children,
}: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
}) {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 pb-8 shadow-xl dark:bg-zinc-900 sm:rounded-3xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold">{title}</h2>
                    <Btn variant="ghost" onClick={onClose} ariaLabel="Cerrar" className="!px-2">
                        <X size={20} />
                    </Btn>
                </div>
                {children}
            </div>
        </div>
    );
}

export function Confirm({
    open,
    title,
    message,
    confirmLabel = 'Eliminar',
    onConfirm,
    onCancel,
}: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Modal open={open} title={title} onClose={onCancel}>
            <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-300">{message}</p>
            <div className="flex gap-2">
                <Btn variant="secondary" onClick={onCancel} className="flex-1">
                    Cancelar
                </Btn>
                <Btn onClick={onConfirm} className="flex-1">
                    {confirmLabel}
                </Btn>
            </div>
        </Modal>
    );
}

const CHIP: Record<Status, { label: string; cls: string }> = {
    ok: { label: 'Al día', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
    pronto: { label: 'Pronto', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
    urgente: { label: 'Urgente', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
    vencido: { label: 'Vencido', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
};

export function Chip({ status }: { status: Status }) {
    const c = CHIP[status];
    return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${c.cls}`}>{c.label}</span>;
}

export function Progress({ value, status }: { value: number; status: Status }) {
    const color =
        status === 'vencido'
            ? 'bg-red-500'
            : status === 'pronto' || status === 'urgente'
              ? 'bg-amber-500'
              : 'bg-emerald-500';
    return (
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
        </div>
    );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="mb-2 mt-6 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{children}</h2>
            {action}
        </div>
    );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
            <div className="text-lg font-bold">{value}</div>
            {sub && <div className="text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
        </div>
    );
}
