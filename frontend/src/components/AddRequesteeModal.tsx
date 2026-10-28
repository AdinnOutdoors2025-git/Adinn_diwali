import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { api } from '../services/api';
import { BD } from '../types';
import { seedRequestee, validateRequestee } from '../utils/requestee';

interface Props {
  isOpen: boolean;
  /** What was typed in the dropdown search; pre-fills the form. */
  term: string;
  existing: BD[];
  onClose: () => void;
  /** Called with the saved (or already existing, when chosen) Requestee so the caller can refresh and select it. */
  onSaved: (bd: BD) => void | Promise<void>;
}

const field = 'w-full px-3 py-2.5 text-sm border rounded-lg bg-white focus:outline-none focus:ring-2 disabled:opacity-60';
const ok = 'border-slate-300 focus:border-amber-500 focus:ring-amber-500/20', bad = 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20';

export const AddRequesteeModal: React.FC<Props> = ({ isOpen, term, existing, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<ReturnType<typeof validateRequestee>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const seed = seedRequestee(term);
    setName(seed.name); setEmail(seed.email); setErrors({}); setFormError(''); setSaving(false);
  }, [isOpen, term]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const check = validateRequestee(name, email, existing);
    setErrors(check); setFormError('');
    if (check.name || check.email) return;
    pending.current = true; setSaving(true);
    try {
      const result = await api.createBD(name.trim().replace(/\s+/g, ' '), email.trim().toLowerCase());
      await onSaved(result.data);
    } catch (error: any) {
      // The API is the final authority on duplicates (for example one added by someone else a moment ago).
      setFormError(error.message || 'Unable to save the Requestee. Please try again.');
    } finally { pending.current = false; setSaving(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!saving) onClose(); }} title="Add Requestee" subtitle="Register a new Requestee, then select them automatically.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {formError && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-3 rounded-lg">{formError}</p>}
        <label className="block text-xs font-semibold text-slate-600">Requestee Name <span className="text-rose-500">*</span>
          <input aria-label="Requestee Name" type="text" autoFocus maxLength={120} value={name} disabled={saving} aria-invalid={!!errors.name}
            onChange={event => { setName(event.target.value); setErrors(current => ({ ...current, name: undefined, duplicate: undefined })); }} className={`${field} mt-1.5 ${errors.name ? bad : ok}`} />
          {errors.name && <span role="alert" className="block mt-1 text-xs font-normal text-rose-700">{errors.name}</span>}
        </label>
        <label className="block text-xs font-semibold text-slate-600">Email ID <span className="text-rose-500">*</span>
          <input aria-label="Requestee Email" type="email" inputMode="email" value={email} disabled={saving} aria-invalid={!!errors.email}
            onChange={event => { setEmail(event.target.value); setErrors(current => ({ ...current, email: undefined, duplicate: undefined })); }} className={`${field} mt-1.5 ${errors.email ? bad : ok}`} />
          {errors.email && <span role="alert" className="block mt-1 text-xs font-normal text-rose-700">{errors.email}</span>}
        </label>
        {errors.duplicate && (
          <button type="button" onClick={() => { const existingBD = errors.duplicate!; Promise.resolve(onSaved(existingBD)); }}
            className="w-full px-3 py-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold hover:bg-amber-100">
            Use existing: {errors.duplicate.name} ({errors.duplicate.email})
          </button>
        )}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <button type="button" disabled={saving} onClick={onClose} className="px-3 py-2 border rounded-lg text-xs disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save Requestee'}</button>
        </div>
      </form>
    </Modal>
  );
};
