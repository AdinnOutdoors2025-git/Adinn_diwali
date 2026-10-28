import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Image as ImageIcon } from 'lucide-react';
import { DistributionMode, DeliveryStatus, MODE_LABEL, STATUS_FLOW, STATUS_LABEL } from '../config/distribution';

interface Props {
  distributionId: string;
  mode: DistributionMode;
  status: DeliveryStatus;
  hasProof: boolean;
  busy?: boolean;
  /** Called with the stage the user ticked. The parent decides whether proof is needed first. */
  onAdvance: (next: DeliveryStatus) => void;
  onViewProof: () => void;
}

// A dropdown of stage checkboxes. Completed stages are ticked and locked; only the very next stage can be ticked,
// so the UI never offers a transition the backend would reject.
export const StatusDropdown: React.FC<Props> = ({ distributionId, mode, status, hasProof, busy, onAdvance, onViewProof }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const flow = STATUS_FLOW[mode];
  const current = flow.indexOf(status);

  // The table scrolls, so the menu is portalled and positioned against the viewport.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const menuHeight = 56 + flow.length * 40 + (hasProof ? 44 : 0);
    const below = rect.bottom + 6 + menuHeight <= window.innerHeight;
    setPosition({ top: below ? rect.bottom + 6 : Math.max(8, rect.top - menuHeight - 6), left: Math.min(rect.left, Math.max(8, window.innerWidth - 248)) });
  }, [open, flow.length, hasProof]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.(`[data-status-menu="${distributionId}"]`)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open, distributionId]);

  const delivered = status === 'DELIVERED';
  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="true" aria-expanded={open} aria-label={`Delivery status: ${STATUS_LABEL[status]}`} disabled={busy}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border font-semibold disabled:opacity-60 ${delivered ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
        {busy ? 'Saving...' : STATUS_LABEL[status]}<ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && createPortal(
        <div data-status-menu={distributionId} role="group" aria-label={`${MODE_LABEL[mode]} delivery progress`} style={{ position: 'fixed', top: position.top, left: position.left, width: 240, zIndex: 60 }}
          className="bg-white border border-slate-200 rounded-lg shadow-xl p-2 text-xs">
          <p className="px-2 pt-1 pb-2 text-slate-500 font-semibold">{MODE_LABEL[mode]} progress</p>
          {flow.map((stage, index) => {
            const done = index <= current, isNext = index === current + 1;
            return (
              <label key={stage} className={`flex items-center gap-2.5 px-2 py-2.5 rounded-md ${isNext ? 'cursor-pointer hover:bg-amber-50' : 'cursor-default'} ${done ? 'text-slate-800' : isNext ? 'text-slate-700' : 'text-slate-400'}`}>
                <input type="checkbox" checked={done} disabled={!isNext || busy} onChange={() => { setOpen(false); onAdvance(stage); }}
                  aria-label={STATUS_LABEL[stage]} className="w-4 h-4 accent-amber-600 disabled:opacity-60" />
                <span className="font-medium">{STATUS_LABEL[stage]}</span>
                {done && <Check className="w-3.5 h-3.5 ml-auto text-emerald-600" aria-hidden="true" />}
              </label>
            );
          })}
          {hasProof && <button type="button" onClick={() => { setOpen(false); onViewProof(); }} className="mt-1 w-full flex items-center gap-2 px-2 py-2.5 rounded-md text-amber-700 font-semibold hover:bg-amber-50">
            <ImageIcon className="w-4 h-4" />View delivery proof</button>}
        </div>, document.body)}
    </>
  );
};
