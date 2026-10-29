import { useLayoutEffect, useRef } from 'react';

export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const focusInside = () => {
      const items = controls();
      (items.find((element) => element.matches('input, select, textarea')) || items[0] || dialog).focus({ preventScroll: true });
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const items = controls(); const first = items[0]; const last = items.at(-1);
      if (!first || (event.shiftKey ? document.activeElement === first || document.activeElement === dialog : document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); (event.shiftKey ? last || dialog : first || dialog).focus({ preventScroll: true });
      }
    };
    const containFocus = (event: FocusEvent) => { if (!dialog.contains(event.target as Node)) focusInside(); };
    if (!dialog.contains(document.activeElement)) focusInside();
    dialog.addEventListener('keydown', trapTab);
    document.addEventListener('focusin', containFocus);
    return () => {
      dialog.removeEventListener('keydown', trapTab); document.removeEventListener('focusin', containFocus);
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
