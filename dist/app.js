// Page logic. No imports here on purpose: sound, countdown and the presave
// button keep working even if WebGL or the 3D module fails to load.

const RELEASE = Date.parse('2026-10-02T00:00:00+03:00');
const PRESAVE = 'https://band.link/startend';
const METRIKA_ID = 0; // Яндекс Метрика: put the counter id here to count sound_on / presave_click / share
const SHARE_TEXT = 'мозг мухи подключили к пресейву.';

const $ = s => document.querySelector(s);
const app = $('#app'), world = $('#world'), audio = $('#audio');
const soundBtn = $('#sound'), soundIcon = $('#sound-icon'), soundText = $('#sound-text');
const cta = $('#cta'), ctaText = $('#cta-text'), ctaSub = $('#cta-sub');
const logEl = $('#log'), timeEl = $('#neural-time'), spikesEl = $('#spikes'), titleEl = $('#neural-title');
const peekBtn = $('#peek'), lostLine = $('#lost-line');
const Q = new URLSearchParams(location.search);
const UA = navigator.userAgent;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const store = {
  get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch { /* private mode */ } },
};

// Shared state read by the scene every frame.
const S = window.__fly = {
  state: 'idle', live: false, t: 0, dur: 16.3, cut: 14.1, bpm: 125,
  env: { low: 0, mid: 0, high: 0 }, fire: new Uint8Array(96),
  // ?replays=N fixes the attempt number (the gap shrinks with it) for recording clips.
  replays: Q.has('replays') ? Number(Q.get('replays')) || 0 : Number(store.get('replays')) || 0,
  peek: false, safe: { top: 0, bottom: innerHeight },
  reduced, rec: Q.has('rec'), poster: Q.has('poster'), mobile: innerWidth < 801,
  countdownShort: '',
};
if (S.rec) app.dataset.rec = '';
if (Q.has('mute')) audio.muted = true; // for testing
if (S.poster) app.dataset.poster = '';

/* ---------------------------------------------------------------- links */

const inApp = /Instagram|FBAN|FBAV|musical_ly|Bytedance|TikTok|VKAndroidApp|vkclient|Telegram|; wv\)/i.test(UA);
const android = /Android/i.test(UA), ios = /iPhone|iPad|iPod/i.test(UA);

