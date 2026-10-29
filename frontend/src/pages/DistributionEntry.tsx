import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, RefreshCw, Upload, Download, Gift, RotateCcw, Paperclip, Pencil } from 'lucide-react';
import { buildEntryWorkbook } from '../utils/entryWorkbook';
import { api, ApiError } from '../services/api';
import { BD, DistributionRow, TYPE_OPTIONS, ClientType } from '../types';
import { DISTRIBUTION_QUANTITY, DeliveryStatus, DistributionMode, MAX_PROOF_MB, MODE_LABEL, MODE_OPTIONS, STATUS_FLOW, STATUS_LABEL } from '../config/distribution';
import { SearchableSelect } from '../components/SearchableSelect';
import { YearPicker } from '../components/YearPicker';
import { AddRequesteeModal } from '../components/AddRequesteeModal';
import { StatusDropdown } from '../components/StatusDropdown';
import { InlineClientRow, ClientDraft } from '../components/InlineClientRow';
import { Modal } from '../components/Modal';
import { DEFAULT_YEAR, YEAR_OPTIONS } from '../config/diwaliYear';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { ExcelImportModal } from '../components/ExcelImportModal';

const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
const control = 'w-full px-3 py-2.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20';
type Status = 'ALL' | 'GIVEN' | 'NOT_GIVEN';
type ModeFilter = 'ALL' | DistributionMode;
type StageFilter = 'ALL' | DeliveryStatus;
const isJpeg = (file: File) => file.type === 'image/jpeg' && /\.jpe?g$/i.test(file.name);

