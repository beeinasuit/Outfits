// Occasion picker: horizontally scrollable emoji chips for built-in + custom occasions, plus "+ Custom".
//
//   occasionPicker({ value, onChange }) -> HTMLElement
//     value     current occasion key (e.g. 'work')
//     onChange  (key) => void   called when the user picks a chip, creates a custom occasion (it is selected) or deletes
//               the selected one (falls back to 'any')
//   Element extras:  el.set(key)  update the highlighted chip without firing onChange;  el.refresh()  rebuild chips
//   (call refresh() after settings change elsewhere; the picker also rebuilds itself after its own edits).
//
// Custom occasions live in settings.customOccasions ({ [key]: occasion }), shaped by makeOccasion().
// Long-press (or right-click / Shift+Enter) a custom chip to edit or delete it; the selected custom chip also gets an
// "Edit" chip next to it so keyboard users have a path too.
import { FORMALITY, OCCASIONS, makeOccasion } from '../model.js';
import { h } from './dom.js';
import { sheet, confirmDialog, toast } from './overlay.js';
import { allOccasions, setSetting, data } from './data.js';
import { buzz } from './fx.js';

const EMOJI = ['🎬', '🎓', '🍽️', '🏋️', '🎸', '🏖️', '⛷️', '🎂', '🧳', '🐶', '☕', '🎨', '📚', '🏕️', '💃', '🛍️'];

const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'mine';

