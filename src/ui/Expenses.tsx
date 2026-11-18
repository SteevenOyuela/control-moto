import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { Btn, Card, Confirm, Field, Modal, SectionTitle, Segmented, Stat, inputCls } from './components';
import FuelPage from './FuelPage';
import ReceiptScan from './ReceiptScan';
import { fmtDate, fmtKm, fmtMoney, parseNum, todayLocal } from './lib';
import type { ExpenseView, Full, Run } from './types';

type View = 'fuel' | 'other' | 'summary';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    return `${MONTH_NAMES[mm - 1]} ${y}`;
};
const monthLabel = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    return `${MONTHS[mm - 1]} ${String(y).slice(2)}`;
};

export default function Expenses({ data, run }: { data: Full; run: Run }) {
    const [view, setView] = useState<View>('fuel');
    return (
        <div>
            <Segmented
                value={view}
                onChange={setView}
                options={[
                    { value: 'fuel', label: 'Gasolina' },
                    { value: 'other', label: 'Otros gastos' },
                    { value: 'summary', label: 'Resumen' },
                ]}
            />
            <div className="mt-4">
                {view !== 'summary' && (
                    <div className="mb-4">
                        <ReceiptScan data={data} run={run} />
                    </div>
                )}
                {view === 'fuel' && <FuelPage data={data} run={run} />}
                {view === 'other' && <OtherExpenses data={data} run={run} />}
                {view === 'summary' && <Summary data={data} />}
            </div>
        </div>
    );
}

type ExpensePayload = { date: string; category: string; amount: number; note: string };

function ExpenseForm({
    categories,
    initial,
    submitLabel,
    onSave,
}: {
    categories: string[];
    initial?: ExpenseView;
    submitLabel: string;
    onSave: (p: ExpensePayload) => Promise<boolean>;
}) {
    const [date, setDate] = useState(initial?.date ?? todayLocal());
    const [category, setCategory] = useState(initial?.category ?? categories[0] ?? 'Otros');
    const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
    const [note, setNote] = useState(initial?.note ?? '');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const n = parseNum(amount);
        if (n === null || n <= 0) {
            setErr('Escribe el valor del gasto.');
            return;
        }
        setErr('');
        setBusy(true);
        const ok = await onSave({ date, category, amount: n, note });
        setBusy(false);
        if (ok && !initial) {
            setAmount('');
            setNote('');
        }
    };

    return (
        <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Categoría" className="col-span-2 sm:col-span-1">
                    <select className={inputCls} aria-label="Categoría" value={category} onChange={(e) => setCategory(e.target.value)}>
                        {categories.map((c) => (
                            <option key={c}>{c}</option>
                        ))}
                    </select>
                </Field>
                <Field label="Fecha" className="col-span-2 sm:col-span-1">
                    <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Valor (COP)" error={err} className="col-span-2 sm:col-span-1">
                    <input
                        className={inputCls}
                        inputMode="numeric"
                        aria-label="Valor del gasto"
                        placeholder="5000"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                    />
                </Field>
                <Field label="Nota" className="col-span-2 sm:col-span-1">
                    <input
                        className={inputCls}
                        value={note}
                        placeholder="Centro comercial, guantes…"
                        onChange={(e) => setNote(e.target.value)}
                    />
                </Field>
            </div>
            <Btn type="submit" disabled={busy} className="w-full">
                {busy ? 'Guardando…' : submitLabel}
            </Btn>
        </form>
    );
}

