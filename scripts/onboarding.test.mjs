import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformWithOxc } from 'vite';

async function renderComponent(file, name, globals = {}) {
  const source = readFileSync(new URL('../src/pages/' + file, import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from ['"].*?['"];\s*/gm, '')
    .replace(/\bexport default /g, '').replace(/\bexport /g, '');
  const { code } = await transformWithOxc(source, file, { jsx: { runtime: 'classic', pragma: 'createElement', pragmaFrag: 'Fragment' } });
  const slots = [];
  let cursor = 0;
  const context = vm.createContext({
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child != null && child !== false) }),
    Fragment: 'fragment', Brand: 'brand', ThemeToggle: 'theme-toggle', APP_NAME: 'Baseline', auth: {},
    useState: (initial) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
    },
    useRef: (initial) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    ...globals,
  });
  vm.runInContext(code + '\nglobalThis.Component = ' + name + ';', context);
  return (props) => { cursor = 0; return context.Component(props); };
}
const nodes = (tree) => typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [];
const find = (tree, predicate) => nodes(tree).find(predicate);
const checkboxes = (tree) => nodes(tree).filter((node) => node.type === 'input' && node.props.type === 'checkbox');
const visibleText = (tree) => typeof tree === 'string' ? tree : typeof tree === 'object' ? (tree.children ?? []).map(visibleText).join(' ') : '';

test('signup shows an under-18 parental notice without requiring age confirmation', async () => {
  let created = 0;
  const render = await renderComponent('AuthScreen.jsx', 'AuthScreen', {
    pendingInvite: () => 'ABCDEF',
    createUserWithEmailAndPassword: async () => { created++; },
    signInWithEmailAndPassword: async () => {},
    sendPasswordResetEmail: async () => {},
  });
  const tree = render();
  assert.match(visibleText(tree), /under 18, a parent or guardian must read the privacy notice/);
  assert.doesNotMatch(visibleText(tree), /13 or older|under 13|14 or older/);
  assert.equal(checkboxes(tree).length, 0);
  assert.equal(find(tree, (node) => node.props.type === 'submit').props.disabled, false);
  await find(tree, (node) => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(created, 1);
});

test('consented accounts proceed without an age timestamp while unconsented accounts still see the notice', async () => {
  const profile = { role: 'athlete', consentedAt: '2026-10-01T12:00:00Z' };
  const render = await renderComponent('../App.jsx', 'App', {
    useSession: () => ({ authChecked: true, user: { email: 'test@example.invalid' }, profile }),
    teamIdsOf: () => [], TeamSetup: 'team-setup', ConsentScreen: 'consent-screen',
  });
  assert.equal(render().type, 'team-setup');
  profile.ageConfirmedAt = '2026-10-01T12:00:00Z';
  assert.equal(render().type, 'team-setup');
  delete profile.consentedAt;
  assert.equal(render().type, 'consent-screen');
});

test('new profiles require only screening and data consent, with the under-18 parental notice', async () => {
  let confirmations = 0;
  const render = await renderComponent('Privacy.jsx', 'ConsentScreen', {
    recordConsent: async () => { confirmations++; }, logOut: async () => {},
  });
  let tree = render({ profile: {} });
  assert.doesNotMatch(visibleText(tree), /13 or older|under 13/);
  assert.match(visibleText(tree), /under 18, a parent or guardian has read this notice/);
  assert.equal(checkboxes(tree).length, 2);
  checkboxes(tree)[0].props.onChange({ target: { checked: true } });
  tree = render({ profile: {} });
  await find(tree, (node) => node.props.className === 'primary').props.onClick();
  assert.equal(confirmations, 0);
  checkboxes(tree).slice(1).forEach((checkbox) => checkbox.props.onChange({ target: { checked: true } }));
  tree = render({ profile: {} });
  await find(tree, (node) => node.props.className === 'primary').props.onClick();
  assert.equal(confirmations, 1);
});

test('an existing earlier age confirmation needs no replacement and no birth date is collected', async () => {
  const render = await renderComponent('Privacy.jsx', 'ConsentScreen', { recordConsent: async () => {}, logOut: async () => {} });
  const tree = render({ profile: { consentedAt: '2026-10-01T12:00:00Z', ageConfirmedAt: '2026-10-01T12:00:00Z' } });
  assert.equal(checkboxes(tree).length, 0);
  assert.equal(nodes(tree).some((node) => node.type === 'input' && node.props.type === 'date'), false);
});

test('privacy notice describes current storage, access and deletion limits without absolute secrecy promises', async () => {
  const render = await renderComponent('Privacy.jsx', 'PrivacyNotice');
  const tree = render(), text = visibleText(tree);
  for (const phrase of ['under 18', 'parent or guardian', 'Realtime Database', 'durable queue', 'medical history', 'profile photo', 'baseline cutoffs', 'Authorized project administrators', 'legacy database copies', 'administrative backups']) {
    assert.ok(text.includes(phrase), `The notice should explain ${phrase}.`);
  }
  assert.doesNotMatch(text, /Nobody outside your team|never your numbers|14 or older|13 and older|under 13|13–17/);
  assert.ok(find(tree, (node) => node.type === 'a' && node.props.href === 'https://firebase.google.com/support/privacy'));
});
