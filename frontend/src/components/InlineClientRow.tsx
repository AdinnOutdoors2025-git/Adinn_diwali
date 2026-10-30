import React from 'react';
import { BD, TYPE_OPTIONS } from '../types';
import { SearchableSelect } from './SearchableSelect';
import { QuantityStepper } from './QuantityStepper';
import { MAX_DISTRIBUTION_QUANTITY } from '../config/distribution';

export interface ClientDraft {
  key: string;
  associationId?: string;
  name: string;
  mobile: string;
  email: string;
  /** Sweets to give this client. Starts at 0; a new client needs more than 0 to save. */
  quantity: number;
  /** An edited client that already has a stored quantity must keep one above 0. */
  hadQuantity?: boolean;
  saving: boolean;
  error: string;
  /** Stored phone of an edited record, so an untouched older-format number is not rejected. */
  originalMobile?: string;
  type?: string;
  bd?: string;
  /** Existing Type on an edited record; only records created before Type existed may be assigned one. */
  typeLocked?: boolean;
}

interface Props {
  draft: ClientDraft;
  onChange: (changes: Partial<ClientDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  distributionBDs?: BD[];
  bdState?: 'loading' | 'ready' | 'error';
  /** Offered in the Requestee dropdown when a search finds nobody. */
  onCreateRequestee?: (term: string) => void;
}

const inputClass = 'w-full min-w-[150px] px-3 py-2.5 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 disabled:opacity-60';

export const InlineClientRow: React.FC<Props> = ({ draft, onChange, onSave, onCancel, distributionBDs, bdState = 'ready', onCreateRequestee }) => (
  <tr className="bg-amber-50/50 align-top" data-draft-row={draft.key}>
    <td className="p-4 text-xs text-slate-500">{draft.associationId ? 'Edit' : 'New'}</td>
    {(['name', 'mobile', 'email'] as const).map(field => (
      <td key={field} className="p-4">
        <input aria-label={field === 'name' ? 'Client/Vendor Name' : field === 'mobile' ? distributionBDs ? 'Phone Number' : 'Mobile Number' : 'Email ID (Optional)'}
          type={field === 'email' ? 'email' : field === 'mobile' ? 'tel' : 'text'}
          {...(field === 'mobile' ? { inputMode: 'numeric' as const, maxLength: 15, placeholder: '10-digit number', title: '10 digits, numbers only' } : {})}
          required={field !== 'email'} value={draft[field]} disabled={draft.saving}
          autoFocus={field === 'name'} onChange={event => onChange({ [field]: field === 'mobile' ? event.target.value.replace(/\D/g, '').slice(0, 10) : event.target.value, error: '' })}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSave(); } }}
          className={inputClass} />
      </td>
    ))}
    {distributionBDs && <>
      <td className="p-4 min-w-[11rem]"><SearchableSelect ariaLabel="Client Type" size="sm" clearable={false} value={draft.type || ''} disabled={draft.saving || (!!draft.associationId && !!draft.typeLocked)}
        onChange={value => onChange({ type: value, error: '' })} placeholder="Select Type" options={TYPE_OPTIONS.map(value => ({ value, label: value }))} /></td>
      <td className="p-4 min-w-[16rem]"><SearchableSelect ariaLabel="Client Requestee" size="sm" avatars searchable onCreate={onCreateRequestee} createLabel="Add Requestee" clearable={false} value={draft.bd || ''} disabled={draft.saving || !!draft.associationId}
        onChange={value => onChange({ bd: value, error: '' })}
        placeholder={bdState === 'loading' ? 'Loading Requestees...' : bdState === 'error' ? 'Requestees unavailable' : !distributionBDs.length ? 'No Requestees available' : 'Select Requestee'}
        options={distributionBDs.map(bd => ({ value: bd._id, label: bd.name, subtext: bd.email }))} /></td>
      <td className="p-4 text-slate-500">{distributionBDs.find(bd => bd._id === draft.bd)?.email || '—'}</td>
      <td className="p-4 whitespace-nowrap"><QuantityStepper value={draft.quantity} max={MAX_DISTRIBUTION_QUANTITY} disabled={draft.saving} onChange={value => onChange({ quantity: value, error: '' })} /></td>
      <td className="p-4 text-slate-400">&mdash;</td><td className="p-4 text-slate-400">&mdash;</td>
      <td className="p-4 text-slate-400">&mdash;</td>
    </>}
    <td className="p-4 min-w-[160px]">
      <div className="flex gap-2">
        <button type="button" onClick={onSave} disabled={draft.saving} className="px-3 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50">{draft.saving ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={draft.saving} className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white disabled:opacity-50">Cancel</button>
      </div>
      {draft.error && <p role="alert" className="mt-2 text-xs text-rose-700 max-w-xs">{draft.error}</p>}
    </td>
  </tr>
);
