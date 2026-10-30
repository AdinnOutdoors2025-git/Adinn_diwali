import React from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props { value: number; onChange: (value: number) => void; max?: number; disabled?: boolean; labelledBy?: string }

const button = 'inline-flex items-center justify-center w-10 h-10 text-amber-700 bg-white hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed';

// Compact "- [n] +" control. The value never goes below 0 (or above max), whether changed by the buttons or by typing.
export const QuantityStepper: React.FC<Props> = ({ value, onChange, max = 10000, disabled, labelledBy }) => {
  const set = (next: number) => onChange(Math.min(max, Math.max(0, Number.isFinite(next) ? Math.floor(next) : 0)));
  return (
    <div role="group" aria-labelledby={labelledBy} data-quantity-stepper className="inline-flex items-stretch overflow-hidden rounded-lg border border-amber-300 bg-white divide-x divide-amber-200 focus-within:ring-2 focus-within:ring-amber-500/20">
      <button type="button" aria-label="Decrease quantity" disabled={disabled || value <= 0} onClick={() => set(value - 1)} className={button}><Minus className="w-4 h-4" /></button>
      <input aria-label="Quantity" data-quantity-input type="text" inputMode="numeric" pattern="[0-9]*" disabled={disabled} value={value}
        onChange={event => set(parseInt(event.target.value.replace(/\D/g, ''), 10))}
        className="w-16 text-center text-sm font-bold text-slate-900 bg-amber-50/60 focus:outline-none disabled:opacity-60" />
      <button type="button" aria-label="Increase quantity" disabled={disabled || value >= max} onClick={() => set(value + 1)} className={button}><Plus className="w-4 h-4" /></button>
    </div>
  );
};
