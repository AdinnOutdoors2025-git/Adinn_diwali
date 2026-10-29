import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';

interface Option {
  label: string;
  value: string;
  subtext?: string;
}

interface SearchableSelectProps {
  id?: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  /** Show an X to clear the selection (selecting "" ). Turn off when a value like "All" is always selected. */
  clearable?: boolean;
  /** Show an initials avatar before each option (for people). */
  avatars?: boolean;
  /** "sm" is compact (inside tables); "filter" matches the other filter-bar selects. */
  size?: 'md' | 'sm' | 'filter';
  /** Show a search box. Only worth it for long lists such as Requestees; short lists are plain pick-lists. */
  searchable?: boolean;
  /** When a search matches nothing, offers "+ {createLabel}: term". Receives the search term; the list closes first. */
  onCreate?: (term: string) => void;
  createLabel?: string;
  /** Minimum width of the open list. Defaults to 340 for searchable lists and the trigger width otherwise. */
  menuMinWidth?: number;
}

const initials = (label: string) => label.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?';

const Highlight: React.FC<{ text: string; term: string }> = ({ text, term }) => {
  const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark className="bg-amber-100 text-amber-900 rounded-sm px-0.5">{text.slice(at, at + term.length)}</mark>{text.slice(at + term.length)}</>;
};

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  options,
  value,
  onChange,
  placeholder = 'Select an option...',
  disabled = false,
  className = '',
  ariaLabel,
  searchPlaceholder = 'Search by name or email...',
  clearable = true,
  avatars = false,
  size = 'md',
  searchable = false,
  onCreate,
  createLabel = 'Add new',
  menuMinWidth,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({ left: 0, width: 0, maxHeight: 360 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedOption = options.find((opt) => opt.value === value);
  const term = searchable ? searchTerm.trim() : '';
  const minWidth = menuMinWidth ?? (searchable ? 340 : 0);
  const filteredOptions = useMemo(() => {
    const needle = term.toLowerCase();
    return needle ? options.filter(opt => opt.label.toLowerCase().includes(needle) || (opt.subtext || '').toLowerCase().includes(needle)) : options;
  }, [options, term]);

  const close = (refocus = false) => { setIsOpen(false); if (refocus) triggerRef.current?.focus(); };
  const choose = (next: string) => { onChange(next); close(true); };
  const canCreate = searchable && !!onCreate && term.length > 0 && filteredOptions.length === 0;
  const create = () => { if (!onCreate) return; const text = term; close(); onCreate(text); };

  // The list is portalled and positioned against the viewport, so scrolling tables never clip it.
  // It re-anchors to the trigger on scroll/resize, and closes only when the trigger leaves the screen.
  const place = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setIsOpen(false); return; }
    const width = Math.min(Math.max(rect.width, minWidth), window.innerWidth - 16);
    // Open flush with the trigger's left edge. When a wider list would run off the right of the screen (a trigger near the
    // right edge), align the right edges instead so it still hangs directly under the trigger, then keep it on screen.
    const left = Math.max(8, rect.left + width > window.innerWidth - 8 ? Math.min(rect.right - width, window.innerWidth - width - 8) : rect.left);
    const spaceBelow = window.innerHeight - rect.bottom - 12, spaceAbove = rect.top - 12;
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    setBox(openUp ? { bottom: window.innerHeight - rect.top + 6, left, width, maxHeight: Math.min(400, spaceAbove) }
      : { top: rect.bottom + 6, left, width, maxHeight: Math.min(400, spaceBelow) });
  }, [minWidth]);
  useLayoutEffect(() => { if (isOpen) place(); }, [isOpen, place]);

  useEffect(() => {
    if (!isOpen) { setSearchTerm(''); return; }
    setActive(Math.max(0, options.findIndex(opt => opt.value === value)));
    (searchable ? searchInputRef.current : panelRef.current)?.focus();
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) setIsOpen(false);
    };
    const onScroll = (event: Event) => { if (!panelRef.current?.contains(event.target as Node)) place(); };
    const onResize = () => place();
    document.addEventListener('mousedown', outside);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { document.removeEventListener('mousedown', outside); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => { setActive(0); }, [term]);
  useEffect(() => {
    if (isOpen) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, isOpen]);

  const onPanelKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(filteredOptions.length - 1, index + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(Math.max(0, filteredOptions.length - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (filteredOptions[active]) choose(filteredOptions[active].value); else if (canCreate) create(); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close();
  };

  const sm = size === 'sm';
  return (
    <div className={`relative ${className}`} id={id}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        disabled={disabled}
        title={selectedOption ? [selectedOption.label, selectedOption.subtext].filter(Boolean).join(' - ') : undefined}
        onClick={() => !disabled && setIsOpen(open => !open)}
        onKeyDown={event => { if (!disabled && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setIsOpen(true); } }}
        className={`w-full flex items-center justify-between bg-white border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 ${sm ? 'px-3 py-2.5 text-sm' : size === 'filter' ? 'px-3 py-2.5 text-xs' : 'px-3.5 py-2.5 text-sm'} ${
          disabled
            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
            : 'border-slate-300 hover:border-slate-400 text-slate-800'
        } ${isOpen ? 'ring-2 ring-amber-500/20 border-amber-500' : ''}`}
      >
        <span className={`truncate text-left font-normal ${!selectedOption ? 'text-slate-400' : 'text-slate-800 font-medium'}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <div className="flex items-center gap-1.5 ml-2 text-slate-400 shrink-0">
          {clearable && selectedOption && !disabled && (
            <span
              role="button"
              aria-label="Clear selection"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  onChange('');
                }
              }}
              className="p-0.5 hover:text-slate-600 rounded transition-colors"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-amber-600' : ''}`} />
        </div>
      </button>

      {isOpen && !disabled && createPortal(
        <div ref={panelRef} tabIndex={-1} onKeyDown={onPanelKey} aria-activedescendant={!searchable && filteredOptions[active] ? `${listId}-${active}` : undefined}
          style={{ position: 'fixed', top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight, zIndex: 70 }}
          className="outline-none flex flex-col bg-white border border-slate-200 rounded-xl shadow-2xl ring-1 ring-black/5 overflow-hidden">
          {searchable && (
          <div className="p-2.5 border-b border-slate-100 bg-slate-50/70 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                role="searchbox"
                aria-label="Search options"
                aria-controls={listId}
                aria-activedescendant={filteredOptions[active] ? `${listId}-${active}` : undefined}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-800 placeholder-slate-400"
              />
              {searchTerm && (
                <button type="button" aria-label="Clear search" onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
              )}
            </div>
          </div>
          )}

          <div ref={listRef} id={listId} role="listbox" aria-label={ariaLabel} className="overflow-y-auto p-1.5 min-h-0 overscroll-contain">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-5 text-xs text-center text-slate-500">
                <Search className="w-5 h-5 mx-auto mb-1.5 text-slate-300" />
                No matches for &ldquo;{term}&rdquo;
                {canCreate && (
                  <button type="button" onClick={create}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 text-amber-800 text-sm font-semibold hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/30">
                    <span className="truncate">+ {createLabel}: {term}</span>
                  </button>
                )}
              </div>
            ) : (
              filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value, isActive = index === active;
                return (
                  <div
                    key={opt.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActive(index)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => choose(opt.value)}
                    className={`flex items-center gap-3 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                      isSelected ? 'bg-amber-50 text-amber-900' : isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700'
                    }`}
                  >
                    {avatars && (
                      <span aria-hidden="true" className={`flex items-center justify-center w-8 h-8 rounded-full text-[11px] font-bold shrink-0 ${isSelected ? 'bg-amber-200 text-amber-900' : 'bg-slate-200 text-slate-600'}`}>{initials(opt.label)}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-sm ${isSelected ? 'font-semibold' : 'font-medium'}`}><Highlight text={opt.label} term={term} /></div>
                      {opt.subtext && <div className="text-xs text-slate-500 truncate"><Highlight text={opt.subtext} term={term} /></div>}
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />}
                  </div>
                );
              })
            )}
          </div>

          {searchable && (
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50/70 text-[11px] leading-4 text-slate-500 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 shrink-0" aria-live="polite">
            <span className="whitespace-nowrap">{filteredOptions.length} of {options.length}</span>
            <span className="hidden sm:inline whitespace-nowrap">&uarr;&darr; navigate &middot; Enter select &middot; Esc close</span>
          </div>
          )}
        </div>, document.body)}
    </div>
  );
};
