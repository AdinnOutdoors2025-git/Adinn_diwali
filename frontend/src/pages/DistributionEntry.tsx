import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, RefreshCw, Upload, Download, Gift, RotateCcw } from 'lucide-react';
import { buildEntryWorkbook } from '../utils/entryWorkbook';
import { api, ApiError } from '../services/api';
import { BD, DistributionRow, VERTICAL_OPTIONS, VerticalType } from '../types';
import { InlineClientRow, ClientDraft } from '../components/InlineClientRow';
import { Modal } from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { ClientManagement } from './ClientManagement';

const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
const control = 'w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20';
// Diwali tracking starts in 2026; earlier years are intentionally not selectable.
const YEAR_OPTIONS = [2026, 2027, 2028, 2029];
type Status = 'ALL' | 'GIVEN' | 'NOT_GIVEN';

export const DistributionEntry: React.FC = () => {
  const { success, info } = useToast();
  const [duplicate, setDuplicate] = useState<ClientDraft | null>(null);
  const [linking, setLinking] = useState(false);
  const currentYear = Math.min(Math.max(new Date().getFullYear(), YEAR_OPTIONS[0]), YEAR_OPTIONS[YEAR_OPTIONS.length - 1]);
  const [year, setYear] = useState(currentYear);
  const [vertical, setVertical] = useState('ALL');
  const [bd, setBD] = useState('ALL');
  const [status, setStatus] = useState<Status>('ALL');
  const [search, setSearch] = useState('');
  const [bds, setBDs] = useState<BD[]>([]);
  const [records, setRecords] = useState<DistributionRow[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pageError, setPageError] = useState('');
  const [drafts, setDrafts] = useState<ClientDraft[]>([]);
  const [toolsOpen, setToolsOpen] = useState(false);
  const nextDraft = useRef(0);
  const requestVersion = useRef(0);
  const savingRows = useRef(new Set<string>());
  const [target, setTarget] = useState<DistributionRow | null>(null);
  const [action, setAction] = useState<'give' | 'revert'>('give');
  const [actionYear, setActionYear] = useState(currentYear);
  const [association, setAssociation] = useState('');
  const [notes, setNotes] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const actionPending = useRef(false);

  const [bdState, setBDState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadBDs = useCallback(async () => {
    setBDState('loading');
    try { const result = await api.getBDs(); setBDs(result.data); setBDState('ready'); }
    catch (error: any) { setBDState('error'); setPageError(error.message || 'Unable to load Business Developers.'); }
  }, []);
  useEffect(() => { loadBDs(); }, [loadBDs]);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setPageError('');
    try {
      const result = await api.getDistributions({ year, vertical, bd, status, search, page, limit: 10 });
      if (version !== requestVersion.current) return;
      setRecords(result.data); setTotal(result.pagination.total); setPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (error: any) {
      if (version === requestVersion.current) { setPageError(error.message || 'Unable to load clients.'); setRecords([]); setTotal(0); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [year, vertical, bd, status, search, page]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => { clearTimeout(timer); requestVersion.current++; };
  }, [load]);

  const exportExcel = async () => {
    setExporting(true); setPageError('');
    // Capture the current filters, including master search, for the entire export.
    const filters = { year, vertical, bd, status, search };
    try {
      const clients = new Map<string, DistributionRow>();
      let exportPage = 1, totalPages = 1;
      do {
        const result = await api.getDistributions({ ...filters, page: exportPage, limit: 100 });
        for (const row of result.data) clients.set(row.clientId, row);
        totalPages = result.pagination.totalPages;
        exportPage++;
      } while (exportPage <= totalPages);
      const master = await api.getBDs();
      setBDs(master.data);
      const blob = buildEntryWorkbook([...clients.values()], master.data, filters);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `ADINN-Entry-${filters.year}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      success(`Exported ${clients.size} matching clients.`);
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : 'Unable to export Excel. Please try again.');
    } finally { setExporting(false); }
  };

  const changeDraft = (key: string, changes: Partial<ClientDraft>) => setDrafts(rows => rows.map(row => row.key === key ? { ...row, ...changes } : row));
  const addClient = (row?: DistributionRow, edit = false) => {
    if (edit && drafts.some(draft => draft.associationId === row?.associationId)) return;
    setDrafts(rows => [...rows, { key: `client-${++nextDraft.current}`, name: row?.clientName || '', mobile: row?.clientMobile || '', email: row?.clientEmail || '',
      vertical: edit ? row?.vertical || '' : vertical === 'ALL' ? '' : vertical,
      bd: edit ? row?.bd?._id || '' : bd === 'ALL' ? '' : bd,
      associationId: edit ? row?.associationId || undefined : undefined, saving: false, error: '' }]);
  };
  const saveClient = async (draft: ClientDraft, confirmExisting = false) => {
    if (savingRows.current.has(draft.key)) return;
    const digits = draft.mobile.replace(/\D/g, '');
    const validation = !draft.name.trim() ? 'Client/Vendor Name is required.'
      : digits.length < 7 || digits.length > 15 || !/^[+\d\s().-]+$/.test(draft.mobile) ? 'Enter a valid phone number (7 to 15 digits).'
      : draft.email.trim() && !/^\S+@\S+\.\S+$/.test(draft.email.trim()) ? 'Enter a valid email or leave it empty.'
      : !draft.vertical || !draft.bd ? 'Select a Vertical and BD.' : '';
    if (validation) { changeDraft(draft.key, { error: validation }); return; }
    savingRows.current.add(draft.key); changeDraft(draft.key, { saving: true, error: '' });
    try {
      const fields = { name: draft.name.trim(), mobile: draft.mobile.trim(), email: draft.email.trim() };
      const result = draft.associationId ? await api.updateClient(draft.associationId, fields)
        : await api.createClient({ ...fields, vertical: draft.vertical as VerticalType, bd: draft.bd!, ...(confirmExisting ? { confirmExisting: true } : {}) });
      setDrafts(rows => rows.filter(row => row.key !== draft.key));
      success(result.message); await load();
    } catch (error: any) {
      if (error instanceof ApiError && error.code === 'CLIENT_EXISTS') { changeDraft(draft.key, { saving: false }); setDuplicate(draft); }
      else if (error instanceof ApiError && error.code === 'ASSOCIATION_EXISTS') { setDrafts(rows => rows.filter(row => row.key !== draft.key)); setDuplicate(null); info(error.message); }
      else changeDraft(draft.key, { saving: false, error: error.message || 'Unable to save client.' });
    }
    finally { savingRows.current.delete(draft.key); }
  };
  const confirmDuplicate = async () => {
    if (!duplicate) return;
    setLinking(true); await saveClient(duplicate, true); setLinking(false); setDuplicate(null);
  };
  const openAction = (row: DistributionRow, kind: 'give' | 'revert') => {
    setTarget(row); setAction(kind); setActionYear(year); setNotes(''); setActionError('');
    setAssociation(row.associations.find(link => link.bd)?._id || '');
  };
  const confirmAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target || actionPending.current) return;
    const link = target.associations.find(link => link._id === association);
    if (action === 'give' && !link?.bd) { setActionError('Choose a valid client association.'); return; }
    if (action === 'revert' && notes.trim().length < 5) { setActionError('Enter a reason of at least 5 characters.'); return; }
    actionPending.current = true; setSubmitting(true); setActionError('');
    try {
      const result = action === 'give'
        ? await api.createDistribution({ clientId: target.clientId, year: actionYear, vertical: link!.vertical, bd: link!.bd!._id, notes: notes.trim() })
        : await api.revertDistribution(target.currentYearDistribution!._id, notes.trim());
      success(result.message); setTarget(null); await load();
    } catch (error: any) { setActionError(error.message || 'Unable to save distribution.'); }
    finally { actionPending.current = false; setSubmitting(false); }
  };

  return (
    <div className="space-y-4 min-w-0">
      <ConfirmDialog isOpen={!!duplicate} onClose={() => setDuplicate(null)} onConfirm={confirmDuplicate} isLoading={linking}
        title="Client Already Exists!" message="This client/vendor is already registered. Do you want to add another Vertical and BD to the existing record?" confirmLabel="Yes, Add to Existing" cancelLabel="Cancel" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Entry</h1>
        <button type="button" onClick={exportExcel} disabled={exporting || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
          <Download className="w-4 h-4" />{exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>
      <section aria-label="Global master search" className="relative">
        <Search className="absolute left-4 top-4 w-5 h-5 text-amber-600" />
        <input type="search" aria-label="Global master search" placeholder="Search by client name, phone number, email, BD name, BD email..." value={search}
          onChange={event => { setSearch(event.target.value); setPage(1); }}
          className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20" />
      </section>

      <section aria-label="Distribution filters" className="grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-4 gap-3 p-4 bg-white border border-slate-200 rounded-xl">
        <label className="text-xs font-semibold text-slate-600">Year
          <select aria-label="Year" value={year} onChange={event => { setYear(Number(event.target.value)); setPage(1); }} className={`${control} mt-1.5`}>
            {YEAR_OPTIONS.map(value => <option key={value} value={value}>Diwali {value}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Vertical
          <select aria-label="Vertical" value={vertical} onChange={event => { setVertical(event.target.value); setPage(1); }} className={`${control} mt-1.5`}>
            <option value="ALL">All Verticals</option>{VERTICAL_OPTIONS.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">BD
          <select aria-label="BD" value={bd} onChange={event => { setBD(event.target.value); setPage(1); }} className={`${control} mt-1.5`}>
            <option value="ALL">All Business Developers</option>{bds.map(value => <option key={value._id} value={value._id}>{value.name} ({value.email})</option>)}
          </select>
          {bdState === 'loading' && <span role="status" className="block mt-1 text-xs font-normal text-slate-500">Loading Business Developers...</span>}
          {bdState === 'error' && <span role="alert" className="block mt-1 text-xs font-normal text-rose-700">Could not load BDs. <button type="button" onClick={loadBDs} className="underline font-semibold">Retry</button></span>}
          {bdState === 'ready' && !bds.length && <span role="status" className="block mt-1 text-xs font-normal text-amber-700">No Business Developers found. Add them from the BD tools, or import the BD list.</span>}
        </label>
        <label className="text-xs font-semibold text-slate-600">Distribution Status
          <select aria-label="Distribution Status" value={status} onChange={event => { setStatus(event.target.value as Status); setPage(1); }} className={`${control} mt-1.5`}>
            <option value="ALL">All</option><option value="GIVEN">Given</option><option value="NOT_GIVEN">Not Given</option>
          </select>
        </label>
      </section>

      <section aria-label="Client/vendor distribution table" className="bg-white border border-slate-200 rounded-xl shadow-sm min-w-0">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-200">
          <div className="mr-auto"><h2 className="text-sm font-bold text-slate-800">Clients &amp; Sweet Distribution</h2>
            <p className="text-xs text-slate-500 mt-1" role="status">{total} matching clients{loading ? ' - Loading...' : ''}</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-slate-600 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={() => setToolsOpen(value => !value)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-slate-600"><Upload className="w-3.5 h-3.5" />Excel / BD Tools</button>
          <button type="button" onClick={() => addClient()} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"><Plus className="w-4 h-4" />Add Client/Vendor</button>
        </div>
        {pageError && <p role="alert" className="p-3 text-xs text-rose-700 bg-rose-50">{pageError}</p>}
        {toolsOpen && <div className="p-3 border-b border-slate-200 bg-slate-50">
          <ClientManagement initialVertical={vertical === 'ALL' ? '' : vertical} initialBD={bd === 'ALL' ? '' : bd}
            onClientsChanged={load} onClose={() => { setToolsOpen(false); loadBDs(); load(); }} onBDsChanged={loadBDs} />
        </div>}
        <div className="overflow-x-auto rounded-b-xl" data-client-table-scroll>
          <table aria-label="Client/vendor distribution" className="w-full min-w-[1500px] text-left text-xs border-collapse">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200"><tr>
              {['S.No.', 'Client/Vendor Name', 'Phone Number', 'Email', 'Vertical', 'BD', 'BD Email', 'Created At', 'Last Given', 'Action'].map(label => <th key={label} className="px-3 py-3 font-semibold whitespace-nowrap">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {drafts.map(draft => <InlineClientRow key={draft.key} draft={draft} distributionBDs={bds} bdState={bdState} onChange={changes => changeDraft(draft.key, changes)} onSave={() => saveClient(draft)} onCancel={() => setDrafts(rows => rows.filter(row => row.key !== draft.key))} />)}
              {records.map((row, index) => <tr key={row.clientId} data-client-id={row.clientId} className="hover:bg-slate-50 align-top">
                <td className="px-3 py-3 text-slate-400">{(page - 1) * 10 + index + 1}</td>
                <td className="px-3 py-3 min-w-[180px] font-semibold text-slate-800">{row.clientName}</td>
                <td className="px-3 py-3 whitespace-nowrap text-slate-600">{row.clientMobile || '\u2014'}</td>
                <td className="px-3 py-3 text-slate-600">{row.clientEmail || '\u2014'}</td>
                <td className="px-3 py-3">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6 whitespace-nowrap">{link.vertical}</div>) : '\u2014'}</td>
                <td className="px-3 py-3">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6 whitespace-nowrap">{link.bd?.name || '\u2014'}</div>) : '\u2014'}</td>
                <td className="px-3 py-3 text-slate-500">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6">{link.bd?.email || '\u2014'}</div>) : '\u2014'}</td>
                <td className="px-3 py-3 whitespace-nowrap text-slate-500">{dateLabel(row.createdAt)}</td>
                <td className="px-3 py-3 whitespace-nowrap"><span className="font-semibold text-slate-700">{row.lastGiven || '\u2014'}</span>
                  {row.lastGivenDate && <div className="text-xs text-slate-400 mt-1">{dateLabel(row.lastGivenDate)}</div>}
                </td>
                <td className="px-3 py-3 min-w-[205px]">
                  {row.isEligible ? <button type="button" disabled={!row.associations.some(link => link.bd)} title={row.associations.some(link => link.bd) ? undefined : 'Link a Vertical and BD before distributing'} onClick={() => openAction(row, 'give')} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold disabled:opacity-40"><Gift className="w-3.5 h-3.5" />Add Distribution</button>
                    : <div className="flex flex-wrap gap-2 items-center"><span className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">Given in {year}</span>
                      <button type="button" onClick={() => openAction(row, 'revert')} className="inline-flex items-center gap-1 text-rose-700 font-semibold"><RotateCcw className="w-3 h-3" />Revert</button></div>}
                  <div className="flex gap-3 mt-2 text-xs text-slate-500">
                    {row.associationId && <button type="button" onClick={() => addClient(row, true)} className="hover:text-amber-700">Edit client</button>}
                    <button type="button" onClick={() => addClient(row)} className="hover:text-amber-700">Link association</button>
                  </div>
                </td>
              </tr>)}
              {!records.length && !drafts.length && <tr><td colSpan={10} className="py-10 text-center text-slate-500">{loading ? 'Loading clients...' : 'No clients match. Clear filters or add a client/vendor.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-t border-slate-200 text-xs text-slate-500">
          <span>Page {page} of {pages} &middot; One distribution per client per calendar year</span>
          <div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="border rounded px-2.5 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)} className="border rounded px-2.5 py-1.5 disabled:opacity-40">Next</button></div>
        </div>
      </section>

      <Modal isOpen={!!target} onClose={() => { if (!submitting) setTarget(null); }} title={action === 'give' ? 'Record Diwali Sweet Distribution' : 'Revert Distribution'} subtitle={`${target?.clientName || ''} - Diwali ${actionYear}`}>
        <form onSubmit={confirmAction} className="space-y-4">
          {actionError && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-3 rounded">{actionError}</p>}
          {action === 'give' ? <>
            <label className="block text-xs font-semibold text-slate-600">Vertical / BD association
              <select aria-label="Distribution association" value={association} disabled={submitting} onChange={event => setAssociation(event.target.value)} className={`${control} mt-1.5`}>
                {target?.associations.filter(link => link.bd).map(link => <option key={link._id} value={link._id}>{link.vertical} - {link.bd?.name} ({link.bd?.email})</option>)}
              </select>
            </label>
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded-lg">Confirming blocks further sweet distribution to this client in {actionYear} across all Verticals and BDs.</p>
          </> : <p className="text-xs text-slate-600">Reverse only this client's {actionYear} distribution? The original record and notes will be retained with your reason. The client will become eligible again for this year.</p>}
          <label className="block text-xs font-semibold text-slate-600">{action === 'give' ? 'Distribution notes (optional)' : 'Reason for reverting (required)'}
            <textarea aria-label={action === 'give' ? 'Distribution notes' : 'Revert reason'} rows={3} required={action === 'revert'} minLength={action === 'revert' ? 5 : undefined} maxLength={1000} value={notes} disabled={submitting} onChange={event => setNotes(event.target.value)} className={`${control} mt-1.5`} />
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100"><button type="button" disabled={submitting} onClick={() => setTarget(null)} className="px-3 py-2 border rounded-lg text-xs">Cancel</button>
            <button type="submit" disabled={submitting} className={`px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${action === 'give' ? 'bg-amber-600' : 'bg-rose-700'}`}>{submitting ? 'Saving...' : action === 'give' ? 'Confirm Sweet Distribution' : 'Confirm Revert'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
