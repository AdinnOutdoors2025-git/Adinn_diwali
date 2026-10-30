// Lets the Home analytics refresh the moment a distribution is added, advanced or reverted: in this tab through a window
// event, in other open tabs through the storage event. Polling and focus refresh remain the fallback.
export const DISTRIBUTIONS_CHANGED = 'adinn:distributions-changed';
const STORAGE_KEY = 'adinn_distributions_changed';

export const notifyDistributionsChanged = () => {
  window.dispatchEvent(new Event(DISTRIBUTIONS_CHANGED));
  try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch { /* storage unavailable: other tabs rely on polling */ }
};

export const onDistributionsChanged = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener(DISTRIBUTIONS_CHANGED, listener);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(DISTRIBUTIONS_CHANGED, listener); window.removeEventListener('storage', onStorage); };
};
