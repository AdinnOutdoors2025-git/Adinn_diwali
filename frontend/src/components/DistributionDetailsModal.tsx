import React, { useEffect, useState } from 'react';
import { X, Gift, CheckCircle2, Clock, MapPin, Truck, User, RotateCcw } from 'lucide-react';
import { DistributionRow } from '../types';
import { MODE_LABEL, STATUS_LABEL } from '../config/distribution';

const dash = '—';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : dash;
const dateTimeLabel = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
const joined = (values: (string | null | undefined)[]) => values.filter(Boolean).join(', ') || dash;

interface Props { row: DistributionRow | null; year: number; occasion: string; onClose: () => void }

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="min-w-0">
    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className="mt-1 text-sm font-medium text-slate-800 break-words" data-field={label}>{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
    <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700 pb-3 mb-4 border-b border-amber-100">{icon}{title}</h4>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">{children}</dl>
  </section>
);

export const DistributionDetailsModal: React.FC<Props> = ({ row, year, occasion, onClose }) => {
  // Keep the last row mounted while the closing transition plays, so the content does not vanish mid-fade.
  const [shown, setShown] = useState<DistributionRow | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (row) {
      setShown(row);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = setTimeout(() => setShown(null), 200);
    return () => clearTimeout(timer);
  }, [row]);

  useEffect(() => {
    if (!row) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = 'unset'; window.removeEventListener('keydown', onKey); };
  }, [row, onClose]);

  if (!shown) return null;
  const dist = shown.currentYearDistribution;
  const delivered = dist?.status === 'DELIVERED';
  const courier = dist?.mode === 'COURIER';
  const statusLabel = dist?.mode && dist.status ? STATUS_LABEL[dist.status] : dash;
  const statusTone = delivered ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : dist?.status ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Distribution details">
      <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-3 sm:p-6">
        <div className={`relative w-full max-w-4xl flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden rounded-2xl bg-slate-50 border border-slate-200 shadow-[0_24px_60px_-12px_rgba(15,23,42,0.45)] transition-all duration-200 ease-out ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-95'}`}>
          <div className="h-1.5 shrink-0 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
          <header className="shrink-0 flex items-start justify-between gap-4 px-5 sm:px-7 py-4 sm:py-5 bg-white border-b border-slate-200">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">{occasion} {year}</p>
              <h3 className="mt-0.5 text-lg sm:text-xl font-bold text-slate-900 leading-tight">Distribution Details</h3>
              <p className="mt-1 text-sm text-slate-500 truncate">{shown.clientName}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close details" className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full border border-slate-200 text-slate-500 hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-5 space-y-4" data-details-popup>
            <div className={`grid grid-cols-1 gap-3 ${delivered ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700"><Gift className="w-3.5 h-3.5" />Quantity</p>
                <p className="mt-1.5 text-2xl font-bold text-slate-900" data-field="Quantity">{dist?.quantity ?? '—'}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500"><Clock className="w-3.5 h-3.5" />Status</p>
                <p className="mt-2"><span data-field="Status" className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${statusTone}`}>{statusLabel}</span></p>
              </div>
              {delivered && <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" />Delivered At</p>
                <p className="mt-1.5 text-sm font-semibold text-slate-900" data-field="Delivered At">{dateTimeLabel(dist?.deliveredAt) || 'Not recorded'}</p>
              </div>}
            </div>

            <Section title="Client" icon={<User className="w-3.5 h-3.5" />}>
              <Field label="Client Name">{shown.clientName}</Field>
              <Field label="Number">{shown.clientMobile || dash}</Field>
              <Field label="Email">{shown.clientEmail || dash}</Field>
              <Field label="Type">{joined(shown.associations.map(link => link.type))}</Field>
              <Field label="Requestee Name">{joined(shown.associations.map(link => link.bd?.name))}</Field>
              <Field label="Requestee Email">{joined(shown.associations.map(link => link.bd?.email))}</Field>
            </Section>

            <Section title="Distribution" icon={<Truck className="w-3.5 h-3.5" />}>
              <Field label="Mode">{dist?.mode ? MODE_LABEL[dist.mode] : dist ? 'Legacy' : dash}</Field>
              <Field label="Created At">{dateTimeLabel(shown.createdAt) || dash}</Field>
              <Field label="Last Given">{shown.lastGiven ? `${shown.lastGiven}${shown.lastGivenDate ? ` (${dateLabel(shown.lastGivenDate)})` : ''}` : dash}</Field>
            </Section>

            {(() => {
              const reverts = shown.revertHistory ?? [];
              return <section data-revert-details className={`rounded-xl border p-4 sm:p-5 ${reverts.length ? 'border-rose-200 bg-rose-50/60' : 'border-slate-200 bg-white'}`}>
                <h4 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${reverts.length ? 'text-rose-700' : 'text-slate-500'}`}><RotateCcw className="w-3.5 h-3.5" />Revert Details{reverts.length > 1 ? ` (${reverts.length})` : ''}</h4>
                {reverts.length === 0 ? <p className="mt-2 text-sm font-medium text-slate-500" data-field="Revert Details">Not reverted</p>
                  : <ol className="mt-3 space-y-3">{reverts.map((entry, index) => <li key={entry._id} className="rounded-lg border border-rose-100 bg-white p-3 sm:p-4">
                    {reverts.length > 1 && <p className="text-[11px] font-bold uppercase tracking-wide text-rose-600 mb-2">Revert {reverts.length - index}{index === 0 ? ' (latest)' : ''}</p>}
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
                      <Field label="Reverted At">{dateTimeLabel(entry.revertedAt) || 'Not recorded'}</Field>
                      <div className="min-w-0 sm:col-span-2"><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Revert Reason</dt>
                        <dd className="mt-1 text-sm font-medium text-slate-800 break-words whitespace-pre-line" data-field="Revert Reason">{entry.reason || 'Not recorded'}</dd></div>
                    </dl>
                  </li>)}</ol>}
              </section>;
            })()}

            {courier && <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 sm:p-5">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800"><MapPin className="w-3.5 h-3.5" />Courier Address</h4>
              <p className="mt-2 text-sm font-medium text-slate-900 whitespace-pre-line break-words" data-field="Address">{dist?.address || 'Not recorded'}</p>
            </section>}
          </div>

          <footer className="shrink-0 flex justify-end px-5 sm:px-7 py-3 bg-white border-t border-slate-200">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500/40 transition-colors">Close</button>
          </footer>
        </div>
      </div>
    </div>
  );
};
