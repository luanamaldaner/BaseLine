import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = readFileSync(new URL('../src/lib/modal.js', import.meta.url), 'utf8')
  .replace(/^import .*;\s*/m, '').replaceAll('export function ', 'function ');

class Style {
  values = new Map();
  getPropertyValue(name) { return this.values.get(name)?.[0] ?? ''; }
  getPropertyPriority(name) { return this.values.get(name)?.[1] ?? ''; }
  setProperty(name, value, priority = '') { this.values.set(name, [value, priority]); }
  removeProperty(name) { this.values.delete(name); }
}

function setup() {
  const listeners = new Map(), effects = [], scrolls = [];
  const document = {
    activeElement: null,
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
  };
  class Element {
    constructor(parent = null, attributes = {}) {
      this.parentElement = parent;
      this.children = [];
      this.attributes = new Map(Object.entries(attributes));
      this.style = new Style();
      this.isConnected = true;
      this.focusable = false;
      parent?.children.push(this);
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    closest(selector) {
      if ((selector.includes('[inert]') && this.attributes.has('inert')) ||
          (selector.includes('[hidden]') && this.attributes.has('hidden'))) return this;
      return this.parentElement?.closest(selector) ?? null;
    }
    contains(element) { return element === this || this.children.some((child) => child.contains(element)); }
    querySelectorAll() {
      return this.children.flatMap((child) => [child, ...child.querySelectorAll()])
        .filter((child) => child.focusable && !child.attributes.has('disabled'));
    }
    getClientRects() { return [1]; }
    focus(options) { document.activeElement = this; this.lastFocusOptions = options; }
  }
  document.documentElement = new Element();
  document.documentElement.clientWidth = 980;
  document.body = new Element(document.documentElement);
  const window = {
    scrollX: 7, scrollY: 844, innerWidth: 1000,
    getComputedStyle: () => ({ paddingRight: '8px' }),
    scrollTo(options) { scrolls.push(options); this.scrollX = options.left; this.scrollY = options.top; },
  };
  const context = vm.createContext({
    document, window, useRef: (current) => ({ current }),
    useLayoutEffect: (effect) => { effects.push(effect()); },
  });
  vm.runInContext(source + '\nglobalThis.api = { lockBodyScroll, useModalDialog };', context);
  function dispatch(type, properties = {}) {
    const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...properties };
    for (const handler of listeners.get(type) ?? []) handler(event);
    return event;
  }
  return { ...context.api, document, window, Element, effects, listeners, scrolls, dispatch };
}

test('nested scroll locks preserve existing styles and restore the original mobile scroll position once', () => {
  const h = setup(), body = h.document.body.style, root = h.document.documentElement.style;
  body.setProperty('position', 'relative', 'important');
  body.setProperty('padding-right', '8px');
  body.setProperty('width', '90%');
  root.setProperty('scroll-behavior', 'smooth', 'important');
  root.setProperty('overflow', 'auto');
  const beforeBody = new Map(body.values), beforeRoot = new Map(root.values);
  const releaseOuter = h.lockBodyScroll(), releaseInner = h.lockBodyScroll();
  assert.equal(body.getPropertyValue('position'), 'fixed');
  assert.equal(body.getPropertyValue('top'), '-844px');
  assert.equal(body.getPropertyValue('left'), '-7px');
  assert.equal(body.getPropertyValue('padding-right'), '28px');
  assert.equal(root.getPropertyValue('overflow'), 'hidden');
  releaseOuter();
  releaseOuter();
  assert.equal(body.getPropertyValue('position'), 'fixed');
  assert.equal(h.scrolls.length, 0);
  releaseInner();
  releaseInner();
  assert.deepEqual(body.values, beforeBody);
  assert.deepEqual(root.values, beforeRoot);
  assert.equal(h.scrolls.length, 1);
  assert.equal(h.scrolls[0].top, 844);
  assert.equal(h.scrolls[0].left, 7);
  assert.equal(h.scrolls[0].behavior, 'instant');
});

