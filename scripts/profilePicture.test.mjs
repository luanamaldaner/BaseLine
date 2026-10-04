import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transformWithOxc } from 'vite';

const source = readFileSync(new URL('../src/components/ProfilePicture.jsx', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"].*?['"];\s*/gm, '').replace('export default ', '');
const { code } = await transformWithOxc(source, 'ProfilePicture.jsx', { jsx: { runtime: 'classic', pragma: 'createElement', pragmaFrag: 'Fragment' } });
const nodes = (tree) => typeof tree === 'object' ? [tree, ...(tree.children ?? []).flatMap(nodes)] : [];
const find = (tree, match) => nodes(tree).find(match);
const button = (tree, text) => find(tree, (node) => node.type === 'button' && node.children.includes(text));
const dot = (tree, name) => find(tree, (node) => node.props['aria-label'] === name + ' Dot');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const plain = (value) => JSON.parse(JSON.stringify(value));

function setup({ onSave = async () => {}, current = { kind: 'dot', dot: 'yellow' } } = {}) {
  const session = { user: { uid: 'me' }, profile: { name: 'Test User' }, avatars: new Map([['me', current]]) };
  const slots = [], effects = [];
  let cursor = 0, closed = 0, escape;
  const props = { onSave, onClose: () => { closed++; } };
  const context = vm.createContext({
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child != null && child !== false) }),
    createPortal: (tree) => tree, Fragment: 'fragment',
    Avatar: 'avatar', DotEmoji: 'dot-image', CloseIcon: 'close-icon',
    DOT_PRESETS: Object.fromEntries(['yellow', 'green', 'blue', 'pink', 'purple', 'red'].map((id) => [id, { label: id[0].toUpperCase() + id.slice(1) }])),
    presetId: (id) => ({ mint: 'green', sunny: 'yellow' }[id] ?? id),
    useSession: () => session, saveAvatar: onSave, describeError: (error) => error.message,
    useState: (initial) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (value) => { slots[i] = value; }]; },
    useRef: (initial) => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect: (effect) => { const i = cursor++; if (!(i in slots)) { slots[i] = true; effects.push(effect()); } },
    useModalDialog: (_, onClose) => { escape = onClose; },
    document: { body: {}, createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,preview' }) },
    URL: { createObjectURL: () => 'blob:local-photo', revokeObjectURL() {} },
    Image: class { constructor() { this.naturalWidth = 500; this.naturalHeight = 300; } set src(_) { queueMicrotask(() => this.onload()); } },
  });
  vm.runInContext(code + '\nglobalThis.Component = ProfilePicture;', context);
  return {
    render: () => { cursor = 0; return context.Component(props); },
    escape: () => escape(), get closed() { return closed; }, session,
    unmount: () => effects.forEach((cleanup) => cleanup?.()),
  };
}

test('Dot and initials choices preview locally; Cancel, Escape and backdrop never save', () => {
  for (const dismissal of ['cancel', 'escape', 'backdrop']) {
    let saves = 0;
    const h = setup({ onSave: async () => { saves++; } });
    let tree = h.render();
    assert.equal(button(tree, 'Save picture').props.disabled, true);
    dot(tree, 'Red').props.onClick();
    tree = h.render();
    assert.equal(dot(tree, 'Red').props['aria-pressed'], true);
    assert.equal(find(tree, (node) => node.type === 'dot-image' && node.props.size === 96).props.preset, 'red');
    assert.equal(h.session.avatars.get('me').dot, 'yellow');
    button(tree, 'Use my initials').props.onClick();
    tree = h.render();
    assert.ok(find(tree, (node) => node.type === 'avatar' && node.props.uid === undefined));
    if (dismissal === 'cancel') button(tree, 'Cancel').props.onClick();
    else if (dismissal === 'escape') h.escape();
    else { const target = {}; tree.props.onMouseDown({ target, currentTarget: target }); }
    assert.equal(saves, 0);
    assert.equal(h.closed, 1);
    h.unmount();
  }
});

test('Save sends one selected draft, disables changes and dismissal, and waits for acknowledgement', async () => {
  const pending = deferred(), saves = [];
  const h = setup({ onSave: (draft) => { saves.push(draft); return pending.promise; } });
  let tree = h.render();
  dot(tree, 'Blue').props.onClick();
  tree = h.render();
  const save = button(tree, 'Save picture').props.onClick;
  const waiting = save();
  await save();
  tree = h.render();
  assert.equal(saves.length, 1);
  assert.deepEqual(plain(saves[0]), { kind: 'dot', dot: 'blue' });
  assert.equal(button(tree, 'Saving…').props.disabled, true);
  assert.equal(button(tree, 'Cancel').props.disabled, true);
  assert.equal(dot(tree, 'Red').props.disabled, true);
  dot(tree, 'Red').props.onClick();
  button(tree, 'Cancel').props.onClick();
  h.escape();
  const target = {}; tree.props.onMouseDown({ target, currentTarget: target });
  assert.equal(h.closed, 0);
  assert.equal(dot(h.render(), 'Blue').props['aria-pressed'], true);
  pending.resolve();
  await waiting;
  assert.equal(h.closed, 1);
  h.unmount();
});

test('a failed save keeps the same draft for an explicit retry', async () => {
  const saves = [];
  const h = setup({ onSave: async (draft) => { saves.push(draft); if (saves.length === 1) throw new Error('Connection failed'); } });
  let tree = h.render();
  dot(tree, 'Green').props.onClick();
  tree = h.render();
  await button(tree, 'Save picture').props.onClick();
  tree = h.render();
  assert.equal(h.closed, 0);
  assert.equal(dot(tree, 'Green').props['aria-pressed'], true);
  assert.ok(find(tree, (node) => node.props.role === 'alert'));
  await button(tree, 'Retry save').props.onClick();
  assert.equal(saves.length, 2);
  assert.deepEqual(plain(saves[0]), plain(saves[1]));
  assert.equal(h.closed, 1);
  h.unmount();
});

test('photo preparation stays local and only Save uploads the resized draft', async () => {
  const saves = [];
  const h = setup({ onSave: async (draft) => saves.push(draft) });
  let tree = h.render();
  const input = find(tree, (node) => node.props.type === 'file');
  await input.props.onChange({ target: { files: [{ name: 'portrait.png' }], value: 'portrait.png' } });
  tree = h.render();
  assert.equal(saves.length, 0);
  assert.equal(find(tree, (node) => node.type === 'img').props.src, 'data:image/jpeg;base64,preview');
  await button(tree, 'Save picture').props.onClick();
  assert.deepEqual(plain(saves[0]), { kind: 'photo', photo: 'data:image/jpeg;base64,preview' });
  h.unmount();
});
