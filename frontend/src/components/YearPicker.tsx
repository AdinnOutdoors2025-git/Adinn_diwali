import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  value: number;
  years: number[];
  /** The operating Diwali year; marked in the grid and offered as a shortcut. */
  currentYear?: number;
  onChange: (year: number) => void;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

const PAGE = 12; // 4 columns x 3 rows

// A year "calendar": a 4x3 grid of years with paging. Years outside the allowed list are shown but disabled,
// so the grid still reads as a calendar.
export const YearPicker: React.FC<Props> = ({ value, years, currentYear, onChange, ariaLabel = 'Year', disabled, className = '' }) => {
  const first = years[0] ?? value, last = years[years.length - 1] ?? value;
  const pageStart = (year: number) => first + Math.floor((year - first) / PAGE) * PAGE;
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(pageStart(value));
  const [focusYear, setFocusYear] = useState(value);
  const [box, setBox] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const allowed = new Set(years);
  const width = 288;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const height = 330;
    const below = rect.bottom + 6 + height <= window.innerHeight;
    setBox({ top: below ? rect.bottom + 6 : Math.max(8, rect.top - height - 6), left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setStart(pageStart(value)); setFocusYear(value);
    panelRef.current?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const away = (event: Event) => { if (!panelRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside); window.addEventListener('scroll', away, true); window.addEventListener('resize', away as EventListener);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('scroll', away, true); window.removeEventListener('resize', away as EventListener); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (year: number) => { if (!allowed.has(year)) return; onChange(year); setOpen(false); triggerRef.current?.focus(); };
  const move = (delta: number) => {
    const next = Math.min(last, Math.max(first, focusYear + delta));
    setFocusYear(next); setStart(pageStart(next));
  };
  const onKey = (event: React.KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4, PageUp: -PAGE, PageDown: PAGE };
    if (event.key in keys) { event.preventDefault(); move(keys[event.key]); }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(focusYear); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    else if (event.key === 'Tab') setOpen(false);
  };

  const cells = Array.from({ length: PAGE }, (_, index) => start + index);
  const arrow = 'inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className={`relative ${className}`}>
      <button ref={triggerRef} type="button" role="combobox" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} disabled={disabled}
        onClick={() => setOpen(current => !current)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}
        className={`w-full flex items-center justify-between bg-white border rounded-lg px-3 py-2.5 text-xs transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 disabled:bg-slate-100 disabled:text-slate-400 ${open ? 'ring-2 ring-amber-500/20 border-amber-500' : 'border-slate-300 hover:border-slate-400'}`}>
        <span className="flex items-center gap-2 text-slate-800 font-medium"><CalendarDays className="w-4 h-4 text-amber-600" aria-hidden="true" />Diwali {value}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180 text-amber-600' : ''}`} />
      </button>
      {open && createPortal(
        <div ref={panelRef} tabIndex={-1} role="dialog" aria-label="Choose Diwali year" onKeyDown={onKey}
          style={{ position: 'fixed', top: box.top, left: box.left, width, zIndex: 70 }}
          className="outline-none bg-white border border-slate-200 rounded-xl shadow-2xl ring-1 ring-black/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" aria-label="Previous years" disabled={start <= first} onClick={() => setStart(current => current - PAGE)} className={arrow}><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-bold text-slate-800">{start} &ndash; {start + PAGE - 1}</span>
            <button type="button" aria-label="Next years" disabled={start + PAGE > last} onClick={() => setStart(current => current + PAGE)} className={arrow}><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div role="grid" aria-label="Years" className="grid grid-cols-4 gap-1.5">
            {cells.map(year => {
              const enabled = allowed.has(year), selected = year === value, focused = year === focusYear, current = year === currentYear;
              return (
                <button key={year} type="button" role="gridcell" aria-selected={selected} aria-label={`Diwali ${year}${current ? ' (current)' : ''}`} disabled={!enabled}
                  onClick={() => pick(year)} onMouseEnter={() => enabled && setFocusYear(year)}
                  className={`relative h-11 rounded-lg text-sm font-semibold transition-colors ${
                    selected ? 'bg-amber-600 text-white shadow-sm' : !enabled ? 'text-slate-300 cursor-not-allowed' : focused ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300' : 'text-slate-700 hover:bg-slate-100'}`}>
                  {year}
                  {current && <span aria-hidden="true" className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${selected ? 'bg-white' : 'bg-amber-500'}`} />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
            <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Current Diwali year</span>
            {currentYear !== undefined && allowed.has(currentYear) && <button type="button" onClick={() => pick(currentYear)} className="font-semibold text-amber-700 hover:text-amber-800">Jump to {currentYear}</button>}
          </div>
        </div>, document.body)}
    </div>
  );
};