export const DistributionEntry: React.FC = () => {
  const { success, info } = useToast();
  const [duplicate, setDuplicate] = useState<ClientDraft | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState('');
  const [linking, setLinking] = useState(false);
  const currentYear = DEFAULT_YEAR;
  const [year, setYear] = useState(currentYear);
  const [type, setType] = useState('ALL');
  const [bd, setBD] = useState('ALL');
  const [status, setStatus] = useState<Status>('ALL');
  const [mode, setMode] = useState<ModeFilter>('ALL');
  const [deliveryStatus, setDeliveryStatus] = useState<StageFilter>('ALL');
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
  const [importOpen, setImportOpen] = useState(false);
  const nextDraft = useRef(0);
  const requestVersion = useRef(0);
  const savingRows = useRef(new Set<string>());
  const [target, setTarget] = useState<DistributionRow | null>(null);
  const [action, setAction] = useState<'give' | 'revert'>('give');
  const [actionYear, setActionYear] = useState(currentYear);
  const [association, setAssociation] = useState('');
  const [distMode, setDistMode] = useState<DistributionMode | ''>('');
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [proofTarget, setProofTarget] = useState<{ row: DistributionRow; next: DeliveryStatus } | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState('');
  const [proofView, setProofView] = useState<{ url: string; name: string } | null>(null);
  const statusPending = useRef(false);
  const [notes, setNotes] = useState('');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const actionPending = useRef(false);

  const [bdState, setBDState] = useState<'loading' | 'ready' | 'error'>('loading');
  const loadBDs = useCallback(async () => {
    setBDState('loading');
    try { const result = await api.getBDs(); setBDs(result.data); setBDState('ready'); }
    catch (error: any) { setBDState('error'); setPageError(error.message || 'Unable to load Requestees.'); }
  }, []);
  useEffect(() => { loadBDs(); }, [loadBDs]);

  // "+ Add Requestee" from a dropdown: remember where it was opened so the new Requestee is selected there.
  const [addRequestee, setAddRequestee] = useState<{ term: string; draftKey: string | null } | null>(null);
  const onRequesteeSaved = async (saved: BD) => {
    const target = addRequestee;
    setBDs(list => list.some(item => item._id === saved._id) ? list : [...list, saved].sort((a, b) => a.name.localeCompare(b.name)));
    if (target?.draftKey) setDrafts(rows => rows.map(row => row.key === target.draftKey ? { ...row, bd: saved._id, error: '' } : row));
    else { setBD(saved._id); setPage(1); }
    setAddRequestee(null);
    try { setBDs((await api.getBDs()).data); } catch { /* the saved Requestee is already listed; a later refresh will reconcile */ }
    success(`Requestee "${saved.name}" selected.`);
  };

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setPageError('');
    try {
      const result = await api.getDistributions({ year, type, bd, status, mode, deliveryStatus, search, page, limit: 10 });
      if (version !== requestVersion.current) return;
      setRecords(result.data); setTotal(result.pagination.total); setPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (error: any) {
      if (version === requestVersion.current) { setPageError(error.message || 'Unable to load clients.'); setRecords([]); setTotal(0); }
    } finally { if (version === requestVersion.current) setLoading(false); }
  }, [year, type, bd, status, mode, deliveryStatus, search, page]);
  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => { clearTimeout(timer); requestVersion.current++; };
  }, [load]);

  const exportExcel = async () => {
    setExporting(true); setPageError('');
    // Capture the current filters, including master search, for the entire export.
    const filters = { year, type, bd, status, mode, deliveryStatus, search };
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
  const renderDraft = (draft: ClientDraft) => <InlineClientRow key={draft.key} draft={draft} distributionBDs={bds} bdState={bdState} onChange={changes => changeDraft(draft.key, changes)} onCreateRequestee={term => setAddRequestee({ term, draftKey: draft.key })}
    onSave={() => saveClient(draft)} onCancel={() => setDrafts(rows => rows.filter(row => row.key !== draft.key))} />;
  const draftKey = () => `client-${++nextDraft.current}`;
  const addClient = () => setDrafts(rows => [...rows, { key: draftKey(), name: '', mobile: '', email: '', type: type === 'ALL' ? '' : type, bd: bd === 'ALL' ? '' : bd,
    saving: false, error: '' }]);
  // Edits a row in place: its draft replaces the row until it is saved or cancelled.
  const editClient = (row: DistributionRow) => {
    const associationId = row.associationId;
    if (!associationId || drafts.some(draft => draft.associationId === associationId)) return;
    setDrafts(rows => [...rows, { key: draftKey(), name: row.clientName, mobile: row.clientMobile, originalMobile: row.clientMobile, email: row.clientEmail,
      type: row.type || '', bd: row.bd?._id || '', typeLocked: !!row.type,
      associationId, saving: false, error: '' }]);
  };
  const saveClient = async (draft: ClientDraft, confirmExisting = false) => {
    if (savingRows.current.has(draft.key)) return;
    // Numbers must be exactly 10 digits. An untouched number on an edited record may keep its older stored format.
    const untouchedLegacy = !!draft.associationId && draft.mobile === draft.originalMobile;
    const validation = !draft.name.trim() ? 'Client/Vendor Name is required.'
      : !(/^\d{10}$/.test(draft.mobile) || untouchedLegacy) ? 'Phone number must be exactly 10 digits (numbers only).'
      : draft.email.trim() && !/^\S+@\S+\.\S+$/.test(draft.email.trim()) ? 'Enter a valid email or leave it empty.'
      : !draft.type || !draft.bd ? 'Select a Type and Requestee Name.'
      : '';
    if (validation) { changeDraft(draft.key, { error: validation }); return; }
    savingRows.current.add(draft.key); changeDraft(draft.key, { saving: true, error: '' });
    try {
      const fields = { name: draft.name.trim(), mobile: draft.mobile.trim(), email: draft.email.trim() };
      const result = draft.associationId
        ? await api.updateClient(draft.associationId, { ...fields, ...(draft.typeLocked ? {} : { type: draft.type as ClientType }) })
        : await api.createClient({ ...fields, type: draft.type as ClientType, bd: draft.bd!, ...(confirmExisting ? { confirmExisting: true } : {}) });
      setDrafts(rows => rows.filter(row => row.key !== draft.key));
      success(result.message); await load();
    } catch (error: any) {
      if (error instanceof ApiError && error.code === 'CLIENT_EXISTS') { changeDraft(draft.key, { saving: false }); setDuplicateMessage(error.message); setDuplicate(draft); }
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
    setDistMode('');
    setAssociation(row.associations.find(link => link.bd && link.type)?._id || '');
  };
  const confirmAction = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!target || actionPending.current) return;
    const link = target.associations.find(link => link._id === association);
    if (action === 'give' && (!link?.bd || !link.type)) { setActionError('Choose a valid client association with a Type.'); return; }
    if (action === 'give' && !distMode) { setActionError('Select a Distribution Mode: Courier or In-person.'); return; }
    if (action === 'revert' && notes.trim().length < 5) { setActionError('Enter a reason of at least 5 characters.'); return; }
    actionPending.current = true; setSubmitting(true); setActionError('');
    try {
      const result = action === 'give'
        ? await api.createDistribution({ clientId: target.clientId, year: actionYear, type: link!.type!, bd: link!.bd!._id, mode: distMode as DistributionMode, notes: notes.trim() })
        : await api.revertDistribution(target.currentYearDistribution!._id, notes.trim());
      success(result.message); setTarget(null); await load();
    } catch (error: any) { setActionError(error.message || 'Unable to save distribution.'); }
    finally { actionPending.current = false; setSubmitting(false); }
  };

  // Stage changes: Delivered needs the proof step first (required for Courier, optional for In-person); other stages apply directly.
  const advanceStatus = async (row: DistributionRow, next: DeliveryStatus, proof?: File) => {
    const current = row.currentYearDistribution;
    if (!current || statusPending.current) return;
    statusPending.current = true; setStatusBusy(current._id); setPageError('');
    try {
      const result = await api.updateDeliveryStatus(current._id, next, proof);
      success(result.message); setProofTarget(null); setProofFile(null); await load();
    } catch (error: any) {
      if (proofTarget) setProofError(error.message || 'Unable to update status.'); else setPageError(error.message || 'Unable to update status.');
      await load();
    } finally { statusPending.current = false; setStatusBusy(null); }
  };
  const onAdvance = (row: DistributionRow, next: DeliveryStatus) => {
    if (next === 'DELIVERED') { setProofTarget({ row, next }); setProofFile(null); setProofError(''); return; }
    advanceStatus(row, next);
  };
  const chooseProof = async (file: File | undefined) => {
    setProofError('');
    if (!file) { setProofFile(null); return; }
    if (!isJpeg(file)) { setProofFile(null); setProofError('Delivery proof must be a JPEG/JPG image.'); return; }
    if (file.size > MAX_PROOF_MB * 1024 * 1024) { setProofFile(null); setProofError(`Delivery proof must be ${MAX_PROOF_MB} MB or smaller. This file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`); return; }
    // Check the content, not just the name/MIME type: a JPEG starts with FF D8 FF.
    const head = new Uint8Array(await file.slice(0, 3).arrayBuffer());
    if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) { setProofFile(null); setProofError('This file is not a valid JPEG image.'); return; }
    setProofFile(file);
  };
  const confirmDelivered = (event: React.FormEvent) => {
    event.preventDefault();
    if (!proofTarget) return;
    if (proofTarget.row.currentYearDistribution?.mode === 'COURIER' && !proofFile) { setProofError('Upload a JPEG/JPG delivery proof to mark a courier distribution as Delivered.'); return; }
    advanceStatus(proofTarget.row, proofTarget.next, proofFile || undefined);
  };
  const viewProof = async (row: DistributionRow) => {
    try {
      const blob = await api.getDeliveryProof(row.currentYearDistribution!._id);
      setProofView({ url: URL.createObjectURL(blob), name: row.clientName });
    } catch (error: any) { setPageError(error.message || 'Unable to load delivery proof.'); }
  };
  useEffect(() => () => { if (proofView) URL.revokeObjectURL(proofView.url); }, [proofView]);

  return (
    <div className="space-y-4 min-w-0">
      <ConfirmDialog isOpen={!!duplicate} onClose={() => setDuplicate(null)} onConfirm={confirmDuplicate} isLoading={linking}
        title="Client Already Exists!" message={duplicateMessage} confirmLabel="Yes, Add to Existing" cancelLabel="Cancel" />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Entry</h1>
        <button type="button" onClick={exportExcel} disabled={exporting || loading}
          className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
          <Download className="w-4 h-4" />{exporting ? 'Exporting...' : 'Export Excel'}
        </button>
      </div>
      <section aria-label="Global master search" className="relative">
        <Search className="absolute left-4 top-4 w-5 h-5 text-amber-600" />
        <input type="search" aria-label="Global master search" placeholder="Search by client name, phone number, email, Requestee name, Requestee email..." value={search}
          onChange={event => { setSearch(event.target.value); setPage(1); }}
          className="w-full pl-12 pr-4 py-4 rounded-xl border border-slate-300 bg-white text-sm text-slate-800 shadow-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20" />
      </section>

      <section aria-label="Distribution filters" className="grid grid-cols-1 min-[400px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 p-4 bg-white border border-slate-200 rounded-xl">
        <div className="text-xs font-semibold text-slate-600">Year
          <YearPicker ariaLabel="Year" className="mt-1.5" value={year} years={YEAR_OPTIONS} currentYear={currentYear} onChange={value => { setYear(value); setPage(1); }} />
        </div>
        <div className="text-xs font-semibold text-slate-600">Type
          <SearchableSelect ariaLabel="Type" size="filter" clearable={false} className="mt-1.5" value={type} onChange={value => { setType(value || 'ALL'); setPage(1); }}
            options={[{ value: 'ALL', label: 'All Types' }, ...TYPE_OPTIONS.map(value => ({ value, label: value }))]} />
        </div>
        <div className="text-xs font-semibold text-slate-600">Requestee Name
          <SearchableSelect ariaLabel="Requestee Name" size="filter" avatars searchable onCreate={term => setAddRequestee({ term, draftKey: null })} createLabel="Add Requestee" clearable={false} className="mt-1.5" value={bd} onChange={value => { setBD(value || 'ALL'); setPage(1); }}
            placeholder="All Requestees" options={[{ value: 'ALL', label: 'All Requestees' }, ...bds.map(value => ({ value: value._id, label: value.name, subtext: value.email }))]} />
          {bdState === 'loading' && <span role="status" className="block mt-1 text-xs font-normal text-slate-500">Loading Requestees...</span>}
          {bdState === 'error' && <span role="alert" className="block mt-1 text-xs font-normal text-rose-700">Could not load Requestees. <button type="button" onClick={loadBDs} className="underline font-semibold">Retry</button></span>}
          {bdState === 'ready' && !bds.length && <span role="status" className="block mt-1 text-xs font-normal text-amber-700">No Requestees found. Add them from the Requestee tools, or import the list.</span>}
        </div>
        <div className="text-xs font-semibold text-slate-600">Distribution Status
          <SearchableSelect ariaLabel="Distribution Status" size="filter" clearable={false} className="mt-1.5" value={status} onChange={value => { setStatus((value || 'ALL') as Status); setPage(1); }}
            options={[{ value: 'ALL', label: 'All' }, { value: 'GIVEN', label: 'Given' }, { value: 'NOT_GIVEN', label: 'Not Given' }]} />
        </div>
        <div className="text-xs font-semibold text-slate-600">Distribution Mode
          <SearchableSelect ariaLabel="Distribution Mode" size="filter" clearable={false} className="mt-1.5" value={mode} onChange={value => { setMode((value || 'ALL') as ModeFilter); setDeliveryStatus('ALL'); setPage(1); }}
            options={[{ value: 'ALL', label: 'All Modes' }, ...MODE_OPTIONS.map(value => ({ value, label: MODE_LABEL[value] }))]} />
        </div>
        <div className="text-xs font-semibold text-slate-600">Delivery Status
          <SearchableSelect ariaLabel="Delivery Status" size="filter" clearable={false} className="mt-1.5" disabled={mode === 'ALL'} value={deliveryStatus} onChange={value => { setDeliveryStatus((value || 'ALL') as StageFilter); setPage(1); }}
            placeholder={mode === 'ALL' ? 'Select a mode first' : 'All Stages'}
            options={mode === 'ALL' ? [] : [{ value: 'ALL', label: 'All Stages' }, ...STATUS_FLOW[mode].map(value => ({ value, label: STATUS_LABEL[value] }))]} />
        </div>
      </section>

      <section aria-label="Client/vendor distribution table" className="bg-white border border-slate-200 rounded-xl shadow-sm min-w-0">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-slate-200">
          <div className="mr-auto"><h2 className="text-sm font-bold text-slate-800">Clients &amp; Sweet Distribution</h2>
            <p className="text-xs text-slate-500 mt-1" role="status">{total} matching clients{loading ? ' - Loading...' : ''}</p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-slate-600 disabled:opacity-50"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs border rounded-lg text-slate-600"><Upload className="w-3.5 h-3.5" />Excel</button>
          <button type="button" onClick={() => addClient()} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"><Plus className="w-4 h-4" />Add Client/Vendor</button>
        </div>
        {pageError && <p role="alert" className="p-3 text-xs text-rose-700 bg-rose-50">{pageError}</p>}
        <div className="overflow-x-auto rounded-b-xl" data-client-table-scroll>
          <table aria-label="Client/vendor distribution" className="w-full min-w-[2150px] text-left text-sm border-collapse">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200"><tr>
              {['S.No.', 'Client/Vendor Name', 'Phone Number', 'Email', 'Type', 'Requestee Name', 'Requestee Email', 'Quantity', 'Created At', 'Last Given', 'Mode', 'Status', 'Action'].map(label => <th key={label} className="px-4 py-4 font-semibold whitespace-nowrap">{label}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {drafts.filter(draft => !draft.associationId).map(draft => renderDraft(draft))}
              {records.map((row, index) => {
                const editing = drafts.find(draft => draft.associationId && draft.associationId === row.associationId);
                if (editing) return renderDraft(editing);
                return <tr key={row.clientId} data-client-id={row.clientId} className="hover:bg-slate-50 align-top">
                <td className="px-4 py-4 text-slate-400">{(page - 1) * 10 + index + 1}</td>
                <td className="px-4 py-4 min-w-[180px] font-semibold text-slate-800">{row.clientName}</td>
                <td className="px-4 py-4 whitespace-nowrap text-slate-600">{row.clientMobile || '\u2014'}</td>
                <td className="px-4 py-4 text-slate-600">{row.clientEmail || '\u2014'}</td>
                <td className="px-4 py-4">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6 whitespace-nowrap">{link.type || <span className="text-slate-400" title={link.legacyVertical ? `Previous vertical: ${link.legacyVertical}` : undefined}>Unassigned{link.legacyVertical ? ` (was ${link.legacyVertical})` : ''}</span>}</div>) : '\u2014'}</td>
                <td className="px-4 py-4">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6 whitespace-nowrap">{link.bd?.name || '\u2014'}</div>) : '\u2014'}</td>
                <td className="px-4 py-4 text-slate-500">{row.associations.length ? row.associations.map(link => <div key={link._id} className="min-h-6">{link.bd?.email || '\u2014'}</div>) : '\u2014'}</td>
                <td className="px-4 py-4 whitespace-nowrap font-semibold text-slate-700" data-quantity>{row.currentYearDistribution?.quantity ?? DISTRIBUTION_QUANTITY}</td>
                <td className="px-4 py-4 whitespace-nowrap text-slate-500">{dateLabel(row.createdAt)}</td>
                <td className="px-4 py-4 whitespace-nowrap"><span className="font-semibold text-slate-700">{row.lastGiven || '\u2014'}</span>
                  {row.lastGivenDate && <div className="text-xs text-slate-400 mt-1.5">{dateLabel(row.lastGivenDate)}</div>}
                </td>
                <td className="px-4 py-4 whitespace-nowrap" data-distribution-mode>{(() => { const given = row.currentYearDistribution;
                  return given?.mode ? <><span className="font-semibold text-slate-700">{MODE_LABEL[given.mode]}</span></>
                    : given ? <span className="text-slate-400" title="Recorded before Courier/In-person tracking existed">Legacy</span> : '\u2014'; })()}</td>
                <td className="px-4 py-4 whitespace-nowrap" data-distribution-status>{(() => { const given = row.currentYearDistribution;
                  return given?.mode && given.status
                    ? <StatusDropdown distributionId={given._id} mode={given.mode} status={given.status} hasProof={given.hasProof} busy={statusBusy === given._id}
                        onAdvance={next => onAdvance(row, next)} onViewProof={() => viewProof(row)} />
                    : '\u2014'; })()}</td>
                <td className="px-4 py-4 min-w-[260px]">
                  <div className="flex items-center gap-2">
                    {row.isEligible ? <button type="button" disabled={!row.associations.some(link => link.bd && link.type)} title={row.associations.some(link => link.bd && link.type) ? undefined : 'Link a Type and Requestee before distributing'} onClick={() => openAction(row, 'give')} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md font-semibold disabled:opacity-40"><Gift className="w-3.5 h-3.5" />Add Distribution</button>
                      : <><span className="text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 whitespace-nowrap">Given in {year}</span>
                        <button type="button" onClick={() => openAction(row, 'revert')} className="inline-flex items-center gap-1 text-rose-700 font-semibold"><RotateCcw className="w-3 h-3" />Revert</button></>}
                    <button type="button" aria-label={`Edit ${row.clientName}`} title={row.associationId ? 'Edit this row' : 'Nothing to edit: this client has no Type/Requestee link'} disabled={!row.associationId} onClick={() => editClient(row)}
                      className="ml-auto inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md border border-slate-200 text-slate-500 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500 disabled:hover:border-slate-200"><Pencil className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>; })}
              {!records.length && !drafts.length && <tr><td colSpan={13} className="py-10 text-center text-slate-500">{loading ? 'Loading clients...' : 'No clients match. Clear filters or add a client/vendor.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-2 px-3 py-2 border-t border-slate-200 text-xs text-slate-500">
          <span>Page {page} of {pages} &middot; One distribution per client per calendar year</span>
          <div className="flex gap-2"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)} className="border rounded px-2.5 py-1.5 disabled:opacity-40">Previous</button><button type="button" disabled={page >= pages || loading} onClick={() => setPage(value => value + 1)} className="border rounded px-2.5 py-1.5 disabled:opacity-40">Next</button></div>
        </div>
      </section>

      <AddRequesteeModal isOpen={!!addRequestee} term={addRequestee?.term || ''} existing={bds} onClose={() => setAddRequestee(null)} onSaved={onRequesteeSaved} />
      <ExcelImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} bds={bds} onImported={load} />

      <Modal isOpen={!!target} onClose={() => { if (!submitting) setTarget(null); }} title={action === 'give' ? 'Record Diwali Sweet Distribution' : 'Revert Distribution'} subtitle={`${target?.clientName || ''} - Diwali ${actionYear}`}>
        <form onSubmit={confirmAction} className="space-y-4">
          {actionError && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-3 rounded">{actionError}</p>}
          {action === 'give' ? <>
            <div className="block text-xs font-semibold text-slate-600">Type / Requestee association
              <SearchableSelect ariaLabel="Distribution association" size="filter" clearable={false} className="mt-1.5" disabled={submitting} value={association} onChange={setAssociation}
                placeholder="Select Type / Requestee"
                options={(target?.associations.filter(link => link.bd && link.type) || []).map(link => ({ value: link._id, label: `${link.type}`, subtext: `${link.bd?.name} (${link.bd?.email})` }))} />
            </div>
            <fieldset disabled={submitting} className="text-xs font-semibold text-slate-600">
              <legend className="mb-1.5">Distribution Mode</legend>
              <div role="radiogroup" aria-label="Distribution Mode" className="grid grid-cols-2 gap-2">
                {MODE_OPTIONS.map(value => <label key={value} className={`flex items-center justify-center gap-2 px-3 py-2.5 border rounded-lg cursor-pointer font-semibold ${distMode === value ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600 bg-white'}`}>
                  <input type="radio" name="distribution-mode" value={value} checked={distMode === value} onChange={() => setDistMode(value)} className="accent-amber-600" />{MODE_LABEL[value]}
                </label>)}
              </div>
            </fieldset>
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded-lg">Confirming blocks further sweet distribution to this client in {actionYear} across all Types and Requestees.</p>
          </> : <p className="text-xs text-slate-600">Reverse only this client's {actionYear} distribution? The original record and notes will be retained with your reason. The client will become eligible again for this year.</p>}
          <label className="block text-xs font-semibold text-slate-600">{action === 'give' ? 'Distribution notes (optional)' : 'Reason for reverting (required)'}
            <textarea aria-label={action === 'give' ? 'Distribution notes' : 'Revert reason'} rows={3} required={action === 'revert'} minLength={action === 'revert' ? 5 : undefined} maxLength={1000} value={notes} disabled={submitting} onChange={event => setNotes(event.target.value)} className={`${control} mt-1.5`} />
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-slate-100"><button type="button" disabled={submitting} onClick={() => setTarget(null)} className="px-3 py-2 border rounded-lg text-xs">Cancel</button>
            <button type="submit" disabled={submitting} className={`px-3 py-2 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${action === 'give' ? 'bg-amber-600' : 'bg-rose-700'}`}>{submitting ? 'Saving...' : action === 'give' ? 'Confirm Sweet Distribution' : 'Confirm Revert'}</button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={!!proofTarget} onClose={() => { if (!statusBusy) setProofTarget(null); }} title="Mark as Delivered" subtitle={`${proofTarget?.row.clientName || ''} - ${proofTarget?.row.currentYearDistribution?.mode ? MODE_LABEL[proofTarget.row.currentYearDistribution.mode] : ''}`}>
        <form onSubmit={confirmDelivered} className="space-y-4">
          {proofError && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-3 rounded">{proofError}</p>}
          {(() => { const courier = proofTarget?.row.currentYearDistribution?.mode === 'COURIER'; return <>
            <p className="text-xs text-slate-600">{courier ? 'Courier deliveries need a delivery proof before they can be marked Delivered.' : 'A delivery proof is optional for in-person deliveries.'} JPEG/JPG only, up to {MAX_PROOF_MB} MB.</p>
            <label className="block text-xs font-semibold text-slate-600">Delivery proof (JPEG/JPG){courier ? ' - required' : ' - optional'}
              <input aria-label="Delivery proof" type="file" accept=".jpg,.jpeg,image/jpeg" disabled={!!statusBusy} onChange={event => chooseProof(event.target.files?.[0])} className={`${control} mt-1.5`} />
            </label>
            {proofFile && <p className="flex items-center gap-1.5 text-xs text-slate-600"><Paperclip className="w-3.5 h-3.5" />{proofFile.name} ({Math.max(1, Math.round(proofFile.size / 1024))} KB)</p>}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100"><button type="button" disabled={!!statusBusy} onClick={() => setProofTarget(null)} className="px-3 py-2 border rounded-lg text-xs">Cancel</button>
              <button type="submit" disabled={!!statusBusy || (courier && !proofFile)} className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-emerald-600 disabled:opacity-50">{statusBusy ? 'Uploading...' : 'Confirm Delivered'}</button>
            </div></>; })()}
        </form>
      </Modal>

      <Modal isOpen={!!proofView} onClose={() => setProofView(null)} title="Delivery Proof" subtitle={proofView?.name}>
        {proofView && <img src={proofView.url} alt={`Delivery proof for ${proofView.name}`} className="max-h-[70vh] w-full object-contain rounded-lg border border-slate-200" />}
      </Modal>
    </div>
  );
};
