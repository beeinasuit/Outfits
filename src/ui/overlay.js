// Toasts, bottom sheets and confirm dialogs (native <dialog> for focus trapping + Esc).
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { mascot } from './illustrations.js';

let toastTimer = null;

export function toast(message, { action, onAction, ms = 4200, tone = '' } = {}) {
  const host = document.getElementById('toasts');
  if (!host) return () => {};
  clear(host);
  clearTimeout(toastTimer);
  const close = () => { clearTimeout(toastTimer); clear(host); };
  const t = h('div', { class: `toast ${tone}`, role: 'status' },
    h('span', { class: 'toast-msg' }, message),
    action ? h('button', { class: 'toast-btn', type: 'button', onclick: () => { close(); onAction && onAction(); } }, action) : null,
    h('button', { class: 'toast-x', type: 'button', 'aria-label': 'Dismiss', html: icon('x', { size: 16 }), onclick: close }));
  host.append(t);
  toastTimer = setTimeout(close, ms);
  return close;
}

export function announce(text) {
  const live = document.getElementById('live');
  if (live) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }
}

/** Open a bottom sheet. content: Node. Returns { close, el }. */
export function sheet({ title, content, onClose, wide = false, label }) {
  const dlg = h('dialog', { class: `sheet ${wide ? 'wide' : ''}`, 'aria-label': label || title || 'Dialog' });
  const body = h('div', { class: 'sheet-body' }, content);
  const head = h('div', { class: 'sheet-head' },
    h('span', { class: 'sheet-grab', 'aria-hidden': 'true' }),
    title ? h('h2', { class: 'sheet-title' }, title) : null,
    h('button', { class: 'icon-btn sheet-close', type: 'button', 'aria-label': 'Close', html: icon('x'), onclick: () => close() }));
  dlg.append(head, body);
  let closed = false;
  const opener = document.activeElement;
  const close = (result) => {
    if (closed) return;
    closed = true;
    try { dlg.close(); } catch { /* ignore */ }
    dlg.remove();
    document.documentElement.classList.remove('lock-scroll');
    try { opener && opener.isConnected && opener.focus && opener.focus({ preventScroll: true }); } catch { /* ignore */ }
    onClose && onClose(result);
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  document.documentElement.classList.add('lock-scroll');
  try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); }
  return { close, el: dlg, body };
}

export function confirmDialog({ title, body, confirmText = 'OK', cancelText = 'Cancel', danger = false, typeToConfirm = '', mood = 'wow' }) {
  return new Promise((resolve) => {
    let input = null;
    const ok = h('button', { class: `btn ${danger ? 'btn-tomato' : 'btn-cobalt'}`, type: 'button', disabled: !!typeToConfirm }, confirmText);
    const no = h('button', { class: 'btn btn-ghost', type: 'button' }, cancelText);
    if (typeToConfirm) {
      input = h('input', { class: 'text-input', type: 'text', 'aria-label': `Type ${typeToConfirm} to confirm`, placeholder: typeToConfirm, autocomplete: 'off', autocapitalize: 'characters',
        oninput: () => { ok.disabled = input.value.trim().toUpperCase() !== typeToConfirm; } });
    }
    const content = h('div', { class: 'confirm' },
      h('div', { class: 'confirm-mascot', html: mascot(mood, { size: 84 }) }),
      h('p', { class: 'confirm-body' }, body),
      typeToConfirm ? h('label', { class: 'field' }, h('span', { class: 'field-label' }, `Type ${typeToConfirm} to confirm`), input) : null,
      h('div', { class: 'row gap end' }, no, ok));
    let result = false;
    const s = sheet({ title, content, onClose: () => resolve(result) });
    ok.addEventListener('click', () => { result = true; s.close(); });
    no.addEventListener('click', () => { result = false; s.close(); });
  });
}