function source() {
  if (Q.get('utm_source')) return Q.get('utm_source');
  if (/Instagram/i.test(UA)) return 'instagram';
  if (/musical_ly|Bytedance|TikTok/i.test(UA)) return 'tiktok';
  if (/VKAndroidApp|vkclient/i.test(UA)) return 'vk';
  if (/Telegram/i.test(UA)) return 'telegram';
  try { if (document.referrer) return new URL(document.referrer).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  return 'direct';
}
const presaveUrl = (() => {
  const u = new URL(PRESAVE);
  u.searchParams.set('utm_source', source());
  u.searchParams.set('utm_medium', Q.get('utm_medium') || 'fly_site');
  u.searchParams.set('utm_campaign', Q.get('utm_campaign') || 'nachalo_konca');
  if (Q.get('utm_content')) u.searchParams.set('utm_content', Q.get('utm_content'));
  return u.href;
})();
cta.href = presaveUrl;
// New tab only on desktop; in-app webviews often ignore _blank or open a blank view.
if (!inApp && matchMedia('(pointer: fine)').matches) cta.target = '_blank';

if (inApp) {
  const hint = $('#inapp');
  if (android) {
    const intent = 'intent://' + presaveUrl.replace(/^https:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=' + encodeURIComponent(presaveUrl) + ';end';
    hint.innerHTML = 'пресейв просит войти? <a href="' + intent + '">открой в chrome</a>';
  } else {
    hint.textContent = ios ? 'пресейв просит войти? ⋯ → «открыть в браузере»' : 'пресейв просит войти? открой страницу в браузере';
  }
  hint.hidden = false;
}

/* ---------------------------------------------------------------- countdown */

const pad = n => String(n).padStart(2, '0');
function tick() {
  const ms = RELEASE - Date.now();
  if (ms <= 0 || Q.get('state') === 'live') return goLive();
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
  const clock = `${pad(h)}:${pad(m)}:${pad(s)}`;
  $('#countdown').textContent = d ? `${d} д ${clock}` : clock;
  S.countdownShort = d ? `${d}д ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  setTimeout(tick, 1000 - (Date.now() % 1000) + 10);
}
function goLive() {
  S.live = true;
  app.dataset.live = '';
  $('#release-label').textContent = 'конец начался';
  $('#countdown').textContent = '02.10.2026';
  $('#release-date').textContent = 'на всех площадках';
  ctaText.textContent = 'слушать';
  ctaSub.textContent = 'яндекс музыка, vk музыка, звук и другие';
  document.title = 'начало конца — аноматвер, полина рыженко · слушать';
  render();
}
tick();

/* ---------------------------------------------------------------- audio */

let env = null, userPaused = false, resumeLater = false;
fetch(new URL('./assets/replay.json', import.meta.url)).then(r => r.json()).then(j => { env = j; S.dur = j.duration; S.cut = j.cut || j.duration; S.bpm = j.bpm; }).catch(() => {});

if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'начало конца (отрывок)', artist: 'аноматвер, полина рыженко',
      artwork: [{ src: new URL('./assets/cover.jpeg', import.meta.url).href, sizes: '1120x1120', type: 'image/jpeg' }],
    });
  } catch { /* old webviews */ }
}

function play(explicit) {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
  if (audio.ended || S.state === 'lost') audio.currentTime = 0;
  userPaused = false;
  const p = audio.play();
  if (p && p.catch) p.catch(() => { if (explicit) showToast($('#audio-error')); });
}
function pause() { userPaused = true; audio.pause(); }

soundBtn.addEventListener('click', () => { if (audio.paused) play(true); else pause(); });

// Browsers only allow sound after a tap. Try anyway (some webviews allow it),
// then start on the first tap or key press anywhere on the page.
const gate = $('#gate');
function showGate() { if (S.state === 'idle' && !S.rec && !S.poster) { gate.hidden = false; placeGate(); } }
function placeGate() { app.style.setProperty('--gate-y', Math.round(S.safe.bottom - (S.mobile ? 28 : 44)) + 'px'); }
gate.addEventListener('click', e => { e.stopPropagation(); play(true); });
function firstTouch(e) {
  if (e.type === 'pointerdown' && e.pointerType !== 'mouse') return; // touch activates on pointerup
  if (e.target.closest('a, #sound, #peek, #share, #gate')) return;
  if (audio.paused && !userPaused && S.state === 'idle') play(false);
}
['pointerdown', 'pointerup', 'keydown'].forEach(t => document.addEventListener(t, firstTouch, { capture: true }));
if (!S.poster && !S.rec && !store.get('ps', true) && (Q.get('state') || 'idle') === 'idle') {
  const p = audio.play();
  if (p && p.catch) p.catch(showGate); else showGate();
}
audio.addEventListener('play', () => { gate.hidden = true; setState('playing'); goal('sound_on'); });
audio.addEventListener('pause', () => { if (!audio.ended) setState(S.state === 'pressed' ? 'pressed' : 'paused'); });
audio.addEventListener('ended', () => {
  S.replays++; store.set('replays', S.replays);
  setState('lost');
  S.glitch?.(1);
});
audio.addEventListener('error', () => { if (S.state === 'playing') setState('idle'); });

// A tap on the scene starts the replay; a tap on the fly's head dives inside.
S.onTap = ({ head }) => {
  if (head) togglePeek(true);
  if (audio.paused && !userPaused && (S.state === 'idle' || S.state === 'paused' || head)) play(false);
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (!audio.paused) { resumeLater = true; audio.pause(); } }
  else { if (resumeLater && !userPaused && S.state !== 'pressed') play(false); resumeLater = false; checkReturn(); }
});
addEventListener('pageshow', e => { if (e.persisted) { render(); checkReturn(); } });

/* ---------------------------------------------------------------- presave click */

cta.addEventListener('click', () => {
  goal('presave_click');
  store.set('ps', '1', true);
  resumeLater = false;
  if (!audio.paused) { userPaused = true; audio.pause(); }
  setState('pressed');
});
function checkReturn() { if (store.get('ps', true) && S.state !== 'pressed' && S.state !== 'playing') setState('pressed'); }

/* ---------------------------------------------------------------- state & labels */

const ICONS = {
  '▶': '<svg class="ico" viewBox="0 0 8 7"><path d="M0 0h2v1h-2zM0 1h4v1h-4zM0 2h6v1h-6zM0 3h8v1h-8zM0 4h6v1h-6zM0 5h4v1h-4zM0 6h2v1h-2z"/></svg>',
  '❚❚': '<svg class="ico" viewBox="0 0 8 7"><path d="M0 0h3v1h-3zM5 0h3v1h-3zM0 1h3v1h-3zM5 1h3v1h-3zM0 2h3v1h-3zM5 2h3v1h-3zM0 3h3v1h-3zM5 3h3v1h-3zM0 4h3v1h-3zM5 4h3v1h-3zM0 5h3v1h-3zM5 5h3v1h-3zM0 6h3v1h-3zM5 6h3v1h-3z"/></svg>',
  '↻': '<svg class="ico" viewBox="0 0 8 7"><path d="M2 0h3v1h-3zM6 0h1v1h-1zM1 1h1v1h-1zM5 1h2v1h-2zM0 2h1v1h-1zM4 2h3v1h-3zM0 3h1v1h-1zM0 4h1v1h-1zM6 4h1v1h-1zM1 5h1v1h-1zM5 5h1v1h-1zM2 6h3v1h-3z"/></svg>',
};
const LOG = {
  idle: 'IDLE / GROOMING',
  paused: 'REPLAY / HOLD',
  lost: 'MOTOR_06 / NO CONTACT',
  pressed: 'PRESAVE / EXTERNAL INPUT',
};
function setState(st) {
  const was = S.state;
  S.state = st;
  app.dataset.state = st;
  render();
  if (st === 'lost' && was !== 'lost') glitchLine();
  S.onLayout?.();
}
// The title card glitches in on the cut (once per SIGNAL LOST).
let glitchTimer;
function glitchLine() {
  if (reduced) return;
  lostLine.classList.remove('glitch');
  void lostLine.offsetWidth;
  lostLine.classList.add('glitch');
  clearTimeout(glitchTimer);
  glitchTimer = setTimeout(() => lostLine.classList.remove('glitch'), 1000);
}
function render() {
  const st = S.state;
  const labels = {
    idle: ['▶', 'запустить реплей', 'запустить реплей со звуком'],
    playing: ['❚❚', 'пауза', 'пауза'],
    paused: ['▶', 'продолжить', 'продолжить реплей'],
    lost: ['↻', 'ещё попытка', 'ещё попытка'],
    pressed: ['↻', 'ещё попытка', 'ещё попытка'],
  }[st];
  soundIcon.innerHTML = ICONS[labels[0]] || labels[0]; soundBtn.setAttribute('aria-label', labels[2]);
  // Phones: short label, so the presave button keeps its one line.
  soundText.textContent = innerWidth < 801 ? (st === 'idle' ? 'реплей' : '') : labels[1];
  const line = st === 'pressed'
    ? (S.live ? 'готово.\nмуха слушает.' : 'готово.\nмуха потирает лапки.')
    : (S.live ? 'муха не дотянулась.\nвключи за неё.' : 'муха не дотянулась.\nнажми пресейв за неё.');
  if (lostLine.textContent !== line) { lostLine.textContent = line; lostLine.dataset.text = line; }
  titleEl.textContent = S.peek ? 'INSIDE / 96 CELLS' : st === 'lost' ? 'SIGNAL LOST' : 'NEURAL REPLAY';
  if (!S.peek) logEl.textContent = S.live && st !== 'playing' ? 'RELEASE / LIVE' : LOG[st] || logEl.textContent;
  if (st === 'lost') { spikesEl.textContent = '0.00M'; }
}
setState(['lost', 'pressed', 'paused'].includes(Q.get('state')) ? Q.get('state') : 'idle');
if (S.poster) setState('lost');
checkReturn();

/* ---------------------------------------------------------------- inside the head */

function togglePeek(on = !S.peek) {
  S.peek = on;
  if (on) app.dataset.peek = ''; else delete app.dataset.peek;
  peekBtn.textContent = on ? 'выйти из головы' : 'заглянуть в голову';
  logEl.textContent = on ? '…' : '';
  render();
  S.setPeek?.(on);
  S.onLayout?.();
}
peekBtn.addEventListener('click', () => { togglePeek(); if (S.peek && audio.paused && !userPaused && S.state === 'idle') play(false); });
S.onThought = text => { if (S.peek) logEl.textContent = text; };

/* ---------------------------------------------------------------- HUD */

const brain = $('#neural'), bc = brain.getContext('2d');
const BW = brain.width, BH = brain.height, ROWS = 96, TOP = BH - ROWS;
bc.fillStyle = '#050a1a'; bc.fillRect(0, 0, BW, BH);
const tune = Array.from({ length: ROWS }, (_, i) => ({ band: i < 26 ? 'high' : i < 62 ? 'mid' : 'low', base: .004 + ((i * 37) % 11) / 1100, gain: .12 + ((i * 53) % 13) / 40 }));

function sample(t) {
  if (!env) return { low: 0, mid: 0, high: 0 };
  const i = Math.min(env.low.length - 1, Math.max(0, Math.floor(t * env.fps)));
  return { low: env.low[i] / 255, mid: env.mid[i] / 255, high: env.high[i] / 255 };
}

let hudLast = 0, spikesShown = .4;
function hud(now) {
  requestAnimationFrame(hud);
  if (now - hudLast < 33) return;
  hudLast = now;
  const st = S.state, playing = st === 'playing';
  S.t = st === 'idle' ? 0 : audio.currentTime || 0;
  const e = playing ? sample(S.t) : { low: 0, mid: 0, high: 0 };
  S.env = e;
  const energy = .5 * e.low + .3 * e.mid + .2 * e.high;

  // Numbers.
  timeEl.textContent = S.t.toFixed(2).padStart(5, '0') + ' S';
  const tail = playing && S.t > S.cut;
  let spikes = st === 'lost' ? 0 : tail ? 2.6 * (1 - (S.t - S.cut) / (S.dur - S.cut)) : playing ? .55 + 2.1 * energy + (S.t > S.cut - .5 ? .7 : 0) : .4 + Math.sin(now / 900) * .02;
  spikesShown += (spikes - spikesShown) * .35;
  spikesEl.textContent = spikesShown.toFixed(2) + 'M';
  if (playing && !S.peek) {
    const pct = Math.min(99, Math.round(Math.max(0, (S.t - .5) / (S.cut - .5)) * 99));
    logEl.textContent = tail ? 'SIGNAL / DECAY' : S.t < 2.4 ? 'STIMULUS / DETECTED' : S.t > S.cut - 2 ? 'MOTOR_06 / REACH 99%' : `MOTOR_06 / REACH ${pad(pct)}%`;
  }

  // Raster: scroll one column, fire 96 cells from the envelope.
  bc.drawImage(brain, -1, 0);
  bc.fillStyle = '#050a1a'; bc.fillRect(BW - 1, 0, 1, BH);
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    const c = tune[r];
    const drive = st === 'lost' ? 0 : tail ? .5 * (1 - (S.t - S.cut) / (S.dur - S.cut)) : playing ? Math.pow(e[c.band], 1.6) * c.gain : .01;
    const on = st !== 'lost' && Math.random() < c.base + drive;
    S.fire[r] = on ? 1 : 0;
    if (on) { count++; bc.fillStyle = r < 26 ? '#93e5d8' : r < 62 ? '#5f8fb0' : '#9fb3cf'; bc.fillRect(BW - 1, TOP + r, 1, 1); }
  }
  if (st === 'lost') { bc.fillStyle = '#ff5ea8'; bc.fillRect(BW - 1, TOP + 48, 1, 1); }
  const pop = Math.min(TOP, Math.round(count / ROWS * TOP * 4));
  bc.fillStyle = '#69d7ca'; bc.fillRect(BW - 1, TOP - pop, 1, pop);
}
requestAnimationFrame(hud);

/* ---------------------------------------------------------------- share, toast, goals */

function shareUrl() {
  const canon = document.querySelector('link[rel=canonical]')?.href || '';
  return canon && !canon.includes('SITE_URL') ? canon : location.origin + location.pathname;
}
$('#share').addEventListener('click', async () => {
  goal('share');
  const url = shareUrl() + '?utm_source=share';
  if (navigator.share) {
    try { await navigator.share({ title: document.title, text: SHARE_TEXT, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${SHARE_TEXT} ${url}`); showToast('ссылка скопирована'); }
  catch {
    const i = document.createElement('input'); i.value = url; document.body.append(i); i.select();
    try { document.execCommand('copy'); showToast('ссылка скопирована'); } catch { showToast(url); }
    i.remove();
  }
});

