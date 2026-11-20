// Juice: haptics, confetti, count-up, shake detection, score verdicts.
import { rand, pick } from './dom.js';

export const prefs = { haptics: true };
export const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

export function buzz(pattern = 10) {
  if (!prefs.haptics) return;
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* ignore */ }
}

export function verdict(score) {
  if (score >= 90) return { label: 'CERTIFIED FIT', short: 'Certified fit', tone: 'mint', confetti: true };
  if (score >= 75) return { label: 'LOOKING SHARP', short: 'Looking sharp', tone: 'cobalt' };
  if (score >= 60) return { label: 'SOLID', short: 'Solid', tone: 'sun' };
  if (score >= 45) return { label: 'BOLD MOVE', short: 'Bold move', tone: 'tomato' };
  return { label: 'HMM…', short: 'Hmm', tone: 'gray' };
}

const CONFETTI_COLORS = ['#ff5a3c', '#2f4bff', '#ffc933', '#3fd6a0', '#ff8fb1', '#fffaf0'];

export function confetti(x, y, n = 40) {
  if (reduced()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  document.body.append(layer);
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    const w = rand(6, 11);
    p.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${rand(5, 14)}px;background:${pick(CONFETTI_COLORS)};border-radius:${Math.random() < 0.3 ? '50%' : '2px'}`;
    layer.append(p);
    const dx = rand(-170, 170), up = rand(90, 240), fall = rand(40, 260), rot = rand(-720, 720);
    p.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${dx * 0.6}px,${-up}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px,${fall}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: rand(900, 1500), easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' });
  }
  setTimeout(() => layer.remove(), 1700);
}

export function countUp(el, to, ms = 700, from = 0) {
  if (reduced()) { el.textContent = String(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = String(to);
  };
  requestAnimationFrame(step);
}

/** Shake detection via DeviceMotion. Returns a stop() function. */
export function startShake(cb) {
  let last = 0, lx = 0, ly = 0, lz = 0, first = true;
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const d = first ? 0 : Math.abs(a.x - lx) + Math.abs(a.y - ly) + Math.abs(a.z - lz);
    first = false; lx = a.x; ly = a.y; lz = a.z;
    const now = Date.now();
    if (d > 32 && now - last > 1300) { last = now; cb(); }
  };
  window.addEventListener('devicemotion', onMotion);
  return () => window.removeEventListener('devicemotion', onMotion);
}

export function shakeSupported() { return typeof DeviceMotionEvent !== 'undefined'; }
export function shakeNeedsPermission() { return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function'; }
export async function requestShakePermission() {
  if (!shakeNeedsPermission()) return true;
  try { return (await DeviceMotionEvent.requestPermission()) === 'granted'; } catch { return false; }
}
