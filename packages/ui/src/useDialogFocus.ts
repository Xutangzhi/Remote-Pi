import { useLayoutEffect, useRef } from 'react';

export function getTopDialog() {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]')).at(-1);
}

export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const focusInside = () => {
      if (getTopDialog() !== dialog) return;
      const items = controls();
      (items.find((element) => element.matches('input, select, textarea, [role="combobox"]')) || items[0] || dialog).focus({ preventScroll: true });
    };
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || getTopDialog() !== dialog) return;
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
      const ownedFocus = dialog.contains(document.activeElement);
      dialog.removeEventListener('keydown', trapTab); document.removeEventListener('focusin', containFocus);
      // Wait for the closing commit to re-enable the opener; another dialog may take focus meanwhile.
      if (ownedFocus) requestAnimationFrame(() => {
        const top = getTopDialog(); const target = opener.current;
        if (document.activeElement === document.body && target?.isConnected && !target.matches(':disabled') && (!top || top.contains(target))) target.focus({ preventScroll: true });
      });
    };
  }, []);
  return ref;
}
