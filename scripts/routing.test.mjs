import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformWithOxc } from 'vite';
import { pageForPath } from '../src/lib/route.js';

function visit(url, { storageAvailable = true, existingInvite } = {}) {
  const location = new URL(url);
  const values = new Map(existingInvite ? [['pendingJoin', existingInvite]] : []);
  const localStorage = Object.fromEntries(Object.entries({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }).map(([name, fn]) => [name, (...args) => {
    if (!storageAvailable) throw new Error('Storage unavailable');
    return fn(...args);
  }]));
  const context = vm.createContext({
    location, localStorage, URLSearchParams,
    history: { replaceState: (_state, _title, next) => { location.href = new URL(next, location).href; } },
  });
  const source = readFileSync(new URL('../src/lib/invite.js', import.meta.url), 'utf8').replace(/\bexport /g, '');
  vm.runInContext(source + '\nglobalThis.invites = { captureInvite, pendingInvite, clearInvite, inviteUrl };', context);
  return { ...context.invites, location, values };
}

test('Baseline remains the home and invite destination while merch has its own public route', () => {
  for (const path of ['/', '/app', '/merchandise', '/merch/checkout']) assert.equal(pageForPath(path), 'app');
  for (const path of ['/merch', '/merch/']) assert.equal(pageForPath(path), 'merch');
  assert.equal(pageForPath(new URL('https://baseline.example/merch?join=ABCDEF').pathname), 'merch');
});

test('a shared team link still opens Baseline and keeps the invite through signup', () => {
  const coach = visit('https://baseline.example/');
  const link = coach.inviteUrl('K7Q4MX');
  const athlete = visit(link + '&quick=1#start');
  assert.equal(pageForPath(athlete.location.pathname), 'app');
  athlete.captureInvite();
  assert.equal(athlete.pendingInvite(), 'K7Q4MX');
  assert.equal(athlete.location.href, 'https://baseline.example/?quick=1#start');
  const afterReload = visit(athlete.location.href, { existingInvite: athlete.values.get('pendingJoin') });
  assert.equal(afterReload.pendingInvite(), 'K7Q4MX');
  afterReload.clearInvite();
  assert.equal(afterReload.pendingInvite(), null);
});

test('valid invitations work for this visit when browser storage is unavailable', () => {
  const athlete = visit('https://baseline.example/?join=k7q4mx', { storageAvailable: false });
  athlete.captureInvite();
  assert.equal(athlete.pendingInvite(), 'K7Q4MX');
  athlete.clearInvite();
  assert.equal(athlete.pendingInvite(), null);
});

test('a malformed invite never replaces a previously accepted pending invitation', () => {
  const athlete = visit('https://baseline.example/?join=NO&quick=1', { existingInvite: 'K7Q4MX' });
  athlete.captureInvite();
  assert.equal(athlete.pendingInvite(), 'K7Q4MX');
  assert.equal(athlete.location.search, '?quick=1');
});

test('entry startup leaves public merch outside invitation capture and app update polling', async () => {
  const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.env.PROD', 'false');
  const { code } = await transformWithOxc(source, 'main.jsx', { jsx: { runtime: 'classic', pragma: 'createElement' } });
  for (const pathname of ['/merch', '/merch/', '/']) {
    let captures = 0, tree;
    const document = { getElementById: () => ({}) };
    vm.runInNewContext(code, {
      location: { pathname }, document, navigator: {},
      pageForPath, captureInvite: () => { captures++; },
      StrictMode: 'strict', Suspense: 'suspense', UpdateBanner: 'app-update',
      lazy: () => 'lazy-page',
      createElement: (type, props, ...children) => ({ type, props, children }),
      createRoot: () => ({ render: (result) => { tree = result; } }),
    });
    const isApp = pathname === '/';
    assert.equal(captures, isApp ? 1 : 0);
    assert.equal(tree.children.some((child) => child?.type === 'app-update'), isApp);
    assert.equal(document.title, isApp ? 'Baseline' : 'Dot by Baseline — Coming soon');
  }
});
