// SETTINGS: backup/restore, appearance, sample closet, danger zone, about.
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';
import { toast, confirmDialog, sheet } from './overlay.js';
import { data, setSetting, reload, removeDemo, loadDemo, demoCount, realCount } from './data.js';
import * as store from '../store.js';
import { shakeSupported, requestShakePermission } from './fx.js';

export const APP_VERSION = '1.0.0';

export function mount(root, { navigate }) {
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function backup() {
    try {
      const blob = await store.exportBackup();
      download(blob, store.backupFileName());
      await setSetting({ lastBackup: new Date().toISOString() });
      toast(`Backup saved (${Math.max(1, Math.round(blob.size / 1024))} KB). Keep it somewhere safe.`);
    } catch (e) { console.warn(e); toast('Couldn’t make a backup: ' + (e.message || e), { tone: 'warn' }); }
  }

  const fileInput = h('input', { class: 'sr-only-input', type: 'file', accept: 'application/json,.json', 'aria-label': 'Choose a backup file', tabindex: '-1', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) restore(f); } });

  async function restore(file) {
    let text;
    try { text = await file.text(); store.parseBackup(text); } catch (e) { toast(e.message || 'That backup can’t be read.', { tone: 'warn', ms: 7000 }); return; }
    const b = store.parseBackup(text);
    const content = h('div', { class: 'confirm' },
      h('div', { class: 'confirm-mascot', html: mascot('wow', { size: 84 }) }),
      h('p', { class: 'confirm-body' }, `Found ${b.items.length} item${b.items.length === 1 ? '' : 's'} and ${Object.keys(b.photos).length} photo${Object.keys(b.photos).length === 1 ? '' : 's'}${b.skipped ? ` (${b.skipped} unreadable skipped)` : ''}. How should I bring them in?`),
      h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => run('merge') }, 'Merge into my closet'),
      h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: () => run('replace') }, 'Replace everything'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => s.close() }, 'Cancel'));
    const s = sheet({ title: 'Restore backup', content });
    async function run(how) {
      if (how === 'replace') {
        s.close();
        const ok = await confirmDialog({ title: 'Replace everything?', body: 'Your current closet, photos and feedback will be wiped and replaced by the backup.', confirmText: 'Yes, replace', danger: true });
        if (!ok) return;
      } else s.close();
      try { const r = await store.importBackup(text, { mode: how }); await reload(); toast(`Restored ${r.items} item${r.items === 1 ? '' : 's'}${r.photos ? ` and ${r.photos} photo${r.photos === 1 ? '' : 's'}` : ''}.`); }
      catch (e) { toast(e.message || 'Restore failed.', { tone: 'warn', ms: 7000 }); }
    }
  }

  async function clearEverything() {
    const ok = await confirmDialog({ title: 'Wipe everything?', body: 'This permanently deletes every item, photo and bit of feedback on this device. There is no undo. Make a backup first if you might want any of it back.', confirmText: 'Delete it all', danger: true, typeToConfirm: 'DELETE', mood: 'sad' });
    if (!ok) return;
    await store.clearAll();
    await store.putSettings({ onboarded: true });
    await reload();
    toast('All clean. A fresh start.');
  }

  function render() {
    clear(root);
    const s = data.settings;
    const info = store.storageInfo();
    const last = s.lastBackup ? new Date(s.lastBackup).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'never';
    const real = realCount();
    const seg = (key, opts) => h('div', { class: 'chips', role: 'group' }, opts.map(([v, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String((s[key] || opts[0][0]) === v), onclick: () => setSetting({ [key]: v }) }, l)));
    const toggle = (key, label, hint, on, fn) => h('button', { class: 'toggle-row', type: 'button', role: 'switch', 'aria-checked': String(on), onclick: fn },
      h('span', { class: 'toggle-text' }, h('b', {}, label), h('small', {}, hint)), h('span', { class: 'switch' + (on ? ' on' : ''), 'aria-hidden': 'true' }, h('i'), h('em', {}, on ? 'On' : 'Off')));

    root.append(
      h('h1', { class: 'sr-only', tabindex: '-1', id: 'screen-title' }, 'Settings'),
      h('div', { class: 'page-head' }, h('h2', { class: 'page-title' }, 'Settings')),
      !info.persistent ? h('section', { class: 'set-card warn' }, h('h2', {}, h('span', { html: icon('alert') }), 'Not saving'), h('p', {}, 'This browser is blocking storage (private mode?), so your closet will vanish when you close the tab. Open the app in a normal window to keep your clothes.')) : null,
      h('section', { class: 'set-card' }, h('h2', {}, h('span', { html: icon('download') }), 'Back up'),
        h('p', {}, `${real} item${real === 1 ? '' : 's'} in your closet. Last backup: ${last}.`),
        h('button', { class: 'btn btn-cobalt', type: 'button', onclick: backup, html: `${icon('download', { size: 20 })} Download backup` }),
        h('p', {}, 'Saves everything, photos included, as one file named fit-machine-backup-YYYY-MM-DD.json.')),
      h('section', { class: 'set-card' }, h('h2', {}, h('span', { html: icon('upload') }), 'Restore'),
        h('p', {}, 'Bring a backup file back. You can merge it into what’s here or replace everything.'),
        h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click(), html: `${icon('upload', { size: 20 })} Choose backup file` }), fileInput),
      h('section', { class: 'set-card warn' }, h('h2', {}, h('span', { html: icon('info') }), 'Heads up for iPhone'),
        h('p', {}, 'Everything lives on this device only. iOS can clear a home-screen app’s data if you don’t open it for a few weeks. Back up now and then, especially after adding a bunch of clothes.')),
      h('section', { class: 'set-card' }, h('h2', {}, h('span', { html: icon('sparkle') }), 'Look & feel'),
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Theme'), seg('theme', [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']])),
        toggle('haptics', 'Haptics', 'Little buzzes on thunks and stamps', s.haptics !== false, () => setSetting({ haptics: !(s.haptics !== false) }).then(render)),
        shakeSupported() ? toggle('shake', 'Shake to spin', 'Shake your phone for a new outfit', !!s.shake, async () => {
          const on = !s.shake;
          if (on && !(await requestShakePermission())) { toast('Motion access was declined.'); return; }
          await setSetting({ shake: on }); render();
        }) : null),
      h('section', { class: 'set-card' }, h('h2', {}, h('span', { html: icon('hanger') }), 'Sample closet'),
        h('p', {}, demoCount() ? `${demoCount()} sample pieces are in your closet. They’re fake. Remove them any time.` : 'Load about 20 sample pieces to play with the machine.'),
        demoCount() ? h('button', { class: 'btn', type: 'button', onclick: async () => { const k = await removeDemo(); toast(`Removed ${k} sample items.`); } }, 'Remove sample items')
          : h('button', { class: 'btn', type: 'button', onclick: async () => { await loadDemo(); toast('Sample closet loaded.'); } }, 'Load sample closet'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await setSetting({ onboarded: false }); location.reload(); } }, 'Replay the intro')),
      h('section', { class: 'set-card danger' }, h('h2', {}, h('span', { html: icon('trash') }), 'Danger zone'),
        h('p', {}, 'Delete every item, photo and rating from this device.'),
        h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: clearEverything }, 'Clear all data')),
      h('section', { class: 'set-card' }, h('h2', {}, h('span', { html: icon('info') }), 'About'),
        h('div', { class: 'kv' }, h('span', {}, 'Fit Machine'), h('span', {}, `v${APP_VERSION}`)),
        h('div', { class: 'kv' }, h('span', {}, 'Storage'), h('span', {}, info.persistent ? 'On this device (IndexedDB)' : 'Memory only')),
        h('p', {}, 'Your clothes, your phone, no account, no server. Photos are analysed right here and never uploaded.')));
  }

  render();
  return { update(what) { if (what === 'settings' || what === 'items') render(); } };
}