export function occasionPicker({ value = 'any', onChange = () => {} } = {}) {
  let current = value;
  const wrap = h('div', { class: 'occ-picker' });
  const row = h('div', { class: 'chips scroll occ-row', role: 'group', 'aria-label': 'What are you dressing for?' });
  wrap.append(row);

  function build() {
    row.replaceChildren();
    const all = allOccasions();
    if (!all[current]) current = 'any';
    for (const [key, occ] of Object.entries(all)) {
      const custom = !!occ.custom && !OCCASIONS[key];
      const chip = h('button', { class: `chip occ-chip${custom ? ' custom' : ''}`, type: 'button', 'data-key': key, 'aria-pressed': String(key === current),
        title: custom ? `${occ.label} (long-press to edit)` : occ.label,
        onclick: (e) => { if (chip.__long) { chip.__long = false; e.preventDefault(); return; } select(key); } },
      h('span', { class: 'occ-emoji', 'aria-hidden': 'true' }, occ.emoji), h('span', {}, occ.label));
      if (custom) {
        let timer = null;
        const cancel = () => { clearTimeout(timer); timer = null; };
        chip.addEventListener('pointerdown', () => { cancel(); timer = setTimeout(() => { chip.__long = true; buzz(20); manage(key); }, 520); });
        ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((t) => chip.addEventListener(t, t === 'pointermove' ? () => {} : cancel));
        chip.addEventListener('contextmenu', (e) => { e.preventDefault(); manage(key); });
        chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); manage(key); } });
      }
      row.append(chip);
    }
    if (all[current] && all[current].custom && !OCCASIONS[current]) {
      row.append(h('button', { class: 'chip occ-chip occ-edit', type: 'button', 'aria-label': `Edit ${all[current].label}`, onclick: () => manage(current) }, '✎ Edit'));
    }
    row.append(h('button', { class: 'chip occ-chip occ-add', type: 'button', onclick: () => editor(null) }, h('span', { class: 'occ-emoji', 'aria-hidden': 'true' }, '＋'), h('span', {}, 'Custom')));
  }

  function select(key) {
    current = key;
    for (const c of row.querySelectorAll('.occ-chip[data-key]')) c.setAttribute('aria-pressed', String(c.dataset.key === key));
    build();
    const sel = row.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (sel && sel.scrollIntoView) { try { sel.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch { /* ignore */ } }
    onChange(key);
  }

  function manage(key) {
    const occ = allOccasions()[key];
    if (!occ) return;
    const s = sheet({
      title: `${occ.emoji} ${occ.label}`,
      content: h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-cobalt', type: 'button', onclick: () => { s.close(); editor(key); } }, 'Edit this occasion'),
        h('button', { class: 'btn btn-danger-ghost', type: 'button', onclick: async () => {
          s.close();
          const ok = await confirmDialog({ title: 'Delete occasion?', body: `“${occ.label}” will disappear from the picker. Your clothes stay put.`, confirmText: 'Delete', danger: true, mood: 'sad' });
          if (!ok) return;
          const next = { ...(data.settings.customOccasions || {}) };
          delete next[key];
          await setSetting({ customOccasions: next });
          const was = current === key;
          if (was) current = 'any';
          build();
          if (was) onChange('any');
          toast('Occasion deleted.');
        } }, 'Delete')),
    });
  }

  function editor(key) {
    const existing = key ? allOccasions()[key] : null;
    let emoji = existing ? existing.emoji : '🎬';
    let min = existing ? existing.min : 2, max = existing ? existing.max : 3;
    const label = h('input', { class: 'text-input', type: 'text', maxlength: '30', placeholder: 'e.g. Gallery opening', value: existing ? existing.label : '', 'aria-label': 'Occasion name', autocomplete: 'off' });
    const emojiIn = h('input', { class: 'text-input occ-emoji-in', type: 'text', maxlength: '4', value: emoji, 'aria-label': 'Emoji', oninput: () => { emoji = emojiIn.value.trim() || '📍'; } });
    const picks = h('div', { class: 'occ-emoji-row' }, EMOJI.map((e) => h('button', { class: 'occ-emoji-pick', type: 'button', 'aria-label': `Use ${e}`, onclick: () => { emoji = e; emojiIn.value = e; } }, e)));
    const seg = (name, get, set) => {
      const g = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': name });
      const paint = () => { for (const b of g.children) b.setAttribute('aria-checked', String(Number(b.dataset.v) === get())); };
      for (let v = 1; v <= 5; v++) g.append(h('button', { class: 'seg-btn', type: 'button', role: 'radio', 'data-v': v, title: FORMALITY[v], onclick: () => { set(v); paint(); desc(); } }, h('b', {}, v), h('small', {}, FORMALITY[v])));
      paint();
      return g;
    };
    const descEl = h('p', { class: 'hint', 'aria-live': 'polite' });
    const desc = () => { descEl.textContent = min === max ? `Dress level: ${FORMALITY[min]}.` : `Anything from ${FORMALITY[min].toLowerCase()} to ${FORMALITY[max].toLowerCase()}.`; };
    const segMin = seg('Least dressy', () => min, (v) => { min = v; if (max < v) { max = v; segMax.refresh(); } });
    const segMax = seg('Most dressy', () => max, (v) => { max = v; if (min > v) { min = v; segMin.refresh(); } });
    segMin.refresh = () => { for (const b of segMin.children) b.setAttribute('aria-checked', String(Number(b.dataset.v) === min)); };
    segMax.refresh = () => { for (const b of segMax.children) b.setAttribute('aria-checked', String(Number(b.dataset.v) === max)); };
    desc();
    const err = h('p', { class: 'hint occ-err', role: 'alert', hidden: true }, 'Give it a name first.');
    const save = h('button', { class: 'btn btn-tomato', type: 'button', onclick: async () => {
      const name = label.value.trim();
      if (!name) { err.hidden = false; label.focus(); return; }
      const customs = { ...(data.settings.customOccasions || {}) };
      let k = key;
      if (!k) { const base = `my-${slug(name)}`; k = base; let n = 2; while (customs[k] || OCCASIONS[k]) k = `${base}-${n++}`; }
      customs[k] = makeOccasion({ ...(existing || {}), label: name, emoji: emojiIn.value.trim() || emoji, min, max });
      await setSetting({ customOccasions: customs });
      s.close();
      current = k;
      build();
      onChange(k);
      toast(key ? 'Occasion updated.' : `${customs[k].emoji} ${customs[k].label} added.`);
    } }, existing ? 'Save changes' : 'Add occasion');
    const content = h('div', { class: 'occ-editor' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), label), err,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Emoji'), h('div', { class: 'row gap' }, emojiIn, picks)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Least dressy'), segMin),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Most dressy'), segMax),
      descEl,
      h('div', { class: 'sheet-actions' }, save));
    const s = sheet({ title: existing ? 'Edit occasion' : 'New occasion', content });
    setTimeout(() => label.focus(), 60);
  }

  wrap.set = (key) => { current = key; build(); };
  wrap.refresh = () => build();
  build();
  return wrap;
}