function OtherExpenses({ data, run }: { data: Full; run: Run }) {
    const [editing, setEditing] = useState<ExpenseView | null>(null);
    const [deleting, setDeleting] = useState<ExpenseView | null>(null);
    const [open, setOpen] = useState<Record<string, boolean>>({});

    // Historial agrupado por mes (más reciente primero) con el total de cada mes.
    const months: Array<{ month: string; total: number; items: ExpenseView[] }> = [];
    for (const x of data.expenses) {
        const m = x.date.slice(0, 7);
        let g = months.find((g2) => g2.month === m);
        if (!g) {
            g = { month: m, total: 0, items: [] };
            months.push(g);
        }
        g.total += x.amount;
        g.items.push(x);
    }
    months.sort((a, b) => (a.month < b.month ? 1 : -1));
    const isOpen = (m: string, i: number) => open[m] ?? i === 0;

    return (
        <div>
            <Card>
                <ExpenseForm
                    categories={data.expenseCategories}
                    submitLabel="Guardar gasto"
                    onSave={(p) => run(api.post('/api/expenses', p), 'Gasto registrado')}
                />
            </Card>

            <SectionTitle>Historial por mes</SectionTitle>
            {months.length === 0 ? (
                <Card>
                    <p className="text-sm">Aún no registras gastos. Parqueaderos, lavadas y accesorios van aquí.</p>
                </Card>
            ) : (
                <div className="space-y-3">
                    {months.map((g, idx) => (
                        <Card key={g.month} className="!p-0">
                            <button
                                type="button"
                                onClick={() => setOpen((o) => ({ ...o, [g.month]: !isOpen(g.month, idx) }))}
                                className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
                                aria-expanded={isOpen(g.month, idx)}
                            >
                                <div className="flex items-center gap-2">
                                    {isOpen(g.month, idx) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                    <span className="font-semibold capitalize">{monthName(g.month)}</span>
                                    <span className="text-xs text-zinc-500">
                                        {g.items.length} gasto{g.items.length === 1 ? '' : 's'}
                                    </span>
                                </div>
                                <span className="font-bold tabular-nums">{fmtMoney(g.total)}</span>
                            </button>
                            {isOpen(g.month, idx) && (
                                <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                                    {g.items.map((x) => (
                                        <li key={x.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                                            <div className="min-w-0">
                                                <div className="font-semibold">
                                                    {x.category} · {fmtMoney(x.amount)}
                                                </div>
                                                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                                    {fmtDate(x.date)}
                                                    {x.note ? ` · ${x.note}` : ''}
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 gap-1">
                                                <Btn
                                                    variant="ghost"
                                                    className="!px-2 !py-1.5"
                                                    onClick={() => setEditing(x)}
                                                    ariaLabel={`Editar gasto ${x.category}`}
                                                >
                                                    <Pencil size={16} />
                                                </Btn>
                                                <Btn
                                                    variant="ghost"
                                                    className="!px-2 !py-1.5"
                                                    onClick={() => setDeleting(x)}
                                                    ariaLabel={`Eliminar gasto ${x.category}`}
                                                >
                                                    <Trash2 size={16} />
                                                </Btn>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            <Modal open={editing !== null} title="Editar gasto" onClose={() => setEditing(null)}>
                {editing && (
                    <ExpenseForm
                        key={editing.id}
                        categories={data.expenseCategories}
                        initial={editing}
                        submitLabel="Guardar cambios"
                        onSave={async (p) => {
                            const ok = await run(api.put(`/api/expenses/${editing.id}`, p), 'Gasto actualizado');
                            if (ok) setEditing(null);
                            return ok;
                        }}
                    />
                )}
            </Modal>

            <Confirm
                open={deleting !== null}
                title="Eliminar gasto"
                message={`¿Eliminar el gasto de ${deleting?.category ?? ''} por ${deleting ? fmtMoney(deleting.amount) : ''}?`}
                onCancel={() => setDeleting(null)}
                onConfirm={async () => {
                    const d = deleting;
                    setDeleting(null);
                    if (d) await run(api.delete(`/api/expenses/${d.id}`), 'Gasto eliminado');
                }}
            />
        </div>
    );
}

function Bars({ rows, total }: { rows: Array<{ label: string; amount: number }>; total: number }) {
    const max = Math.max(1, ...rows.map((r) => r.amount));
    return (
        <div className="space-y-2">
            {rows.map((r) => (
                <div key={r.label}>
                    <div className="flex justify-between gap-2 text-sm">
                        <span>{r.label}</span>
                        <span className="font-semibold tabular-nums">
                            {fmtMoney(r.amount)}
                            {total > 0 && (
                                <span className="ml-1 text-xs font-normal text-zinc-500">
                                    {Math.round((r.amount / total) * 100)}%
                                </span>
                            )}
                        </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                        <div className="h-2 rounded-full bg-red-500" style={{ width: `${(r.amount / max) * 100}%` }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function Summary({ data }: { data: Full }) {
    const s = data.spending;
    return (
        <div>
            <div className="grid grid-cols-2 gap-2">
                <Stat label={`Este mes (${monthLabel(s.month)})`} value={fmtMoney(s.monthTotal)} />
                <Stat label="Total registrado" value={fmtMoney(s.total)} />
                <Stat
                    label="Costo total por km"
                    value={s.costPerKmTotal !== null ? fmtMoney(s.costPerKmTotal) : '—'}
                    sub={s.kmDriven > 0 ? `en ${fmtKm(s.kmDriven)} registrados` : 'Registra más kilometraje'}
                />
                <Stat label="Gasolina" value={fmtMoney(data.fuelStats.totalSpent)} />
            </div>

            <SectionTitle>Este mes por categoría</SectionTitle>
            <Card>
                {s.monthByCategory.length === 0 ? (
                    <p className="text-sm">Sin gastos este mes.</p>
                ) : (
                    <Bars rows={s.monthByCategory.map((c) => ({ label: c.category, amount: c.amount }))} total={s.monthTotal} />
                )}
            </Card>

            <SectionTitle>Últimos 6 meses</SectionTitle>
            <Card>
                <Bars rows={s.byMonth.map((m) => ({ label: monthLabel(m.month), amount: m.amount }))} total={0} />
            </Card>

            <SectionTitle>Histórico por categoría</SectionTitle>
            <Card>
                {s.byCategory.length === 0 ? (
                    <p className="text-sm">Aún no hay gastos registrados.</p>
                ) : (
                    <Bars rows={s.byCategory.map((c) => ({ label: c.category, amount: c.amount }))} total={s.total} />
                )}
            </Card>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                Incluye gasolina, mantenimientos (con costo) y otros gastos.
            </p>
        </div>
    );
}
