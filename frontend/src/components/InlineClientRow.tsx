import React from 'react';
import { BD, VERTICAL_OPTIONS } from '../types';

export interface ClientDraft {
  key: string;
  associationId?: string;
  name: string;
  mobile: string;
  email: string;
  saving: boolean;
  error: string;
  vertical?: string;
  bd?: string;
}

interface Props {
  draft: ClientDraft;
  onChange: (changes: Partial<ClientDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
  distributionBDs?: BD[];
  bdState?: 'loading' | 'ready' | 'error';
}

export const InlineClientRow: React.FC<Props> = ({ draft, onChange, onSave, onCancel, distributionBDs, bdState = 'ready' }) => (
  <tr className="bg-amber-50/50 align-top" data-draft-row={draft.key}>
    <td className="p-3 text-xs text-slate-500">{draft.associationId ? 'Edit' : 'New'}</td>
    {(['name', 'mobile', 'email'] as const).map(field => (
      <td key={field} className="p-3">
        <input aria-label={field === 'name' ? 'Client/Vendor Name' : field === 'mobile' ? distributionBDs ? 'Phone Number' : 'Mobile Number' : 'Email ID (Optional)'}
          type={field === 'email' ? 'email' : field === 'mobile' ? 'tel' : 'text'}
          required={field !== 'email'} value={draft[field]} disabled={draft.saving}
          autoFocus={field === 'name'} onChange={event => onChange({ [field]: event.target.value, error: '' })}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onSave(); } }}
          className="w-full min-w-[150px] px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 disabled:opacity-60" />
      </td>
    ))}
    {distributionBDs && <>
      <td className="p-3"><select aria-label="Client Vertical" value={draft.vertical || ''} disabled={draft.saving || !!draft.associationId} onChange={event => onChange({ vertical: event.target.value, error: '' })} className="w-40 border border-slate-300 rounded-md p-2 text-xs bg-white">
        <option value="">Select Vertical</option>{VERTICAL_OPTIONS.map(value => <option key={value}>{value}</option>)}
      </select></td>
      <td className="p-3"><select aria-label="Client BD" value={draft.bd || ''} disabled={draft.saving || !!draft.associationId} onChange={event => onChange({ bd: event.target.value, error: '' })} className="w-44 border border-slate-300 rounded-md p-2 text-xs bg-white">
        <option value="">{bdState === 'loading' ? 'Loading BDs...' : bdState === 'error' ? 'BDs unavailable' : !distributionBDs.length ? 'No BDs available' : 'Select BD'}</option>{distributionBDs.map(bd => <option key={bd._id} value={bd._id}>{bd.name} ({bd.email})</option>)}
      </select></td>
      <td className="p-3 text-slate-500">{distributionBDs.find(bd => bd._id === draft.bd)?.email || '\u2014'}</td>
      <td className="p-3 text-slate-400">&mdash;</td><td className="p-3 text-slate-400">&mdash;</td>
    </>}
    <td className="p-3 min-w-[160px]">
      <div className="flex gap-2">
        <button type="button" onClick={onSave} disabled={draft.saving} className="px-3 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-md disabled:opacity-50">{draft.saving ? 'Saving...' : 'Save'}</button>
        <button type="button" onClick={onCancel} disabled={draft.saving} className="px-3 py-2 text-xs border border-slate-300 rounded-md bg-white disabled:opacity-50">Cancel</button>
      </div>
      {draft.error && <p role="alert" className="mt-2 text-xs text-rose-700 max-w-xs">{draft.error}</p>}
    </td>
  </tr>
);
