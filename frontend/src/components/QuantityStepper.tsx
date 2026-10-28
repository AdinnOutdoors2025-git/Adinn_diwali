import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { clampQuantity } from '../config/distribution';

interface Props {
  value: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

// Centered "[ - ] quantity [ + ]" control. Minimum 1; maximum is the client's Allowed Quantity.
export const QuantityStepper: React.FC<Props> = ({ value, max, onChange, disabled }) => {
  const limit = Math.max(1, max);
  const button = 'inline-flex items-center justify-center w-10 h-10 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500/30';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div role="group" aria-label="Distribution quantity" className="inline-flex items-center justify-center gap-2">
        <button type="button" aria-label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(clampQuantity(value - 1, limit))} className={button}><Minus className="w-4 h-4" /></button>
        <input aria-label="Quantity" type="text" inputMode="numeric" pattern="[0-9]*" value={value} disabled={disabled}
          onChange={event => { const digits = event.target.value.replace(/\D/g, ''); if (digits) onChange(clampQuantity(Number(digits), limit)); }}
          className="w-16 h-10 text-center text-sm font-semibold text-slate-800 border border-slate-300 rounded-lg bg-white focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:opacity-60" />
        <button type="button" aria-label="Increase quantity" disabled={disabled || value >= limit} onClick={() => onChange(clampQuantity(value + 1, limit))} className={button}><Plus className="w-4 h-4" /></button>
      </div>
      <span className="text-xs text-slate-500">Allowed: 1 to {limit}</span>
    </div>
  );
};
