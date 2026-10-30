import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, CheckCircle2, Clock, Gift, ListChecks, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { DistributionAnalytics, Occasion } from '../types';
import { DEFAULT_YEAR, YEAR_OPTIONS } from '../config/diwaliYear';
import { SearchableSelect } from './SearchableSelect';
import { YearPicker } from './YearPicker';
import { onDistributionsChanged } from '../utils/distributionEvents';

// Near-real-time: fetched on open, on a timer while the tab is visible, and when the tab regains focus.
const POLL_MS = 15000;
const number = (value: number) => value.toLocaleString('en-IN');

const Card: React.FC<{ label: string; value: number; icon: React.ReactNode; tone: string; hint?: string }> = ({ label, value, icon, tone, hint }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-card={label}>
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${tone}`}>{icon}</span>
    </div>
    <p className="mt-2 text-3xl font-bold text-slate-900 tabular-nums" data-value>{number(value)}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
  </div>
);

export const HomeAnalytics: React.FC = () => {
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [occasion, setOccasion] = useState('Diwali');
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [data, setData] = useState<DistributionAnalytics | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async (initial = false) => {
    controller.current?.abort();
    const current = controller.current = new AbortController();
    if (initial) setState('loading');
    try {
      const result = await api.getDistributionAnalytics(year, occasion, current.signal);
      if (current.signal.aborted) return;
      setData(result.data); setState('ready'); setMessage('');
    } catch (error: any) {
      if (current.signal.aborted || error?.name === 'AbortError') return;
      setMessage(error.message || 'Unable to load analytics.'); setState('error');
    }
  }, [year, occasion]);

  useEffect(() => { api.getOccasions().then(result => setOccasions(result.data)).catch(() => { /* Diwali stays selectable */ }); }, []);
  useEffect(() => {
    setData(null); load(true);
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick);
    const stopListening = onDistributionsChanged(() => load());
    return () => { stopListening(); clearInterval(timer); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); controller.current?.abort(); };
  }, [load]);

  const total = data ? data.delivered + data.pending : 0; // distributions recorded; Total Entries also counts clients with none yet
  const deliveredPct = total ? Math.round((data!.delivered / total) * 100) : 0;

  return (
    <section aria-label="Distribution analytics" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm space-y-5" data-analytics>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><BarChart3 className="w-4 h-4 text-amber-600" />Distribution Analytics</h2>
          <p className="mt-0.5 text-xs text-slate-500">Live totals for the selected occasion and year. Reverted entries are not counted.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-44 text-xs font-semibold text-slate-600">Occasion
            <SearchableSelect ariaLabel="Analytics occasion" size="filter" clearable={false} className="mt-1.5" value={occasion} onChange={value => setOccasion(value || 'Diwali')}
              options={(occasions.length ? occasions : [{ _id: 'diwali', name: 'Diwali', isDefault: true }]).map(item => ({ value: item.name, label: item.name }))} />
          </div>
          <div className="w-44 text-xs font-semibold text-slate-600">Year
            <YearPicker ariaLabel="Analytics year" label={occasion} className="mt-1.5" value={year} years={YEAR_OPTIONS} currentYear={DEFAULT_YEAR} onChange={setYear} />
          </div>
          <button type="button" onClick={() => load(true)} disabled={state === 'loading'} aria-label="Refresh analytics" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:text-amber-700 hover:border-amber-300 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${state === 'loading' ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {state === 'error' && <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{message}
        <button type="button" onClick={() => load(true)} className="font-semibold underline">Retry</button></p>}

      {state === 'loading' && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true" aria-label="Loading analytics">
          {[0, 1, 2, 3].map(index => <div key={index} className="h-[102px] animate-pulse rounded-xl border border-slate-200 bg-slate-50" />)}
        </div>
      ) : data && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card label="Total Entries" value={data.totalEntries} icon={<ListChecks className="w-4 h-4" />} tone="bg-slate-100 border-slate-200 text-slate-700" />
          <Card label="Delivered" value={data.delivered} icon={<CheckCircle2 className="w-4 h-4" />} tone="bg-emerald-50 border-emerald-200 text-emerald-700" hint={`${number(data.deliveredQuantity)} qty`} />
          <Card label="Pending" value={data.pending} icon={<Clock className="w-4 h-4" />} tone="bg-amber-50 border-amber-200 text-amber-700" hint={`${number(data.pendingQuantity)} qty`} />
          <Card label="Total Quantity" value={data.totalQuantity} icon={<Gift className="w-4 h-4" />} tone="bg-amber-50 border-amber-200 text-amber-700" />
        </div>

        {total === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500" data-empty>No distributions recorded for {data.occasion} {data.year} yet. {number(data.totalEntries)} registered {data.totalEntries === 1 ? 'client is' : 'clients are'} waiting.</p>
        ) : (
          <div data-chart>
            <div className="mb-1.5 flex justify-between text-xs font-semibold text-slate-600"><span>Delivered vs Pending</span><span>{deliveredPct}% delivered</span></div>
            <div role="img" aria-label={`${data.delivered} delivered and ${data.pending} pending out of ${total} distributions`} className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="bg-slate-900 transition-all duration-500" style={{ width: `${(data.delivered / total) * 100}%` }} />
              <div className="bg-amber-500 transition-all duration-500" style={{ width: `${(data.pending / total) * 100}%` }} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-slate-900" />Delivered {number(data.delivered)}</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-amber-500" />Pending {number(data.pending)}</span>
              <span className="ml-auto text-slate-400">Updated {new Date(data.generatedAt).toLocaleTimeString('en-IN')}</span>
            </div>
          </div>
        )}
      </>}
    </section>
  );
};