let toastTimer;
function showToast(msg) {
  const el = typeof msg === 'string' ? $('#toast') : msg;
  if (typeof msg === 'string') el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function goal(name) { try { if (METRIKA_ID && window.ym) window.ym(METRIKA_ID, 'reachGoal', name, { src: source() }); } catch { /* ignore */ } }
if (METRIKA_ID) {
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const s = document.createElement('script'); s.async = true; s.src = 'https://mc.yandex.ru/metrika/tag.js'; document.head.append(s);
  window.ym(METRIKA_ID, 'init', { clickmap: false, trackLinks: true, accurateTrackBounce: true, webvisor: false });
}

/* ---------------------------------------------------------------- layout & scene */

function measure() {
  const h = innerHeight;
  const title = (S.mobile ? $('.top') : $('.title')).getBoundingClientRect();
  const hud = $('.neural').getBoundingClientRect(), bottom = $('.bottom').getBoundingClientRect();
  S.mobile = innerWidth < 801;
  // On wide screens the HUD may overlap the fly's feet, like the reference frame.
  S.safe = S.poster ? { top: h * .22, bottom: h * .97 }
    : { top: title.bottom + 8, bottom: S.mobile ? bottom.top - 6 : Math.min(h, hud.top + hud.height * .45) };
  if (typeof placeGate === 'function' && !gate.hidden) placeGate();
  // The SIGNAL LOST card sits high in the free band, clear of the fly's reach.
  app.style.setProperty('--line-y', Math.round(S.safe.top + (S.safe.bottom - S.safe.top) * (S.mobile ? .13 : .16)) + 'px');
  S.onLayout?.();
}
new ResizeObserver(() => { measure(); render(); }).observe(document.body);
measure();

// Start fetching the replay once the page is up, not before the first frame.
const warm = () => { audio.preload = 'auto'; };
if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 1500);

// Every module URL carries the release version (?v=6), so a 404 cached during a deploy can't stick.
// If the scene still fails to load, try once more past any cache before falling back.
import('./scene.js?v=6').catch(() => import('./scene.js?v=6&retry=' + Date.now())).then(m => m.init(world, S)).then(() => {
  if (Q.has('peek')) togglePeek(true); // ?peek: start inside the head (for clips)
}).catch(err => {
  console.error(err);
  world.classList.add('fallback');
  peekBtn.hidden = true;
});