test('modal traps keyboard focus, blocks background touch and restores focus and inert attributes', () => {
  const h = setup(), { document: doc, Element } = h;
  const app = new Element(doc.body, { 'aria-hidden': 'false' });
  const trigger = new Element(app);
  const originallyInert = new Element(doc.body, { inert: '', 'aria-hidden': 'true' });
  const overlay = new Element(doc.body), dialog = new Element(overlay);
  const first = new Element(dialog), last = new Element(dialog);
  first.focusable = last.focusable = true;
  trigger.focus();
  let closes = 0;
  h.useModalDialog({ current: dialog }, () => { closes++; });
  assert.equal(doc.activeElement, dialog);
  assert.equal(app.getAttribute('inert'), '');
  assert.equal(app.getAttribute('aria-hidden'), 'true');
  assert.equal(dialog.closest('[inert]'), null);
  first.focus();
  assert.equal(h.dispatch('keydown', { key: 'Tab', shiftKey: true }).prevented, true);
  assert.equal(doc.activeElement, last);
  assert.equal(h.dispatch('keydown', { key: 'Tab' }).prevented, true);
  assert.equal(doc.activeElement, first);
  trigger.focus();
  h.dispatch('focusin', { target: trigger });
  assert.equal(doc.activeElement, first);
  assert.equal(h.dispatch('touchmove', { target: app }).prevented, true);
  assert.equal(h.dispatch('touchmove', { target: first }).prevented, false);
  const escape = h.dispatch('keydown', { key: 'Escape' });
  assert.equal(closes, 1);
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  h.effects[0]();
  assert.equal(app.getAttribute('inert'), null);
  assert.equal(app.getAttribute('aria-hidden'), 'false');
  assert.equal(originallyInert.getAttribute('inert'), '');
  assert.equal(originallyInert.getAttribute('aria-hidden'), 'true');
  assert.equal(doc.activeElement, trigger);
  assert.equal(trigger.lastFocusOptions.preventScroll, true);
  assert.ok([...h.listeners.values()].every((set) => set.size === 0));
});

test('all-disabled saving state keeps Shift+Tab focus in the dialog', () => {
  const h = setup(), overlay = new h.Element(h.document.body), dialog = new h.Element(overlay);
  const save = new h.Element(dialog, { disabled: '' });
  save.focusable = true;
  h.useModalDialog({ current: dialog }, () => {});
  assert.equal(h.dispatch('keydown', { key: 'Tab', shiftKey: true }).prevented, true);
  assert.equal(h.document.activeElement, dialog);
  assert.equal(h.dispatch('keydown', { key: 'Tab' }).prevented, true);
  assert.equal(h.document.activeElement, dialog);
  h.effects[0]();
});

test('closing a nested modal retains the outer lock and only the top dialog handles Escape', () => {
  const h = setup(), app = new h.Element(h.document.body), trigger = new h.Element(app);
  const outerOverlay = new h.Element(h.document.body), outer = new h.Element(outerOverlay);
  const outerButton = new h.Element(outer); outerButton.focusable = true;
  trigger.focus();
  let outerCloses = 0, innerCloses = 0;
  h.useModalDialog({ current: outer }, () => { outerCloses++; });
  outerButton.focus();
  const innerOverlay = new h.Element(h.document.body), inner = new h.Element(innerOverlay);
  h.useModalDialog({ current: inner }, () => { innerCloses++; });
  h.dispatch('keydown', { key: 'Escape' });
  assert.equal(innerCloses, 1);
  assert.equal(outerCloses, 0);
  h.effects[1]();
  assert.equal(h.document.body.style.getPropertyValue('position'), 'fixed');
  assert.equal(app.getAttribute('inert'), '');
  assert.equal(outerOverlay.getAttribute('inert'), null);
  assert.equal(h.document.activeElement, outerButton);
  h.dispatch('keydown', { key: 'Escape' });
  assert.equal(outerCloses, 1);
  h.effects[0]();
  assert.equal(app.getAttribute('inert'), null);
  assert.equal(h.document.activeElement, trigger);
  assert.equal(h.scrolls.length, 1);
});
