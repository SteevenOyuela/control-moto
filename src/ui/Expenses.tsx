import { useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@appdeploy/client';
import { Trash2 } from 'lucide-react';
import { Btn, Card, Confirm, Field, SectionTitle, Segmented, Stat, inputCls } from './components';
import FuelPage from './FuelPage';
import ReceiptScan from './ReceiptScan';
import { fmtDate, fmtKm, fmtMoney, parseNum, todayLocal } from './lib';
import type { ExpenseView, Full, Run } from './types';

type View = 'fuel' | 'other' | 'summary';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
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

function OtherExpenses({ data, run }: { data: Full; run: Run }) {
    const [date, setDate] = useState(todayLocal());
    const [category, setCategory] = useState(data.expenseCategories[0] ?? 'Otros');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [deleting, setDeleting] = useState<ExpenseView | null>(null);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        const n = parseNum(amount);
        if (n === null || n <= 0) {
            setErr('Escribe el valor del gasto.');
            return;
        }
        setErr('');
        setBusy(true);
        const ok = await run(api.post('/api/expenses', { date, category, amount: n, note }), 'Gasto registrado');
        setBusy(false);
        if (ok) {
            setAmount('');
            setNote('');
        }
    };

    return (
        <div>
            <Card>
                <form onSubmit={submit} className="space-y-4" noValidate>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Categoría" className="col-span-2 sm:col-span-1">
                            <select
                                className={inputCls}
                                aria-label="Categoría"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                            >
                                {data.expenseCategories.map((c) => (
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
                        {busy ? 'Guardando…' : 'Guardar gasto'}
                    </Btn>
                </form>
            </Card>

            <SectionTitle>Últimos gastos</SectionTitle>
            {data.expenses.length === 0 ? (
                <Card>
                    <p className="text-sm">Aún no registras gastos. Parqueaderos, lavadas y accesorios van aquí.</p>
                </Card>
            ) : (
                <div className="space-y-2">
                    {data.expenses.map((x) => (
                        <Card key={x.id} className="!p-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="font-semibold">
                                        {x.category} · {fmtMoney(x.amount)}
                                    </div>
                                    <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                                        {fmtDate(x.date)}
                                        {x.note ? ` · ${x.note}` : ''}
                                    </div>
                                </div>
                                <Btn
                                    variant="ghost"
                                    className="!px-2 !py-1.5"
                                    onClick={() => setDeleting(x)}
                                    ariaLabel={`Eliminar gasto ${x.category}`}
                                >
                                    <Trash2 size={16} />
                                </Btn>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

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
