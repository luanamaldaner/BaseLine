import { useLayoutEffect, useRef } from 'react';

const scrollLocks = new WeakMap();
const inertLocks = new WeakMap();
const modalStack = [];
const BODY_PROPERTIES = ['position', 'top', 'left', 'width', 'overflow', 'padding-right', 'overscroll-behavior'];
const ROOT_PROPERTIES = ['overflow', 'overscroll-behavior', 'scroll-behavior'];
const capture = (style, properties) => properties.map((name) => [name, style.getPropertyValue(name), style.getPropertyPriority(name)]);
const restore = (style, properties) => properties.forEach(([name, value, priority]) => {
  if (value) style.setProperty(name, value, priority);
  else style.removeProperty(name);
});

// Fixed positioning also locks Safari's page while allowing the modal's own
// content to scroll. Only the final nested modal restores the original page.
export function lockBodyScroll(doc = document, win = window) {
  let lock = scrollLocks.get(doc);
  if (!lock) {
    const body = doc.body, root = doc.documentElement;
    lock = {
      count: 0, x: win.scrollX, y: win.scrollY,
      body: capture(body.style, BODY_PROPERTIES), root: capture(root.style, ROOT_PROPERTIES),
    };
    const gutter = Math.max(0, win.innerWidth - root.clientWidth);
    const padding = parseFloat(win.getComputedStyle(body).paddingRight) || 0;
    body.style.setProperty('position', 'fixed');
    body.style.setProperty('top', -lock.y + 'px');
    body.style.setProperty('left', -lock.x + 'px');
    body.style.setProperty('width', '100%');
    body.style.setProperty('overflow', 'hidden');
    body.style.setProperty('overscroll-behavior', 'none');
    if (gutter) body.style.setProperty('padding-right', padding + gutter + 'px');
    root.style.setProperty('overflow', 'hidden');
    root.style.setProperty('overscroll-behavior', 'none');
    root.style.setProperty('scroll-behavior', 'auto');
    scrollLocks.set(doc, lock);
  }
  lock.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.count) return;
    restore(doc.body.style, lock.body);
    restore(doc.documentElement.style, lock.root.filter(([name]) => name !== 'scroll-behavior'));
    win.scrollTo({ left: lock.x, top: lock.y, behavior: 'instant' });
    restore(doc.documentElement.style, lock.root.filter(([name]) => name === 'scroll-behavior'));
    scrollLocks.delete(doc);
  };
}

function makeInert(element) {
  let lock = inertLocks.get(element);
  if (!lock) {
    lock = { count: 0, inert: element.getAttribute('inert'), ariaHidden: element.getAttribute('aria-hidden') };
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
    inertLocks.set(element, lock);
  }
  lock.count++;
  return () => {
    if (--lock.count) return;
    for (const [attribute, value] of [['inert', lock.inert], ['aria-hidden', lock.ariaHidden]]) {
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
    }
    inertLocks.delete(element);
  };
}

const focusable = (dialog) => [...dialog.querySelectorAll(
  'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
)].filter((element) => element.getClientRects().length && !element.closest('[hidden],[inert]'));

export function useModalDialog(dialogRef, onRequestClose) {
  const closeRef = useRef(onRequestClose);
  closeRef.current = onRequestClose;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement;
    const unlock = lockBodyScroll();
    const restoreBackground = [];
    // Works for portals and inline dialogs without making an ancestor inert.
    for (let branch = dialog; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of branch.parentElement.children) if (sibling !== branch) restoreBackground.push(makeInert(sibling));
      if (branch.parentElement === document.body) break;
    }
    const token = {};
    modalStack.push(token);
    const isTop = () => modalStack.at(-1) === token;
    const moveFocus = (last = false) => {
      const choices = focusable(dialog);
      ((last ? choices.at(-1) : choices[0]) ?? dialog).focus({ preventScroll: true });
    };
    const keydown = (event) => {
      if (!isTop()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const choices = focusable(dialog), active = document.activeElement;
        if (!choices.length || !dialog.contains(active) || (event.shiftKey ? active === choices[0] || active === dialog : active === choices.at(-1))) {
          event.preventDefault();
          moveFocus(event.shiftKey);
        }
      }
    };
    const focusin = (event) => { if (isTop() && !dialog.contains(event.target)) moveFocus(); };
    const touchmove = (event) => { if (isTop() && !dialog.contains(event.target)) event.preventDefault(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    document.addEventListener('touchmove', touchmove, { passive: false });
    dialog.focus({ preventScroll: true });
    return () => {
      const index = modalStack.indexOf(token);
      if (index >= 0) modalStack.splice(index, 1);
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
      document.removeEventListener('touchmove', touchmove);
      restoreBackground.reverse().forEach((restore) => restore());
      unlock();
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }, [dialogRef]);
}
