import {
  SCALES, summarize, RATED_SORTS, searchSummaries, sortSummaries, findDuplicates,
  distanceKm, mapsLink, readCode, parsePastedLink, disagreement, slotWeights, pickWeighted, ago, displayName, isUuid, ratingModel, isThin, shareText, readPlace, parseMapLink, MAP_APPS, fmtPrice, priceToPct, parsePrice,
  KINDS, reelsOf, slotCandidates, matchHeld, jackpotOf, placeOfDay, goPrompt, boardLines, roomLink, readRoom, feedEvents, feedWhen, feedWhat,
  readCmps, myOrder, cmpAdjustments, cmpStart, cmpNext, cmpAnswer, cmpTotal, cmpUnranked,
} from './logic.js';
import { posterSvg, kindColor } from './covers.js';
import { makeApi, isDemo, ApiError, probe, probeRpc, routes, currentRoute } from './api.js';
import { avatarSvg, crownSvg, reviewAvatar, randomSeed, authorSeed } from './avatar.js';
import { VERSION, CHANGELOG } from './version.js';

// $root — весь сайт; $app — куда сейчас рисует экран (на компьютере это одна из колонок, после отрисовки снова $root).
const $root = document.getElementById('app');
let $app = $root;
// ПК-версия: от 1024 px слева постоянная панель, список и карта (или карточка места) рядом.
const DESK = matchMedia('(min-width: 1024px)');
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без хранилища всё работает до перезагрузки */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x) => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
const SPB = [59.9386, 30.3141];

// Код профиля: случайный, живёт в этом браузере; по нему сервер узнаёт «мои» рецензии (имя при этом не нужно).
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const loadAuthor = () => { let a = ls.get('gas_author'); if (!isUuid(a)) { a = newId(); ls.set('gas_author', a); } return a; };
const AUTHOR = loadAuthor();
// Зерно аватарки: выбранное кубиком (из базы или с этого телефона), иначе вычисленное из кода профиля.
const loadSeed = () => { const raw = ls.get('gas_avatar'); const n = Number(raw); return raw && Number.isInteger(n) && n >= 0 && n <= 4294967295 ? n : authorSeed(AUTHOR); };
// Выбор кубиком, который сервер ещё не подтвердил: пока он есть, данные сервера его не перетирают (иначе аватар «откатывался»).
const PENDING = 'gas_avatar_pending';
const pendingSeed = () => { const raw = ls.get(PENDING); const n = Number(raw); return raw && Number.isInteger(n) && n >= 0 && n <= 4294967295 ? n : null; };
const S = { code: null, seed: loadSeed(), online: null, flash: '', author: AUTHOR, name: ls.get('gas_name') || '', anon: ls.get('gas_anon') === '1', role: 'user', realRole: 'user', asUser: ls.get('gas_as_user') === '1', data: null, sums: [], gate: null, err: null, map: null };

// ---------- секретный код: из #k=… в адресе, затем адрес очищается ----------
{
  const { code, fromUrl } = readCode(location.hash, ls.get('gas_code'));
  S.code = code; S.deepPlace = readPlace(location.hash); // ссылка на место из «Поделиться»
  S.deepRoom = readRoom(location.hash); // ссылка на комнату «Вместе»
  if (fromUrl) ls.set('gas_code', code);
  if (fromUrl || S.deepPlace != null || S.deepRoom) history.replaceState(null, '', location.pathname + location.search);
}
const api = makeApi(() => S.code, () => S.author, (fn, kind, info) => report(kind === 'route' ? 'route' : 'network', `${fn}: ${kind === 'route' ? 'смена пути' : kind === 'db' ? 'база не ответила' : 'обрыв связи'}`, info));

// ---------- журнал ошибок: сбои сами уходят админу (вкладка «Ошибки»), от людей ничего не нужно ----------
const ERRQ = 'gas_errq';
const viewName = () => { try { return cur.view; } catch { return 'запуск'; } }; // cur объявлен ниже
const errSeen = new Set(); let errSent = 0;
function report(kind, message, detail = '') {
  if (isDemo) return;
  const key = `${kind}|${message}`; if (errSeen.has(key) || errSent >= 15) return; // без повторов и не больше 15 за визит
  errSeen.add(key); errSent++;
  const item = { kind, message: String(message || '').slice(0, 600), detail: `${String(detail || '').slice(0, 3800)}\nэкран: ${viewName()} · время на устройстве: ${new Date().toLocaleString('ru')}`,
    url: location.pathname, ua: navigator.userAgent.slice(0, 300), version: VERSION };
  let q = []; try { q = JSON.parse(ls.get(ERRQ) || '[]'); } catch { /* пусто */ }
  q.push(item); ls.set(ERRQ, JSON.stringify(q.slice(-20)));
  flushErrors();
}
let flushing = false;
async function flushErrors() {
  if (flushing || isDemo || !S.code || S.gate) return; flushing = true;
  try {
    for (;;) {
      let q = []; try { q = JSON.parse(ls.get(ERRQ) || '[]'); } catch { q = []; }
      if (!q.length) break;
      try { await api.logError(q[0]); } catch { break; } // нет связи — отправим в следующий раз
      ls.set(ERRQ, JSON.stringify(q.slice(1)));
    }
  } finally { flushing = false; }
}
window.addEventListener('error', (e) => { if (e.message) report('js', e.message, `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}\n${e.error?.stack || ''}`); });
window.addEventListener('unhandledrejection', (e) => { const r = e.reason; report('js', r?.message || String(r), r?.stack || ''); });

// ---------- тема ----------
const applyTheme = () => {
  const t = ls.get('gas_theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
};
const cycleTheme = () => {
  const order = [null, 'light', 'dark']; const cur = ls.get('gas_theme');
  const next = order[(order.indexOf(order.includes(cur) ? cur : null) + 1) % 3];
  ls.set('gas_theme', next ?? 'auto'); applyTheme();
};
applyTheme();
const ICON = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  slot: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M9 5v14M15 5v14"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="17" cy="9" r="2.4"/><path d="M16 14.6c2.2.1 3.9 1.5 4.5 4.4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const ico = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const themeIcon = () => ico({ light: 'sun', dark: 'moon' }[ls.get('gas_theme')] ?? 'auto');

// ---------- общие куски разметки ----------
const scoreClass = (x) => (x == null ? '' : x >= 6.5 ? 'b2' : x >= 5 ? 'b1' : 'b0');
const thinTag = (s) => `<span class="thin-tag">${s.count ? 'МАЛО ДАННЫХ' : 'НЕТ ОЦЕНОК'}</span>`;
const STAR = '<path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z"/>';
const stars = (n) => (n == null ? '<span class="badge">—</span>'
  : `<span class="badge b${n}" role="img" aria-label="${n} из 3">${[0, 1, 2].map((i) => `<svg class="${i < n ? 'on' : 'off'}" viewBox="0 0 24 24" aria-hidden="true">${STAR}</svg>`).join('')}</span>`);
const bar = (title, back = true) => `<header class="bar">${back ? `<button class="icon-btn" data-act="back" aria-label="Назад">${ico('back')}</button>` : ''}<h1>${esc(title)}</h1><button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>`;
const SHORT = { access: 'Доступ', taste: 'Вкус', service: 'Сервис', clean: 'Чистота', toilet: 'Туалет', impression: 'Впечатл.' };
// Шкалы в виде 5 полосок: заполнено столько, сколько округлённая оценка.
const barsHtml = (sc, keys = SCALES.map(([k]) => k)) => `<div class="bars">${keys.map((k) => {
  const v = sc[k]; const on = v == null ? 0 : Math.round(v);
  return `<span>${SHORT[k].toUpperCase()}</span><span class="seg5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= on ? 'on' : ''}"></i>`).join('')}</span><b>${fmt(v)}</b>`;
}).join('')}</div>`;
// Цены в карточке места: средний диапазон крупно и шкала (серые полоски — каждый автор, лаймовая — средний).
function priceHtml(s) {
  const txt = fmtPrice(s.price); if (!txt) return '';
  // «от 2 000» — полоска от 2 000 до конца шкалы, «до 500» — от нуля до 500
  const bar = (f, t, cls) => { const a = f == null ? 0 : priceToPct(f); const b = t == null ? 100 : priceToPct(t); return `<i class="${cls}${f == null || t == null ? ' open' : ''}" style="left:${a}%;width:${Math.max(1.5, b - a)}%"></i>`; };
  const own = s.reviews.filter((r) => r.price_from != null || r.price_to != null).map((r) => bar(r.price_from, r.price_to, 'pr-one')).join('');
  return `<div class="card pricebox"><div class="pr-head"><span class="label">Цены · на человека</span><b>${txt}</b></div>
    <div class="pr-scale"><span class="pr-line"></span>${own}${bar(s.price.from, s.price.to, 'pr-avg')}</div>
    <div class="pr-ticks"><span>0</span><span style="left:40%">1 000</span><span style="left:70%">2 500</span><span style="left:100%">5 000+</span></div>
    <div class="small muted" style="margin-top:8px">${s.price.n > 1 ? `Средний диапазон по ${s.price.n} рецензиям.` : 'По одной рецензии.'} На итоговый балл не влияет.</div></div>`;
}
// Цены в чипе: «₽» отдельно и тире с пробелами, чтобы «1 000 – 2 000» не сливалось в одну строку цифр
function priceChip(p) {
  if (!fmtPrice(p)) return '';
  const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
  const body = p.from != null && p.to != null ? (p.from === p.to ? n(p.from) : `${n(p.from)}<em>–</em>${n(p.to)}`) : p.from != null ? `<small>от</small> ${n(p.from)}` : `<small>до</small> ${n(p.to)}`;
  return `<span class="chip price"><i>₽</i>${body}</span>`;
}
const toiletStat = (r) => (r.toilet_present === true && r.toilet != null ? `Туалет ${r.toilet}` : r.toilet_present === false ? 'Туалета нет' : '');
// Рецензия как пост: аватар с линией «ветки», имя, давность, вердикт, текст, фото, показатели.
const postHtml = (r, last) => `<article class="post"><div class="side"><span class="av-tile">${reviewAvatar(r, { size: 38, label: `Аватар: ${displayName(r)}` })}</span>${last ? '' : '<span class="line"></span>'}</div>
  <div class="main"><div class="hd"><b>${esc(displayName(r))}</b>${r.mine ? '<span class="ago">· вы</span>' : ''}<span class="ago">· ${esc(ago(r.updated_at || r.created_at))}</span>${stars(r.verdict)}</div>
  ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<div class="thumbs" data-rid="${r.id}"></div>
  <div class="stats">${fmtPrice({ from: r.price_from, to: r.price_to }) ? `<span>Цены ${fmtPrice({ from: r.price_from, to: r.price_to })}</span>` : ''}<span>Вкус ${r.taste}</span><span>Сервис ${r.service}</span><span>Чистота ${r.clean}</span>${toiletStat(r) ? `<span>${toiletStat(r)}</span>` : ''}<span>Доступ ${r.access}</span><span>Впечатл. ${r.impression}</span></div>${S.role === 'admin' ? `<div style="margin-top:10px"><button class="btn danger" style="min-height:34px;padding:0 12px;font-size:13px" data-del="${r.id}">Удалить (админ)</button></div>` : ''}</div></article>`;

// ---------- данные ----------
function build(data) {
  S.data = data;
  // Аватар: сервер хранит зерно в профиле (на любом устройстве один); неподтверждённый выбор кубиком важнее данных сервера.
  const pend = pendingSeed();
  if (pend != null) { S.seed = pend; data.reviews.forEach((r) => { if (r.mine && r.author_name) r.avatar_seed = pend; }); }
  else {
    const srv = data.me_seed ?? data.reviews.find((r) => r.mine && r.avatar_seed != null)?.avatar_seed;
    if (srv != null) { S.seed = srv; ls.set('gas_avatar', String(srv)); }
  }
  const by = new Map();
  data.reviews.forEach((r) => { if (!by.has(r.place_id)) by.set(r.place_id, []); by.get(r.place_id).push(r); });
  if (!S.name && data.me_name) { S.name = data.me_name; ls.set('gas_name', S.name); } // имя из приглашения подставляется в рецензии
  S.realRole = data.role || 'user';
  S.role = S.realRole === 'admin' && S.asUser ? 'user' : S.realRole; // «режим пользователя» для админа: только вид интерфейса, ключ тот же
  const model = ratingModel(data.reviews); // общий средний балл и поправка на строгость авторов
  S.sums = data.places.map((p) => summarize(p, by.get(p.id) || [], model));
}
// Кэш последних данных: сайт открывается сразу, а свежие данные подтягиваются в фоне (важно на медленной сети).
const CACHE_KEY = 'gas_cache_v1';
const readCache = () => { try { const c = JSON.parse(ls.get(CACHE_KEY)); return c && c.code === S.code ? c.data : null; } catch { return null; } };
const writeCache = (data) => { try { ls.set(CACHE_KEY, JSON.stringify({ code: S.code, data })); } catch { /* кэш необязателен */ } };
async function refresh() {
  if (!isDemo && !S.code) { S.gate = 'none'; return false; }
  try { const data = await api.getAll(); build(data); if (!isDemo) writeCache(data); S.gate = null; S.err = null; S.online = true; return true; }
  catch (e) {
    if (!(e instanceof ApiError)) throw e;
    S.online = false;
    if (e.kind === 'bad_code') S.gate = 'bad'; else S.err = e;
    return false;
  }
}
// После записи: если данные не обновились из-за связи, не пугаем экраном «База недоступна» — запись уже сохранена.
async function refreshAfterWrite(note) {
  const ok = await refresh();
  if (!ok && !S.gate) { S.err = null; S.flash = note; }
}
// Отправка выбранного кубиком аватара (по очереди, последний выбор побеждает; при сбое повторим позже).
function syncAvatar() {
  const seed = pendingSeed(); if (seed == null || !S.code && !isDemo) return;
  S.seedSync = (S.seedSync || Promise.resolve()).then(() => api.setAvatar(seed)).then(() => {
    if (pendingSeed() === seed) ls.set(PENDING, '');
    if (S.data && !isDemo) writeCache(S.data);
  }, () => {
    const m = $app.querySelector('#msg'); if (m && cur.view === 'me') { m.style.color = ''; m.textContent = 'Аватар сменился здесь, а в базу отправится, когда вернётся связь.'; }
  });
}
window.addEventListener('online', syncAvatar);
// Открыть место по ссылке #p=…, как только оно есть в данных (один раз).
function openDeep() {
  if (S.gate || !S.data) return false;
  if (S.deepRoom) { T.joinId = S.deepRoom; S.deepRoom = null; go('slot'); return true; }
  if (S.deepPlace == null) return false;
  const id = S.deepPlace; if (!sumById(id)) return false;
  S.deepPlace = null; go('detail', { id }); return true;
}
const placeBadge = (s) => (isThin(s) ? thinTag(s) : stars(s.stars)); // у места с малым числом рецензий звёзд нет
const sumById = (id) => S.sums.find((s) => s.place.id === id);

// ---------- навигация (адрес не меняем: в нём может быть код) ----------
let cur = { view: 'menu', p: {}, d: 0 }; // d — глубина: при 0 «Назад» ведёт в меню, а не из приложения
function go(view, p = {}, replace = false) {
  cur = { view, p, d: replace ? cur.d : cur.d + 1 };
  history[replace ? 'replaceState' : 'pushState'](cur, '');
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', (e) => { cur = e.state || { view: 'menu', p: {}, d: 0 }; render(); });
history.replaceState(cur, '');

$root.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  if (t.tagName === 'A') e.preventDefault();
  const a = t.dataset.act;
  if (a === 'back') cur.d > 0 ? history.back() : go('menu', {}, true);
  else if (a === 'theme') { cycleTheme(); render(); }
  else if (a === 'nogo') { ls.set('gas_trip', ''); t.closest('.askgo')?.remove(); }
  else if (a === 'go') go(t.dataset.view, t.dataset.id ? { id: Number(t.dataset.id) } : {});
});

async function guard(fn, msgEl) {
  try { await fn(); }
  catch (e) {
    if (!(e instanceof ApiError)) { console.error(e); report('js', e?.message || String(e), e?.stack || ''); if (msgEl) msgEl.textContent = 'Что-то пошло не так. Попробуйте ещё раз.'; return; }
    if (e.kind === 'rejected') report('rejected', `отказ базы: ${e.detail || '—'}`, '');
    if (e.kind === 'bad_code') { S.gate = 'bad'; render(); }
    else if (msgEl) msgEl.textContent = e.kind === 'forbidden' ? 'Это может сделать только автор или админ.' : e.kind === 'offline' ? 'Нет связи с базой. Проверьте интернет и повторите.' : e.kind === 'db' ? 'База не отвечает (возможно, «спит»). Повторите через минуту.' : `Не удалось сохранить: ${e.detail || 'отказ базы'}`;
    else { S.err = e; render(); }
  }
}

// ---------- отрисовка ----------
function render() {
  if (S.map) { S.map.remove(); S.map = null; }
  if (S.pick) { S.pick.remove(); S.pick = null; }
  if (S.keyFn) { document.removeEventListener('keydown', S.keyFn); S.keyFn = null; }
  if (S.onLeave) { S.onLeave(); S.onLeave = null; } // экран убирает свои таймеры (опрос комнаты «Вместе»)
  $app = $root; document.body.classList.remove('desk');
  if (S.gate) return viewGate();
  if (S.err) return viewError();
  if (!S.data) return viewLoading();
  // обязательный первый раз: пока свои места не сравнены, вместо остальных экранов — сравнение
  if (!FIRST_FREE.has(cur.view) && needFirst()) { cur = { view: 'compare', p: {}, d: cur.d }; history.replaceState(cur, ''); }
  if (DESK.matches) renderDesk(); else (VIEWS[cur.view] || viewMenu)();
  if (S.flash) { ($root.querySelector('.dk-b header') || $root.querySelector('header'))?.insertAdjacentHTML('afterend', `<div class="notice soft">${ico('info')}<span>${esc(S.flash)} <a href="#" id="flash-retry">Обновить</a></span></div>`); S.flash = '';
    const fr = $root.querySelector('#flash-retry'); if (fr) fr.onclick = async (e) => { e.preventDefault(); fr.textContent = 'обновляю…'; await refreshAfterWrite('Связь всё ещё плохая. Попробуйте позже.'); render(); }; }
}
// Загрузка: если база долго молчит, честно говорим об этом (запрос сам оборвётся по таймауту и покажет «Повторить»).
const VIEWS = { compare: () => viewCompare(), feed: () => viewFeed(), news: () => viewNews(), errors: () => viewErrors(), menu: () => viewMenu(), list: () => viewList(), detail: () => viewDetail(), map: () => viewMap(), slot: () => viewSlot(), rate: () => viewRate(), me: () => viewMe(), invites: () => viewInvites(), editplace: () => viewEditPlace(), net: () => viewNet() };
DESK.addEventListener('change', () => { if (S.data && !S.gate && !S.err) render(); });

// ---------- ПК-версия: панель слева и одна или две рабочие колонки ----------
const meName = () => (S.role === 'admin' ? (S.name || 'Админ') : S.name && !S.anon ? S.name : 'Аноним');
const netStatus = () => (isDemo ? 'демо' : S.online === false ? 'нет связи · показаны сохранённые данные'
  : S.online ? `база на связи${routes().length > 1 && currentRoute() === 'proxy' ? ' · через Яндекс' : ''}` : 'обновляю…');
function railHtml(v) {
  const rated = S.sums.filter((x) => x.count).length;
  const nav = (key, label, icon, on, extra = '') => `<button class="r-nav${on ? ' on' : ''}" data-act="go" data-view="${key}">${ico(icon)}<span>${label}</span>${extra}</button>`;
  return `<div class="r-brand"><b>G.A.S.</b><span>RATING</span></div>
    <button class="r-me" data-act="go" data-view="me" aria-label="Открыть профиль"><span class="me-tile">${avatarSvg(S.seed, { size: 40, animate: true, label: 'Ваш аватар' })}${S.role === 'admin' ? crownSvg() : ''}</span>
      <span class="grow"><b>${esc(meName())}</b><small>${S.role === 'admin' ? 'админ' : 'участник'} · профиль</small></span></button>
    <button class="r-cta${v === 'slot' ? ' on' : ''}" data-act="go" data-view="slot"><span class="tag">01 · Слот-машина</span><span class="ttl">Выбрать<br>место</span><span class="letters" aria-hidden="true"><b>G</b><b>A</b><b>S</b></span></button>
    <nav class="r-list">${nav('list', 'Все оценённые', 'list', v === 'list' || v === 'detail' || v === 'map', `<small>${rated}</small>`)}${nav('rate', 'Оценить заведение', 'plus', v === 'rate')}${S.role === 'admin' ? nav('errors', 'Ошибки', 'warn', v === 'errors', `<small>${S.data?.err_count ?? ''}</small>`) : ''}</nav>
    ${railFeedHtml()}
    ${isDemo ? '<div class="notice">Демо-режим: выдуманные примеры.</div>' : ''}
    <div class="r-foot"><button class="r-nav" data-act="theme">${themeIcon()}<span>Сменить тему</span></button>
      <div class="foot${S.online === false ? ' off' : ''}"><span class="dot"></span><span>${netStatus()}</span></div>
      <button class="r-ver" data-act="go" data-view="news">бета ${VERSION} · что нового</button></div>`;
}
// На больших экранах интерфейс увеличивается вместе с шириной (макет рассчитан на 1440 px), чтобы не выглядеть мелким.
const deskScale = () => Math.min(2, Math.max(1, Math.round((innerWidth / 1440) * 20) / 20));
const deskStyle = () => { const k = deskScale(); return k > 1 ? `zoom:${k};height:calc(100dvh / ${k})` : ''; };
let resizeT = 0;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
  const dk = $root.querySelector('.dk'); if (!dk || !DESK.matches) return;
  dk.setAttribute('style', deskStyle()); fixDeskHeight(dk); S.map?.invalidateSize();
}, 150); });
// Подгоняем высоту под окно: браузеры по-разному применяют zoom к 100dvh, поэтому меряем и правим.
function fixDeskHeight(dk) {
  const h = dk.getBoundingClientRect().height;
  if (h && Math.abs(h - innerHeight) > 2) dk.style.height = `${parseFloat(getComputedStyle(dk).height) * innerHeight / h}px`;
}
function renderDesk() {
  const v = cur.view === 'menu' ? 'list' : cur.view;
  const two = v === 'list' || v === 'detail' || v === 'map' || v === 'feed';
  const oldA = $root.querySelector('.dk.two .dk-a'); const keep = two && oldA ? oldA.scrollTop : 0; // список не прыгает наверх при выборе места
  document.body.classList.add('desk');
  $root.innerHTML = `<div class="dk ${two ? 'two' : 'one'} v-${v}" style="${deskStyle()}"><aside class="rail">${railHtml(v)}</aside><main class="dk-a"></main>${two ? '<section class="dk-b"></section>' : ''}</div>`;
  const A = $root.querySelector('.dk-a'); const B = $root.querySelector('.dk-b');
  fixDeskHeight($root.querySelector('.dk'));
  try {
    if (two) { $app = A; viewList(); $app = B; if (v === 'detail') viewDetail(); else if (v === 'feed') viewFeed(); else viewMapPane(); }
    else { $app = A; (VIEWS[v] || viewList)(); }
  } finally { $app = $root; }
  if (keep && A.isConnected) A.scrollTop = keep;
}

const viewLoading = () => {
  $app.innerHTML = `${bar('G.A.S. Rating', false)}<p class="muted" id="loading">Загружаю…</p>`;
  clearTimeout(S.slowT); S.slowT = setTimeout(() => { const el = document.getElementById('loading'); if (el) el.textContent = 'Загружаю… База отвечает медленно: подождите немного, при обрыве появится кнопка «Повторить».'; }, 6000);
};

function viewError() {
  const e = S.err;
  $app.innerHTML = `${bar('G.A.S. Rating', false)}<div class="card"><h2>База недоступна</h2>
    <p>${e.kind === 'offline' ? 'Связь с базой оборвалась или слишком медленная. Повторите; если так постоянно, откройте «Проверку связи» и пришлите результат админу.' : 'База не отвечает. Бесплатная база засыпает, если неделю никто не заходит: откройте её в панели Supabase и нажмите «Restore», или повторите через минуту.'}</p>
    <button class="btn accent block" id="retry">Повторить</button><button class="btn block" data-act="go" data-view="net" style="margin-top:10px">Проверка связи</button></div>`;
  $app.querySelector('#retry').onclick = async () => { S.err = null; viewLoading(); await refresh(); render(); };
}

function viewGate() {
  const bad = S.gate === 'bad';
  $app.innerHTML = `${bar('G.A.S. Rating', false)}<div class="card"><h2>${bad ? 'Код не подходит' : 'Нужна ваша ссылка'}</h2>
    <p>${bad ? 'Сохранённая ссылка устарела или отозвана. Попросите у админа новую личную ссылку и вставьте её сюда.' : 'Откройте сайт по личной ссылке, которую вам прислали. Если сайт открылся без неё (например, с иконки на домашнем экране), вставьте ссылку сюда один раз.'}</p>
    <label class="lbl" for="paste">Ссылка или код</label><input type="text" id="paste" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#k=…">
    <div class="err" id="msg"></div><button class="btn accent block" id="enter" style="margin-top:12px">Войти</button></div>`;
  $app.querySelector('#enter').onclick = async () => {
    const code = parsePastedLink($app.querySelector('#paste').value);
    if (!code) return;
    S.code = code; ls.set('gas_code', code); S.gate = null; viewLoading();
    await refresh(); render(); openDeep();
  };
}

// ---------- лента «Что нового» ----------
// Новое = чужие события после прошлого захода (запоминается в этом браузере; при первом заходе — за последние 3 дня).
const FEED_PREV = (() => { const v = Number(ls.get('gas_feed_seen')); return v > 0 ? v : Date.now() - 3 * 864e5; })();
const feedNow = () => feedEvents(S.sums, S.data?.photo_news);
const isNewEv = (e) => !e.mine && e.at > FEED_PREV;
const markFeedSeen = () => ls.set('gas_feed_seen', String(Date.now()));
const evWho = (e) => (e.mine ? 'Вы' : e.who);
function feedBoardHtml(evs, limit) {
  const list = evs.slice(0, limit); const nNew = evs.filter(isNewEv).length;
  return `<div class="board feed"><div class="b-top"><span class="b-dot"></span><span class="grow b-ttl">ЧТО НОВОГО</span>${nNew ? `<span class="f-new">НОВЫХ: ${nNew}</span>` : ''}</div>
    ${list.length ? `<div class="f-row f-head" aria-hidden="true"><span>ВРЕМЯ</span><span>КТО</span><span>ЧТО</span></div>
    ${list.map((e) => `<button class="f-row${isNewEv(e) ? ' new' : ''}" data-act="go" data-view="detail" data-id="${e.place.id}"><span class="t">${feedWhen(e.at)}</span><span class="w">${esc(evWho(e).toUpperCase())}</span><span class="p">${esc(feedWhat(e))} <em>${esc(e.place.name.toUpperCase())}</em></span></button>`).join('')}`
    : '<div class="f-row new"><span class="t">—</span><span class="w">ТИХО</span><span class="p">Пока ничего нового</span></div>'}
    ${evs.length > list.length ? '<button class="f-more" data-act="go" data-view="feed">Вся лента</button>' : ''}</div>`;
}
// На ПК: коротко в панели слева (три последних), целиком — справа по «Вся лента».
function railFeedHtml() {
  const evs = feedNow(); const nNew = evs.filter(isNewEv).length;
  if (!evs.length) return '';
  markFeedSeen();
  return `<div class="r-feed"><div class="r-fh"><span>Что нового</span>${nNew ? `<b>${nNew}</b>` : ''}</div>
    ${evs.slice(0, 3).map((e) => `<button class="r-fi" data-act="go" data-view="detail" data-id="${e.place.id}"><span class="r-fa">${e.review ? reviewAvatar(e.review, { size: 20, label: evWho(e) }) : '<i></i>'}</span>
      <span><b>${esc(evWho(e))}</b> · ${esc(e.place.name)} ${esc(feedWhat(e).replace(' ИЗМ.', '').toLowerCase())}</span></button>`).join('')}
    <button class="r-fall" data-act="go" data-view="feed">Вся лента →</button></div>`;
}
function viewFeed() {
  $app.innerHTML = `${bar('Что нового')}${feedBoardHtml(feedNow(), 60)}
    <p class="small muted">Новые рецензии, правки, фото и «Хочу сходить» за всё время (фото — за 60 дней). Нажмите строку, чтобы открыть место.</p>`;
  markFeedSeen();
}

// «Как сходили?»: на следующий день после «Едем!» в автомате (до недели), пока место не оценено или не нажато «Не ходили».
const readTrip = () => { try { return JSON.parse(ls.get('gas_trip') || 'null'); } catch { return null; } };
function askGoHtml() {
  const s = goPrompt(readTrip(), S.sums); if (!s) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const when = today - readTrip().at < 864e5 ? 'Вчера' : 'Недавно';
  return `<div class="askgo"><div>${when} вы собирались в <b>${esc(s.place.name)}</b>. Как сходили?</div>
    <div class="row"><button class="btn accent grow" data-act="go" data-view="rate" data-id="${s.place.id}">Оценить</button><button class="btn" data-act="nogo">Не ходили</button></div></div>`;
}
function viewMenu() {
  const rated = S.sums.filter((s) => s.count).length;
  $app.innerHTML = `<header class="bar mehead"><button class="me-tile" data-act="go" data-view="me" aria-label="Открыть профиль">${avatarSvg(S.seed, { size: 52, animate: true, label: 'Ваш аватар' })}${S.role === 'admin' ? crownSvg() : ''}</button>
      <div class="grow"><div class="mename">${esc(S.role === 'admin' ? (S.name || 'Админ') : S.name && !S.anon ? S.name : 'Аноним')}</div><div class="label" style="font-size:11px;margin-top:2px">${S.role === 'admin' ? 'админ' : 'участник'} · профиль</div></div>
      <button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>
    ${isDemo ? `<div class="notice">${ico('warn')}<span>Демо-режим: выдуманные примеры. Настоящая база подключается в <code>config.js</code>.</span></div>` : ''}
    ${askGoHtml()}
    <h1 class="hero">Куда<br>едем<i>.</i></h1>
    ${((pod) => `<button class="tile primary${pod ? ' has-pod' : ''}" data-act="go" data-view="slot"><span class="tag">01 · Слот-машина</span><span class="ttl">Выбрать место</span>${pod
      ? `<span class="pod"><span class="tag">Место дня</span><span class="flaps">${flapsHtml(boardLines(pod.place.name, 18, 1)[0])}</span></span>`
      : '<span class="letters" aria-hidden="true"><b>G</b><b>A</b><b>S</b></span>'}</button>`)(placeOfDay(slotCandidates(S.sums, 'tested')))}
    <div class="grid2">
      <button class="tile sq" data-act="go" data-view="list"><span class="tag">02 · Список</span><span><span class="num">${String(rated).padStart(2, '0')}</span><span class="ttl">Все оценённые</span></span></button>
      <button class="tile sq map" data-act="go" data-view="map"><span class="tag">03 · Карта</span>
        <span class="grid" aria-hidden="true"></span>
        <svg class="route" viewBox="0 0 169 152" preserveAspectRatio="none" aria-hidden="true"><path d="M20 94 C 55 100, 75 70, 117 50" fill="none" stroke="var(--acc)" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".7"/></svg>
        <i class="pin"></i><i class="pin2"></i>
        <span class="ttl">Карта</span></button>
    </div>
    <button class="tile rate" data-act="go" data-view="rate"><span class="plus">${ico('plus')}</span><span><b>Оценить заведение</b><small>новая или обновлённая рецензия</small></span></button>
    ${feedBoardHtml(feedNow(), 6)}
    <div class="foot${S.online === false ? ' off' : ''}"><span class="dot"></span><span>${isDemo ? 'демо' : S.online === false ? 'нет связи с базой · показаны сохранённые данные' : S.online ? 'база на связи' : 'обновляю…'}</span><button class="ver" data-act="go" data-view="news">β ${VERSION}</button></div>`;
  markFeedSeen();
}

function downloadBackup() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `gas-rating-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- профиль: имя, ключ доступа, приглашения (админ) ----------
function viewMe() {
  $app.innerHTML = `${bar('Профиль')}
    <div class="card" style="display:flex;align-items:center;gap:16px"><span class="me-tile" style="width:96px;height:96px;border-radius:30px;flex:none">${avatarSvg(S.seed, { size: 84, animate: true, label: 'Ваш аватар' })}${S.role === 'admin' ? crownSvg({ size: 30 }) : ''}</span>
      <div class="grow"><div class="label">Аватар</div><p class="small muted" style="margin:6px 0 10px">${S.role === 'admin' ? 'Корона на аватаре видна только вам: в рецензиях вы выглядите как все. ' : ''}Аватар выпал случайно и показывается у ваших именных рецензий. Если не нравится, перебросьте кубик. У анонимных рецензий общий безликий аватар.</p>
      <button class="btn" id="reroll">Перебросить кубик</button></div></div>
    <div class="card"><div class="label">Доступ</div>
      <p style="margin:8px 0 0">${S.role === 'admin' ? 'Вы вошли как <b>админ</b>: можно править места, удалять любые рецензии и фото.' : 'Вы вошли как <b>участник</b>: можно добавлять места, оценки и фото, править и удалять только своё.'}</p>
      ${S.realRole === 'admin' ? `<p class="small muted" style="margin:8px 0 0">${S.asUser ? 'Включён режим пользователя: кнопки админа спрятаны, чтобы случайно ничего не удалить.' : 'Режим пользователя прячет кнопки админа, чтобы случайно ничего не удалить.'}</p><button class="btn" id="asuser" style="margin-top:8px">${S.asUser ? 'Вернуться в режим админа' : 'Переключиться в режим пользователя'}</button>` : ''}
      ${S.role === 'admin' ? '<button class="btn accent block" data-act="go" data-view="invites" style="margin-top:12px">Приглашения</button>' : ''}
      <label class="lbl" for="newkey">Сменить ключ доступа (ссылка или код)</label>
      <div class="row"><input type="text" id="newkey" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#k=…"><button class="btn" id="setkey">Войти</button></div></div>
    <div class="card"><div class="label">Имя в рецензиях</div>
      <label class="lbl" for="pname">Ваше имя</label><input type="text" id="pname" maxlength="40" value="${esc(S.name)}" placeholder="Как подписывать рецензии">
      <label class="pill" style="display:inline-block;margin-top:12px"><input type="checkbox" id="panon" ${S.anon ? 'checked' : ''}><span>Анонимно по умолчанию</span></label>
      <p class="small muted" style="margin:10px 0 0">Анонимно: имя не сохраняется нигде, в постах будет «Аноним». Выбор можно менять в каждой рецензии отдельно.</p></div>
    <div class="err" id="msg"></div>
    <div class="me-actions">${S.realRole === 'admin' && S.role === 'admin' ? `<button class="btn" data-act="go" data-view="errors">${ico('warn')}<span>Ошибки${S.data?.err_count ? ` · ${S.data.err_count}` : ''}</span></button>` : ''}
      <button class="btn" data-act="go" data-view="net">Проверка связи</button><button class="btn" id="backup">Скачать копию оценок</button></div>
    <button class="ver-line" data-act="go" data-view="news">G.A.S. Rating · бета ${VERSION} · что нового</button>`;
  const $ = (sel) => $app.querySelector(sel); const msg = $('#msg');
  const reroll = $('#reroll');
  if (reroll) reroll.onclick = () => {
    // сразу показываем новый аватар, запоминаем как «ожидающий» и отправляем в фоне
    const seed = randomSeed(); ls.set(PENDING, String(seed)); ls.set('gas_avatar', String(seed)); S.seed = seed;
    if (S.data) { build(S.data); if (!isDemo) writeCache(S.data); }
    render(); syncAvatar();
  };
  $('#pname').oninput = (e) => { S.name = e.target.value; ls.set('gas_name', S.name); };
  $('#panon').onchange = (e) => { S.anon = e.target.checked; ls.set('gas_anon', S.anon ? '1' : '0'); };
  $('#backup').onclick = downloadBackup;
  const asuser = $('#asuser');
  if (asuser) asuser.onclick = () => { S.asUser = !S.asUser; ls.set('gas_as_user', S.asUser ? '1' : '0'); S.role = S.realRole === 'admin' && S.asUser ? 'user' : S.realRole; render(); };
  $('#setkey').onclick = async () => {
    const code = parsePastedLink($('#newkey').value); if (!code) return;
    S.code = code; ls.set('gas_code', code); viewLoading(); await refresh(); render();
  };
}

// ---------- что нового: история версий ----------
function viewNews() {
  $app.innerHTML = `${bar('Что нового')}<p class="small muted" style="margin:0 0 12px">Сейчас на сайте бета-версия <b>${VERSION}</b>. Сайт ещё в разработке, поэтому номер начинается с нуля.</p>
    ${CHANGELOG.map(([v, d, t], i) => `<div class="card"${i ? '' : ' style="border-color:var(--acc)"'}><div class="label">Версия ${esc(v)} · ${esc(d)}</div><p style="margin:8px 0 0">${esc(t)}</p></div>`).join('')}`;
}

// ---------- журнал ошибок (только админ) ----------
function viewErrors() {
  if (S.role !== 'admin') return go('menu', {}, true);
  $app.innerHTML = `${bar('Ошибки')}
    <p class="small muted" style="margin:0 0 12px">Сюда сами попадают сбои у всех участников: ошибки в коде, обрывы связи, отказы базы. Скопируйте и пришлите Claude, чтобы разобрать.</p>
    <div class="row wrap" style="margin-bottom:12px"><button class="btn accent" id="ecopy" disabled>Скопировать все</button><button class="btn danger" id="eclear" disabled>Очистить</button></div>
    <div class="err" id="msg"></div><div id="elist"><p class="muted">Загружаю…</p></div>`;
  const msg = $app.querySelector('#msg'); let text = '';
  const el = $app.querySelector('#elist'); const ecopy = $app.querySelector('#ecopy'); const eclear = $app.querySelector('#eclear');
  const paint = async () => {
    let list;
    try { list = await api.listErrors(); } catch { if (el.isConnected) el.innerHTML = '<p class="err">Не удалось загрузить журнал.</p>'; return; }
    if (!el.isConnected) return; // пока грузилось, открыли другой экран
    if (S.data) S.data.err_count = list.length;
    const t = (x) => new Date(x.at).toLocaleString('ru');
    text = list.map((x) => `[${t(x)}] v${x.version || '?'} · ${x.who} · ${x.kind}: ${x.message}\n${x.detail || ''}\n${x.ua || ''}`).join('\n\n');
    el.innerHTML = list.length ? list.map((x) => `<div class="card errc"><div class="label">${esc(t(x))} · ${esc(x.who)} · v${esc(x.version || '?')} · ${esc(x.kind)}</div>
      <p style="margin:8px 0 0;font-weight:600">${esc(x.message)}</p>${x.detail ? `<pre>${esc(x.detail)}</pre>` : ''}<div class="small muted">${esc(x.ua || '')}</div></div>`).join('') : '<p class="muted">Ошибок нет.</p>';
    ecopy.disabled = !list.length; eclear.disabled = !list.length;
  };
  $app.querySelector('#ecopy').onclick = async () => { try { await navigator.clipboard.writeText(text); msg.style.color = 'var(--acc-text)'; msg.textContent = 'Скопировано.'; } catch { msg.style.color = ''; msg.innerHTML = '<textarea readonly id="etxt" style="min-height:160px"></textarea>'; const ta = msg.querySelector('#etxt'); ta.value = text; ta.select(); } };
  $app.querySelector('#eclear').onclick = () => confirm('Очистить журнал ошибок?') && guard(async () => { await api.clearErrors(); await paint(); }, msg);
  paint();
}

// ---------- проверка связи: что доходит от базы и от сайта ----------
function viewNet() {
  $app.innerHTML = `${bar('Проверка связи')}
    <p class="small muted" style="margin:0 0 12px">Проверка скачивает немного данных с сайта и из базы и показывает, сколько дошло и за сколько. Если что-то «замирает», пришлите админу снимок экрана или скопированный результат.</p>
    <div class="card"><div id="netout" class="net"><p class="muted">Нажмите «Проверить».</p></div></div>
    <button class="btn accent block" id="netgo">Проверить</button>
    <button class="btn block" id="netcopy" style="margin-top:10px" disabled>Скопировать результат</button><div class="err" id="msg"></div>`;
  const out = $app.querySelector('#netout'); const msg = $app.querySelector('#msg'); const copyBtn = $app.querySelector('#netcopy'); let text = '';
  const kb = (b) => `${(b / 1024).toFixed(1).replace('.', ',')} КБ`;
  $app.querySelector('#netgo').onclick = async (e) => {
    const btn = e.target; btn.disabled = true; out.innerHTML = ''; text = `G.A.S. проверка связи ${new Date().toLocaleString('ru')}\n${navigator.userAgent}\n`;
    const line = (name, r, note = '') => {
      const good = r.ok && !r.stalled; const t = `${good ? 'OK' : 'СБОЙ'} · ${name}: ${kb(r.bytes)} за ${(r.ms / 1000).toFixed(1).replace('.', ',')} с${r.status ? ` (код ${r.status})` : ''}${r.stalled ? ' — оборвалось или замерло' : ''}${note}`;
      out.insertAdjacentHTML('beforeend', `<p class="${good ? '' : 'bad'}">${esc(t)}</p>`); text += t + '\n';
    };
    const tests = [['сайт (GitHub), большой файл', () => probe('vendor/leaflet/leaflet.js')]];
    const withPhotos = S.sums.filter((s) => s.count).map((s) => s.place.id);
    const label = { proxy: 'через Яндекс', direct: 'напрямую' };
    if (!isDemo) for (const via of routes()) {
      tests.push([`база ${label[via]}, маленький ответ`, () => probeRpc('get_all', { p_code: S.code, p_author: S.author }, 20000, via)]);
      if (withPhotos.length) tests.push([`база ${label[via]}, большой ответ (фото)`, () => probeRpc('get_covers', { p_code: S.code, p_author: S.author, p_ids: withPhotos }, 20000, via)]);
    }
    if (!isDemo) text += `сейчас сайт ходит: ${label[currentRoute()]}\n`;
    for (const [name, run] of tests) { out.insertAdjacentHTML('beforeend', `<p class="muted" id="netcur">${esc(name)}…</p>`); const r = await run(); out.querySelector('#netcur')?.remove(); line(name, r); }
    const okVia = (via) => !text.includes(`СБОЙ · база ${label[via]}`);
    const site = text.includes('СБОЙ · сайт');
    const good = routes().filter(okVia);
    const verdict = isDemo ? 'Демо-режим: база не проверялась.' : site ? 'Похоже, плохой интернет вообще.' : good.length === routes().length ? 'Всё доходит.'
      : good.length ? `Работает путь «${label[good[0]]}»: сайт сам будет ходить им.` : 'База недоступна ни одним путём с этой сети. Пришлите этот результат админу.';
    out.insertAdjacentHTML('beforeend', `<p><b>${esc(verdict)}</b></p>`); text += verdict + '\n';
    btn.disabled = false; copyBtn.disabled = false;
  };
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(text); msg.style.color = 'var(--acc-text)'; msg.textContent = 'Скопировано.'; } catch { msg.style.color = ''; msg.textContent = 'Не удалось скопировать: сделайте снимок экрана.'; } };
}

// ---------- админ: приглашения ----------
function viewInvites() {
  if (S.role !== 'admin') return go('menu', {}, true);
  $app.innerHTML = `${bar('Приглашения')}
    <p class="small muted" style="margin:0 0 12px">У каждого человека личная ссылка: по ней сайт знает, кто это, на любом телефоне. Ссылка показывается один раз, отправьте её сразу. Потерялась — выпустите новую, старая перестанет работать.</p>
    <div id="fresh"></div><div id="inv"><p class="muted">Загружаю…</p></div>
    <div class="card"><div class="label">Новый человек</div>
      <label class="lbl" for="iname">Имя</label><input type="text" id="iname" maxlength="40" autocomplete="off" placeholder="Как подписывать рецензии">
      <div class="err" id="msg"></div><button class="btn accent block" id="mk" style="margin-top:12px">Создать приглашение</button></div>`;
  const $ = (sel) => $app.querySelector(sel); const msg = $('#msg');
  const urlFor = (key) => `${location.origin}${location.pathname}#k=${key}`;
  const showLink = (name, key) => {
    const url = urlFor(key);
    $('#fresh').innerHTML = `<div class="card" style="border-color:var(--acc)"><div class="label">Ссылка для: ${esc(name)}</div>
      <p class="small muted" style="margin:8px 0">Покажу один раз. Скопируйте и отправьте человеку.</p>
      <div class="row"><input type="text" id="flink" readonly value="${esc(url)}" style="font-family:var(--mono);font-size:12px"><button class="btn" id="fcopy">Копировать</button></div></div>`;
    $('#fcopy').onclick = async () => { try { await navigator.clipboard.writeText(url); msg.style.color = 'var(--acc-text)'; msg.textContent = 'Скопировано.'; } catch { $('#flink').select(); msg.style.color = ''; msg.textContent = 'Выделено: скопируйте вручную.'; } };
    $('#flink').select();
  };
  const paint = async () => {
    let list;
    try { list = await api.listInvites(); } catch (e) { if ($('#inv')) $('#inv').innerHTML = '<p class="err">Не удалось загрузить список.</p>'; return; }
    if (!$('#inv')) return; // пока грузилось, открыли другой экран
    $('#inv').innerHTML = list.map((m) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><b>${esc(m.name)}</b><span class="small muted">${m.has_key ? 'ссылка выдана' : 'ссылки нет'} · рецензий ${m.reviews}</span></div>
      <div class="row wrap" style="margin-top:10px"><button class="btn" data-rot="${esc(m.author)}">Новая ссылка</button>${m.has_key ? `<button class="btn danger" data-rev="${esc(m.author)}">Отозвать</button>` : ''}${m.reviews === 0 ? `<button class="btn danger" data-delm="${esc(m.author)}">Удалить</button>` : ''}</div></div>`).join('');
    $('#inv').querySelectorAll('[data-rot]').forEach((b) => { b.onclick = () => {
      const m = list.find((x) => x.author === b.dataset.rot);
      if (m.has_key && !confirm(`Старая ссылка ${m.name} перестанет работать. Выпустить новую?`)) return;
      guard(async () => { showLink(m.name, await api.rotateInvite(m.author)); msg.textContent = ''; await paint(); }, msg);
    }; });
    $('#inv').querySelectorAll('[data-rev]').forEach((b) => { b.onclick = () => {
      const m = list.find((x) => x.author === b.dataset.rev);
      if (confirm(`Отозвать доступ у ${m.name}? Рецензии останутся.`)) guard(async () => { await api.revokeInvite(m.author); await paint(); }, msg);
    }; });
  };
  $('#inv').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delm]'); if (!b) return;
    const m = b.closest('.card').querySelector('b').textContent;
    if (confirm(`Удалить ${m} из списка? У этого человека нет рецензий.`)) guard(async () => { await api.deleteInvite(b.dataset.delm); await paint(); }, msg);
  });
  $('#mk').onclick = () => {
    const name = $('#iname').value.trim();
    if (!name) { msg.style.color = ''; msg.textContent = 'Введите имя.'; return; }
    guard(async () => { const r = await api.createInvite(name); $('#iname').value = ''; msg.textContent = ''; showLink(name, r.key); await paint(); }, msg);
  };
  paint();
}

// ---------- админ: правка места ----------
function viewEditPlace() {
  const s = S.role === 'admin' ? sumById(cur.p.id) : null;
  if (!s) return go('menu', {}, true);
  const p = s.place; const draft = { name: p.name, kind: p.kind || '', address: p.address, lat: p.lat, lon: p.lon };
  $app.innerHTML = `${bar('Изменить место')}<form id="f" autocomplete="off">
    <label class="lbl" for="en">Название</label><input type="text" id="en" maxlength="120" value="${esc(p.name)}">
    <span class="lbl">Кухня</span><div id="ek">${kindTiles(KINDS.includes(p.kind) ? p.kind : '', true)}</div>
    <label class="lbl" for="ea">Адрес</label><input type="text" id="ea" maxlength="300" value="${esc(p.address)}">
    <div class="small muted" style="margin-top:8px">Точка на карте: нажмите или перетащите булавку.</div><div id="pickmap"></div>
    <div class="err" id="msg"></div><button class="btn accent block" id="save" style="margin-top:14px">Сохранить</button></form>`;
  mountPicker('pickmap', { lat: p.lat, lon: p.lon }, (c) => { draft.lat = c.lat; draft.lon = c.lon; });
  const msg = $app.querySelector('#msg');
  if (!KINDS.includes(draft.kind)) draft.kind = ''; // старый тип не из списка: админ выбирает кухню заново
  const ek = $app.querySelector('#ek');
  ek.onclick = (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; draft.kind = draft.kind === b.dataset.kind ? '' : b.dataset.kind; ek.innerHTML = kindTiles(draft.kind, true); };
  $app.querySelector('#save').onclick = (e) => {
    e.preventDefault();
    draft.name = $app.querySelector('#en').value.trim(); draft.address = $app.querySelector('#ea').value.trim();
    if (!draft.name || !draft.address) { msg.textContent = 'Нужны название и адрес.'; return; }
    guard(async () => { await api.savePlace({ id: p.id, ...draft }); await refreshAfterWrite('Место сохранено, но список ещё не обновился: связь плохая.'); go('detail', { id: p.id }, true); }, msg);
  };
}

// ---------- список ----------
const LST = { q: '', sort: 'score', min: '0', tab: 'rated' };
// обложки баннеров 3 звёзд: миниатюры первых фото, одним запросом на все баннеры; запоминаются (null = фото нет)
const bannerPhotos = new Map();
async function paintBanners() {
  const els = [...$app.querySelectorAll('.item.top .ph')];
  const need = els.map((e) => Number(e.dataset.pid)).filter((id) => !bannerPhotos.has(id));
  if (need.length) {
    try {
      const got = await api.getCovers(need);
      need.forEach((id) => bannerPhotos.set(id, null));
      got.forEach((c) => bannerPhotos.set(c.place_id, `data:image/jpeg;base64,${c.data}`));
    } catch { return; }
  }
  els.forEach((el) => { const src = bannerPhotos.get(Number(el.dataset.pid)); if (src && el.isConnected) { el.style.backgroundImage = `url("${src}")`; el.classList.add('has'); } });
}
// «Хочу сходить»: место без рецензий, добавляется по ссылке из карт прямо в списке
const W = { link: '', note: '', np: null, kindsOpen: false };
function viewList() {
  const host = $app;
  const redraw = () => { const prev = $app; $app = host; try { viewList(); } finally { $app = prev; } };
  const nRated = S.sums.filter((s) => s.count).length; const nWant = S.sums.length - nRated;
  const tabs = `<div class="tabs" role="tablist">${[['rated', `Оценённые · ${nRated}`], ['want', `Хочу сходить · ${nWant}`]].map(([k, t]) => `<button type="button" role="tab" class="tab${LST.tab === k ? ' on' : ''}" aria-selected="${LST.tab === k}" data-tab="${k}">${t}</button>`).join('')}</div>`;
  if (LST.tab === 'want') {
    $app.innerHTML = `${bar('Места')}${DESK.matches ? askGoHtml() : ''}${tabs}<div id="want"></div>`;
    $app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { LST.tab = b.dataset.tab; redraw(); }; });
    paintWant(host, redraw);
    return;
  }
  $app.innerHTML = `${bar('Места')}${DESK.matches ? askGoHtml() : ''}${tabs}
    <input type="search" id="q" placeholder="Поиск по названию или адресу" value="${esc(LST.q)}">
    <div class="row" style="margin:8px 0 12px"><select id="sort" aria-label="Сортировка">
      ${[['score', 'Сначала лучшие'], ['stars', 'По звёздам'], ['taste', 'По вкусу'], ['name', 'По названию'], ['new', 'Сначала новые']].map(([v, n]) => `<option value="${v}" ${LST.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="min" aria-label="Минимум звёзд">${[['0', 'Любые'], ['1', '1+ звезда'], ['2', '2+ звезды'], ['3', '3 звезды']].map(([v, n]) => `<option value="${v}" ${LST.min === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div id="items"></div>`;
  const paint = () => {
    // мало данных: звёзды не показываются, при фильтре по звёздам такие места не берём
    let xs = searchSummaries(S.sums.filter((s) => s.count), LST.q).filter((s) => Number(LST.min) === 0 || (!isThin(s) && (s.stars ?? -1) >= Number(LST.min)));
    xs = sortSummaries(xs, LST.sort);
    const split = RATED_SORTS.has(LST.sort); let dividerDone = false;
    const sel = (s) => (cur.view === 'detail' && cur.p.id === s.place.id ? ' sel' : '');
    const card = (s) => s.stars === 3 && !isThin(s) ? `<button class="item top${sel(s)}" data-act="go" data-view="detail" data-id="${s.place.id}">
      <div class="ph" data-pid="${s.place.id}"></div><div class="shade"></div>
      <div class="lbl3"><b>3 ЗВЕЗДЫ</b><span>· ${fmtPrice(s.price) ? `₽ ${fmtPrice(s.price).replace(' ₽', '')}` : 'ЕХАТЬ СПЕЦИАЛЬНО'}</span></div>
      <div class="bot"><div class="txt"><div class="nm">${esc(s.place.name)}</div><div class="meta">${esc(s.place.address)}</div></div><div class="sc">${fmt(s.score)}</div></div></button>`
      : isThin(s) ? `<button class="item thin${sel(s)}" data-act="go" data-view="detail" data-id="${s.place.id}">
      <div class="t"><span>${esc(s.place.name)}</span>${placeBadge(s)}</div>
      <div class="meta">${esc(s.place.address)}</div>
      <div class="chips"><span class="chip">${esc(s.place.kind || 'место')}</span><span class="chip">оценок ${s.count}</span></div></button>`
      : `<button class="item${sel(s)}" data-act="go" data-view="detail" data-id="${s.place.id}">
      <div class="t"><span>${esc(s.place.name)}</span>${stars(s.stars)}</div>
      <div class="meta">${esc(s.place.address)}</div>
      <div class="chips"><span class="chip" style="color:var(--acc-text);border-color:var(--ln2)">итог ${fmt(s.score)}</span>${priceChip(s.price)}<span class="chip">${esc(s.place.kind || 'место')}</span><span class="chip">вкус ${fmt(s.scores.taste)}</span><span class="chip">оценок ${s.count}</span>${((dd) => (dd?.kind === 'quality' ? '<span class="chip warn">разногласие</span>' : dd?.kind === 'trip' ? '<span class="chip">звёзды разные</span>' : ''))(disagreement(s.reviews))}</div></button>`;
    $app.querySelector('#items').innerHTML = xs.length ? xs.map((s) => {
      const div = split && isThin(s) && !dividerDone && (dividerDone = true) ? '<div class="divider"><span>МАЛО ДАННЫХ · ЖДУТ ВТОРОЙ РЕЦЕНЗИИ</span></div>' : '';
      return div + card(s);
    }).join('')
      : '<p class="muted">Ничего не найдено. Попробуйте убрать фильтры или <a href="#" data-act="go" data-view="rate">оцените новое место</a>.</p>';
    paintBanners();
  };
  $app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { LST.tab = b.dataset.tab; redraw(); }; });
  $app.querySelector('#q').oninput = (e) => { LST.q = e.target.value; paint(); };
  $app.querySelector('#sort').onchange = (e) => { LST.sort = e.target.value; paint(); };
  $app.querySelector('#min').onchange = (e) => { LST.min = e.target.value; paint(); };
  paint();
}

function paintWant(host, redraw) {
  const box = host.querySelector('#want'); if (!box) return;
  const list = S.sums.filter((s) => !s.count).sort((a, b) => String(b.place.created_at).localeCompare(String(a.place.created_at)));
  const np = W.np;
  const dups = np && (np.name || np.lat != null) ? findDuplicates(S.data.places, { name: np.name, lat: np.lat, lon: np.lon }) : [];
  box.innerHTML = `<div class="want-add"><div class="row"><input type="text" id="wlink" value="${esc(W.link)}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Вставьте ссылку из карт" aria-label="Ссылка на место из карт">
      <button type="button" class="btn accent" id="wadd" aria-label="Добавить место по ссылке">${ico('plus')}</button></div>
    <div class="small muted" id="wst" style="margin-top:6px">${esc(W.note || `Ссылка «Поделиться» из ${MAP_APPS}.`)}${np ? '' : ' <a href="#" id="wmanual">Без ссылки</a>'}</div>
    ${np ? `<label class="lbl" for="wn">Название</label><input type="text" id="wn" maxlength="120" value="${esc(np.name)}">
      <span class="lbl">Кухня${np.name ? ` для «${esc(np.name)}»` : ''}</span>${kindTiles(np.kind, W.kindsOpen)}
      <label class="lbl" for="wa">Адрес</label><input type="text" id="wa" maxlength="300" value="${esc(np.address)}">
      <div class="small muted" style="margin-top:6px">${np.lat != null ? 'Точка на карте стоит, её можно подвинуть.' : 'Поставьте точку на карте нажатием.'}</div><div id="wpick"></div>
      ${dups.length ? `<div class="notice">Похоже, такое место уже есть: ${dups.map((d) => `<a href="#" data-act="go" data-view="detail" data-id="${d.id}">${esc(d.name)}</a>`).join(', ')}.</div>` : ''}
      <div class="err" id="wmsg"></div>
      <div class="row" style="margin-top:12px"><button class="btn accent grow" id="wsave">Добавить в «Хочу сходить»</button><button class="btn" id="wcancel">Отмена</button></div>` : ''}</div>
    ${list.length ? list.map((s) => `<div class="wrow${cur.view === 'detail' && cur.p.id === s.place.id ? ' sel' : ''}"><button class="grow wmain" data-act="go" data-view="detail" data-id="${s.place.id}"><b>${esc(s.place.name)}</b>
      <small>${esc([s.place.kind || 'кухня не указана', s.place.added_by_name ? (s.place.mine ? 'добавили вы' : `добавил(а) ${s.place.added_by_name}`) : ''].filter(Boolean).join(' · '))}</small></button>
      <button class="btn sm" data-act="go" data-view="rate" data-id="${s.place.id}">Оценить</button>
      ${s.place.mine || S.role === 'admin' ? `<button class="icon-btn" data-wdel="${s.place.id}" aria-label="Убрать из «Хочу сходить»">${ico('x')}</button>` : ''}</div>`).join('')
      : '<p class="muted">Пока пусто. Вставьте ссылку на место, куда хотите сходить: автомат предложит его в режиме «Неизведанное».</p>'}`;
  const $ = (q) => box.querySelector(q);
  const keep = () => { if (!W.np) return; W.np.name = $('#wn').value; W.np.address = $('#wa').value; };
  $('#wlink').oninput = (e) => { W.link = e.target.value; };
  $('#wadd').onclick = async () => {
    W.link = $('#wlink').value.trim(); if (!W.link) { $('#wst').textContent = 'Сначала вставьте ссылку из карт.'; return; }
    keep(); const draft = W.np || { name: '', kind: '', address: '', lat: null, lon: null }; W.np = draft;
    $('#wadd').disabled = true;
    W.note = await resolvePlaceLink(W.link, draft, (t) => { const el = box.querySelector('#wst'); if (el) el.textContent = t; });
    if (W.np === draft && host.isConnected) redraw();
  };
  const man = $('#wmanual'); if (man) man.onclick = (e) => { e.preventDefault(); W.np = { name: '', kind: '', address: '', lat: null, lon: null }; W.note = ''; redraw(); };
  if (np) {
    $('#wn').onchange = () => { keep(); redraw(); }; // название попадает в подпись кухни и в проверку дублей
    box.querySelector('.kinds').onclick = (e) => {
      const k = e.target.closest('[data-kind]'); if (k) { keep(); np.kind = k.dataset.kind; redraw(); }
      if (e.target.closest('[data-kind-more]')) { keep(); W.kindsOpen = true; redraw(); }
    };
    if (window.L) mountPicker('wpick', np.lat != null ? np : null, (c) => { np.lat = c.lat; np.lon = c.lon; });
    $('#wcancel').onclick = () => { W.np = null; W.note = ''; W.link = ''; W.kindsOpen = false; redraw(); };
    $('#wsave').onclick = () => {
      keep(); const miss = [];
      if (!np.name.trim()) miss.push('название'); if (!np.kind) miss.push('кухню'); if (!np.address.trim()) miss.push('адрес'); if (np.lat == null) miss.push('точку на карте');
      if (miss.length) { $('#wmsg').textContent = `Не заполнено: ${miss.join(', ')}.`; return; }
      const btn = $('#wsave'); btn.disabled = true; btn.textContent = 'Добавляю…';
      guard(async () => {
        await api.savePlace({ name: np.name.trim(), kind: np.kind, address: np.address.trim(), lat: np.lat, lon: np.lon });
        W.np = null; W.note = ''; W.link = ''; W.kindsOpen = false;
        await refreshAfterWrite('Место добавлено, но список ещё не обновился: связь плохая.'); render();
      }, $('#wmsg')).finally(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Добавить в «Хочу сходить»'; } });
    };
  }
  box.querySelectorAll('[data-wdel]').forEach((b) => { b.onclick = () => {
    const s = sumById(Number(b.dataset.wdel));
    if (!s || !confirm(`Убрать «${s.place.name}» из «Хочу сходить»?`)) return;
    guard(async () => { await api.deletePlace(s.place.id); await refreshAfterWrite('Место убрано, но список ещё не обновился: связь плохая.'); render(); }, b.closest('.wrow'));
  }; });
}

// ---------- карточка заведения ----------
function viewDetail() {
  const s = sumById(cur.p.id);
  if (!s) return go('list', {}, true);
  const p = s.place; const mine = s.reviews.find((r) => r.mine); const admin = S.role === 'admin';
  const d = disagreement(s.reviews);
  const vs = s.reviews.map((r) => r.verdict);
  $app.innerHTML = `${bar('')}
    <div class="ph-head"><div class="grow"><div class="label">${esc(p.kind || 'место')}</div><h1>${esc(p.name)}</h1><div class="muted small" style="margin-top:8px">${esc(p.address)}</div></div>
      ${s.score == null ? '' : isThin(s) ? `<div style="text-align:right;flex:none">${thinTag(s)}</div>` : `<div style="text-align:right;flex:none"><div class="big ${scoreClass(s.score)}">${fmt(s.score)}<small>/10</small></div><div style="margin-top:6px">${stars(s.stars)}</div></div>`}</div>
    ${s.count ? barsHtml(s.scores) : `<p class="muted">Пока нет рецензий: место в «Хочу сходить»${p.added_by_name ? ` (${p.mine ? 'добавили вы' : `добавил(а) ${esc(p.added_by_name)}`})` : ''}.</p>`}
    ${priceHtml(s)}
    ${s.count && isThin(s) ? `<div class="notice soft">${ico('info')}<span>Пока одна рецензия: звёзды и итог появятся после второй, а в слот-машину место попадёт после неё.</span></div>` : ''}
    <details class="how"><summary>Как считается итоговый балл</summary><p>Балл рецензии: примерно поровну качество по критериям (вкус весит больше всего, затем впечатление, сервис и чистота) и звёзды. Доступность и туалет показываются отдельно и в итог не входят. Строгость авторов слегка выравнивается, а к каждому месту подмешивается среднее по группе (как две лишние рецензии), чтобы одна оценка не решала всё. Звёзды места — медиана вердиктов; при ничьей берётся меньшее, а «ехать специально» не выдаётся, если кто-то поставил 0. Меньше двух рецензий — «мало данных»: такое место не попадает в слот-машину.</p></details>
    ${d?.kind === 'quality' ? `<div class="notice">${ico('warn')}<span>Мнения о качестве расходятся${d.scales.length ? `: сильно разные оценки: ${esc(d.scales.join(', ').toLowerCase())}` : ''}.</span></div>` : d?.kind === 'trip' ? `<div class="notice soft">${ico('info')}<span>Качество оценили похоже, но по-разному решили, стоит ли ехать специально (вердикты от ${Math.min(...vs)} до ${Math.max(...vs)}). Это не спор: у каждого своя мера «поехать специально».</span></div>` : ''}
    <div class="row" style="margin-top:14px"><a class="btn grow" href="${esc(mapsLink(p.lat, p.lon))}" target="_blank" rel="noopener">${ico('map')}<span class="lbl-long">Открыть в картах</span><span class="lbl-short">Карты</span></a>
      <button class="btn icon-only" id="share" aria-label="Поделиться местом" title="Поделиться">${ico('share')}</button>
      <button class="btn accent grow" data-act="go" data-view="rate" data-id="${p.id}">${mine ? '<span class="lbl-long">Изменить мою</span><span class="lbl-short">Изменить</span>' : 'Оценить'}</button></div>
    ${s.count ? `<div class="label" style="margin-top:26px">Рецензии · ${s.count}</div><div class="small muted" id="phnote" style="margin-top:6px">Загружаю фото…</div><div class="thread">${s.reviews.map((r, i) => postHtml(r, i === s.reviews.length - 1)).join('')}</div>` : ''}
    <div class="err" id="msg"></div>
    <div class="row wrap" style="margin-top:12px">${mine ? '<button class="btn danger" id="delrev">Удалить мою рецензию</button>' : ''}${admin ? `<button class="btn" data-act="go" data-view="editplace" data-id="${p.id}">Изменить место</button>` : ''}${!s.count && (p.mine || admin) ? '<button class="btn danger" id="delplace">Удалить заведение</button>' : ''}</div>`;
  const msg = $app.querySelector('#msg');
  $app.querySelector('#share').onclick = () => sharePlace(s, msg);
  const del = $app.querySelector('#delrev');
  if (del) del.onclick = () => confirm('Удалить вашу рецензию?') && guard(async () => { del.disabled = true; del.textContent = 'Удаляю…'; await api.deleteReview(mine.id); await refreshAfterWrite('Рецензия удалена, но список ещё не обновился: связь плохая.'); go('detail', { id: p.id }, true); }, msg).finally(() => { if (del.isConnected) { del.disabled = false; del.textContent = 'Удалить мою рецензию'; } });
  const dp = $app.querySelector('#delplace');
  if (dp) dp.onclick = () => confirm('Удалить заведение?') && guard(async () => { await api.deletePlace(p.id); await refreshAfterWrite('Заведение удалено, но список ещё не обновился: связь плохая.'); go('list', {}, true); }, msg);
  $app.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => confirm('Удалить эту рецензию?') && guard(async () => { b.disabled = true; await api.deleteReview(Number(b.dataset.del)); await refreshAfterWrite('Рецензия удалена, но список ещё не обновился: связь плохая.'); go('detail', { id: p.id }, true); }, msg).finally(() => { b.disabled = false; }); });
  if (s.count) loadPhotos(p.id);
}

// «Поделиться»: на телефоне — системное меню (Telegram, WhatsApp…), на компьютере — копия текста в буфер.
async function sharePlace(s, msg) {
  const site = location.origin + location.pathname; // без #k=: личный ключ никогда не уходит в ссылку
  const text = shareText(s, site);
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try { await navigator.share({ title: s.place.name, text }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); msg.style.color = 'var(--acc-text)'; msg.textContent = 'Скопировано: название, оценка, адрес и ссылки. Вставьте в чат.'; }
  catch {
    msg.style.color = ''; msg.innerHTML = '<textarea readonly id="sharetxt" style="min-height:120px"></textarea><span class="small muted">Скопируйте текст вручную.</span>';
    const ta = msg.querySelector('#sharetxt'); ta.value = text; ta.select();
  }
}

// ---------- фото ----------
const openPhoto = (src, id, isThumb) => {
  const box = Object.assign(document.createElement('div'), { className: 'lightbox', innerHTML: `<img src="${src}" alt="Фото">${isThumb ? '<span class="lb-load">загружаю полное фото…</span>' : ''}` });
  box.onclick = () => box.remove(); document.body.appendChild(box);
  if (isThumb) api.getPhoto(id).then((full) => { if (full && box.isConnected) box.querySelector('img').src = `data:image/jpeg;base64,${full}`; box.querySelector('.lb-load')?.remove(); })
    .catch(() => { const l = box.querySelector('.lb-load'); if (l) l.textContent = 'полное фото не загрузилось, показана уменьшенная копия'; });
};
async function loadPhotos(placeId) {
  let list;
  const note = $app.querySelector('#phnote');
  try { list = await api.getPhotos(placeId); } catch {
    // без фото страница остаётся рабочей, но говорим об этом и даём повторить
    if (note && cur.view === 'detail' && cur.p.id === placeId) { note.innerHTML = 'Фото не загрузились: связь плохая. <a href="#">Повторить</a>'; note.querySelector('a').onclick = (e) => { e.preventDefault(); note.textContent = 'Загружаю фото…'; loadPhotos(placeId); }; }
    return;
  }
  if (cur.view !== 'detail' || cur.p.id !== placeId) return;
  if (note) note.remove();
  for (const ph of list) {
    const box = [...$app.querySelectorAll('.thumbs[data-rid]')].find((b) => Number(b.dataset.rid) === ph.review_id); if (!box) continue;
    const src = `data:image/jpeg;base64,${ph.data}`;
    const wrap = Object.assign(document.createElement('span'), { className: 'thumb' });
    const img = Object.assign(document.createElement('img'), { src, alt: 'Фото', loading: 'lazy' });
    img.onclick = () => openPhoto(src, ph.id, ph.thumb); wrap.appendChild(img);
    if (ph.mine || S.role === 'admin') {
      const x = Object.assign(document.createElement('button'), { type: 'button', className: 'x', textContent: '×' });
      x.setAttribute('aria-label', 'Удалить фото');
      x.onclick = () => confirm('Удалить это фото?') && guard(async () => { await api.deletePhoto(ph.id); wrap.remove(); }, $app.querySelector('#msg'));
      wrap.appendChild(x);
    }
    box.appendChild(wrap);
  }
}
// Сжатие на телефоне: стороны до 1200 px, JPEG ≤ 250 КБ; при перерисовке теряются данные EXIF (в том числе место съёмки).
async function compress(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let max = 1200; let q = 0.76;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 250000) return blob;
    q -= 0.08; max *= 0.85;
  }
  throw new Error('photo_too_big');
}
// Миниатюра для списка и баннеров: сторона до 640 px, около 40–60 КБ.
async function makeThumb(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
}
const toBase64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });

// ---------- карта ----------
const needLeaflet = () => {
  if (window.L) return true;
  $app.insertAdjacentHTML('beforeend', '<div class="notice">Карта не загрузилась (нет файла библиотеки или нет сети).</div>');
  return false;
};
// Leaflet: если карту убрали посреди анимации масштаба (быстро переключили экран), его таймер срабатывает уже без карты
// и падает с «_leaflet_pos». Карты к этому моменту нет, так что просто пропускаем.
if (window.L && !L.Map.prototype._gasSafe) {
  for (const k of ['_onZoomTransitionEnd', '_onPanTransitionEnd']) {
    const orig = L.Map.prototype[k];
    if (orig) L.Map.prototype[k] = function (...a) { if (!this._mapPane) return undefined; return orig.apply(this, a); };
  }
  L.Map.prototype._gasSafe = true;
}
const tiles = () => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });

function viewMap() {
  $app.innerHTML = `${bar('Карта')}<div id="map"></div>`;
  if (!needLeaflet()) return;
  mountMainMap();
}
function viewMapPane() {
  $app.innerHTML = '<div id="map" class="map-pane"></div>';
  if (!needLeaflet()) return;
  mountMainMap(); setTimeout(() => S.map?.invalidateSize(), 60);
}
function mountMainMap() {
  S.map = L.map('map').setView(SPB, 11); tiles().addTo(S.map);
  const pts = [];
  S.sums.forEach((s) => {
    const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], html: `<div class="pin"><span>${isThin(s) ? '?' : s.stars}</span></div>` });
    const box = document.createElement('div');
    box.innerHTML = `<b>${esc(s.place.name)}</b><br>${isThin(s) ? `${thinTag(s)}<br><span class="small">оценок ${s.count}</span>` : `${stars(s.stars)} · итог ${fmt(s.score)}<br><span class="small">вкус ${fmt(s.scores.taste)} · оценок ${s.count}</span>`}<br><a href="#">Подробнее</a>`;
    box.querySelector('a').onclick = (e) => { e.preventDefault(); go('detail', { id: s.place.id }); };
    L.marker([s.place.lat, s.place.lon], { icon }).addTo(S.map).bindPopup(box);
    pts.push([s.place.lat, s.place.lon]);
  });
  if (pts.length) S.map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
}

// Выбор точки на карте (форма оценки и слот-машина). onPick вызывается при каждом изменении.
function mountPicker(elId, start, onPick) {
  if (!window.L) return;
  const el = document.getElementById(elId); if (!el) return;
  if (S.pick) S.pick.remove();
  const at = start ? [start.lat, start.lon] : SPB;
  const m = L.map(el).setView(at, start ? 16 : 11); tiles().addTo(m);
  const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], html: '<div class="pin"><span>•</span></div>' });
  const mk = L.marker(at, { icon, draggable: true, opacity: start ? 1 : 0 }).addTo(m);
  const set = (ll) => { mk.setLatLng(ll).setOpacity(1); onPick({ lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6) }); };
  m.on('click', (e) => set(e.latlng)); mk.on('dragend', () => set(mk.getLatLng()));
  S.pick = m;
  return { move: (c) => { m.setView([c.lat, c.lon], 16); mk.setLatLng([c.lat, c.lon]).setOpacity(1); } };
}

// Ссылка из приложения карт → np (заполняются только пустые поля): разбираем, короткую раскрывает база, адрес — по точке (OpenStreetMap).
// st(текст) — ход работы; возвращает итоговую подсказку для человека.
async function resolvePlaceLink(link, np, st) {
  let p = parseMapLink(link);
  if (!p) return `Не узнаю эту ссылку. Поддерживаются ${MAP_APPS}.`;
  if (p.short) {
    st('Раскрываю короткую ссылку…');
    let res = null; try { res = await api.resolveLink(p.url); } catch { /* ниже сообщение */ }
    const name0 = p.name; const full = typeof res === 'string' ? res : res?.url;
    p = full ? parseMapLink(full) : null;
    if (p && !p.name && name0) p.name = name0; // название из текста перед короткой ссылкой
    if (!p || p.short || p.lat == null) {
      report('link', 'не раскрылась короткая ссылка', `${String(link).slice(0, 300)}\n${JSON.stringify(res).slice(0, 1500)}`);
      if (name0 && !np.name.trim()) np.name = name0;
      return 'Не удалось раскрыть короткую ссылку. Откройте её в браузере и скопируйте полный адрес из адресной строки.';
    }
  }
  if (p.name && !np.name.trim()) np.name = p.name;
  if (p.address && !np.address.trim()) np.address = p.address;
  if (p.lat != null) {
    np.lat = p.lat; np.lon = p.lon; st('Точка поставлена, ищу адрес…');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ru&lat=${p.lat}&lon=${p.lon}`);
      const j = r.ok ? await r.json() : {}; const a = j.address || {};
      const street = [a.road || a.pedestrian || a.footway || a.square, a.house_number].filter(Boolean).join(', ');
      const addr = [street, a.city || a.town || a.village].filter(Boolean).join(', ') || j.display_name || '';
      if (!np.address.trim() && addr) np.address = addr;
    } catch { /* адрес можно ввести руками */ }
  }
  return p.lat != null ? `Из ссылки (${p.source}): точка${p.name ? ', название' : ''}${np.address ? ', адрес' : ''}.${p.name ? '' : ` Название в этой ссылке не передаётся — введите его сами${p.hint ? ` (в ссылке оно латиницей: «${p.hint}»)` : ''}.`} Проверьте и поправьте, если нужно.`
    : `${p.source}: в ссылке нет координат${p.name ? ' (название подставлено)' : ''}${p.source === '2ГИС' ? ', а сайт 2ГИС не пускает автоматические запросы' : ''} — поставьте точку на карте.`;
}

// Кухня: плитки из фиксированного списка (первые 8 и «Ещё…»), свободного ввода нет.
const KIND_MAIN = 8;
const kindTiles = (curKind, open) => {
  const all = open || KINDS.indexOf(curKind) >= KIND_MAIN; const list = all ? KINDS : KINDS.slice(0, KIND_MAIN);
  return `<div class="kinds" role="radiogroup" aria-label="Кухня">${list.map((k) => `<button type="button" class="kt${k === curKind ? ' on' : ''}" data-kind="${esc(k)}" role="radio" aria-checked="${k === curKind}">${esc(k)}</button>`).join('')}${all ? '' : `<button type="button" class="kt more" data-kind-more>Ещё ${KINDS.length - KIND_MAIN}…</button>`}</div>`;
};

// ---------- форма оценки ----------
let R = null; // состояние формы
const SCALE_KEYS = SCALES.filter(([k]) => k !== 'toilet');
const seg = (name, vals, labels, cur) => `<div class="seg" role="radiogroup">${vals.map((v, i) => `<label><input type="radio" name="${name}" value="${v}" ${String(cur) === String(v) ? 'checked' : ''}><span>${labels ? labels[i] : v}</span></label>`).join('')}</div>`;

function startForm(placeId) {
  const base = { name: S.name, anon: S.anon, placeId: placeId ?? null, mode: placeId ? 'exist' : 'new',
    np: { name: '', kind: '', address: '', lat: null, lon: null }, verdict: null, toilet_present: undefined, toilet: null, comment: '', found: [], photos: [] };
  SCALE_KEYS.forEach(([k]) => { base[k] = null; });
  R = base; prefill();
}
function prefill() {
  const r = R.placeId ? S.data.reviews.find((x) => x.place_id === R.placeId && x.mine) : null;
  if (!r) return;
  R.anon = r.author_name == null; if (r.author_name) R.name = r.author_name;
  ['verdict', 'toilet', 'comment', 'price_from', 'price_to', ...SCALE_KEYS.map(([k]) => k)].forEach((k) => { R[k] = r[k] ?? (k === 'comment' ? '' : null); });
  R.toilet_present = r.toilet_present ?? 'unknown';
}

function viewRate() {
  if (!R || cur.p.fresh !== false) { startForm(cur.p.id); cur.p.fresh = false; history.replaceState(cur, ''); }
  const dups = R.mode === 'new' && (R.np.name || R.np.lat != null) ? findDuplicates(S.data.places, { name: R.np.name, lat: R.np.lat, lon: R.np.lon }) : [];
  const tp = R.toilet_present;
  $app.innerHTML = `${bar('Оценить заведение')}<form id="f" autocomplete="off">
    <label class="lbl" for="an">Ваше имя</label>
    <input type="text" id="an" name="aname" maxlength="40" value="${esc(R.name)}" placeholder="Как подписать рецензию" ${R.anon ? 'disabled' : ''}>
    <label class="pill" style="display:inline-block;margin-top:10px"><input type="checkbox" name="anon" ${R.anon ? 'checked' : ''}><span>Анонимно (имя не сохранится)</span></label>
    <label class="lbl" for="pl">Заведение</label>
    <select id="pl" name="place"><option value="">＋ Новое заведение</option>${[...S.sums].sort((a, b) => a.place.name.localeCompare(b.place.name, 'ru')).map((s) => `<option value="${s.place.id}" ${R.placeId === s.place.id ? 'selected' : ''}>${esc(s.place.name)}</option>`).join('')}</select>
    ${R.mode === 'new' ? `
      <label class="lbl" for="mlink">Ссылка на место из карт</label>
      <div class="row"><input type="text" id="mlink" name="mlink" value="${esc(R.np.link || '')}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Вставьте ссылку «Поделиться»"><button type="button" class="btn" id="fromlink">Подставить</button></div>
      <div class="small muted" id="linkst" style="margin-top:6px">${esc(R.linkNote || `Поддерживаются ${MAP_APPS}. Нажмите «Подставить»: точка и адрес (и название, если оно есть в ссылке) подставятся сами.`)}</div>
      <label class="lbl" for="nm">Название</label><input type="text" id="nm" name="name" value="${esc(R.np.name)}" maxlength="120">
      <span class="lbl">Кухня · одна из списка</span>${kindTiles(R.np.kind, R.kindsOpen)}
      <label class="lbl" for="ad">Адрес</label>
      <div class="row"><input type="text" id="ad" name="address" value="${esc(R.np.address)}" maxlength="300"><button type="button" class="btn" id="find">Найти</button></div>
      ${R.found.length ? `<div>${R.found.map((f, i) => `<button type="button" class="item" data-found="${i}"><div class="meta">${esc(f.display_name)}</div></button>`).join('')}</div>` : ''}
      <div class="small muted" style="margin-top:6px">${R.np.lat != null ? `Точка выбрана (${R.np.lat}, ${R.np.lon}). Её можно двигать.` : 'Нажмите «Найти» или поставьте точку на карте нажатием.'}</div>
      <div id="pickmap"></div>
      ${dups.length ? `<div class="notice">Похоже, такое место уже есть: ${dups.map((d) => `<a href="#" data-pick="${d.id}">${esc(d.name)}</a>`).join(', ')}. Нажмите на название, чтобы оценить его.</div>` : ''}` : ''}
    <label class="lbl">Общий вердикт G.A.S.</label>
    ${seg('verdict', [0, 1, 2, 3], ['0', '1', '2', '3'], R.verdict)}
    <div class="small muted" style="margin-top:4px">3 — ехать специально · 2 — стоит заехать · 1 — хорошо, если окажусь рядом · 0 — не моё</div>
    ${SCALE_KEYS.map(([k, n]) => `<div class="scale-row"><div class="name">${n}</div>${seg(k, [1, 2, 3, 4, 5], null, R[k])}</div>`).join('')}
    <div class="scale-row"><div class="name">Туалет</div>${seg('toilet_present', ['yes', 'no', 'unknown'], ['Есть', 'Нет', 'Не помню'], tp === true ? 'yes' : tp === false ? 'no' : tp)}</div>
    ${tp === true ? `<div class="scale-row"><div class="name">Оценка туалета</div>${seg('toilet', [1, 2, 3, 4, 5], null, R.toilet)}</div>` : ''}
    <label class="lbl" for="pf">Цены <span class="muted" style="text-transform:none;letter-spacing:0">· средний чек на человека, если помните</span></label>
    <div class="row price-row"><label class="price-in"><span>от</span><input type="text" inputmode="numeric" id="pf" name="price_from" value="${R.price_from ?? ''}" placeholder="—" autocomplete="off"><span>₽</span></label>
      <label class="price-in"><span>до</span><input type="text" inputmode="numeric" id="pt" name="price_to" value="${R.price_to ?? ''}" placeholder="—" autocomplete="off"><span>₽</span></label></div>
    <div class="pills" style="margin-top:8px">${[['0', '500', 'до 500'], ['500', '1000', '500–1 000'], ['1000', '2000', '1 000–2 000'], ['2000', '', '2 000+'], ['', '', 'не помню']].map(([a, b, t]) => `<button type="button" class="chip-btn" data-price="${a}-${b}">${t}</button>`).join('')}</div>
    <label class="lbl" for="ph">Фото (до 5 на рецензию; сожмутся на телефоне)</label>
    <div class="form-thumbs">${R.photos.map((ph, i) => `<span class="thumb"><img src="${ph.url}" alt=""><button type="button" class="x" data-rm="${i}" aria-label="Убрать фото">×</button></span>`).join('')}</div>
    <input type="file" id="ph" accept="image/*" multiple ${R.photos.length >= 5 ? 'disabled' : ''}>
    <label class="lbl" for="cm">Комментарий</label><textarea id="cm" name="comment" maxlength="2000">${esc(R.comment)}</textarea>
    <div class="err" id="msg" role="alert"></div>
    <button class="btn accent block" id="send" style="margin-top:14px">${formNeedsCompare() ? `Сравнить · ${cmpTotal(formSession())}` : 'Отправить'}</button></form>`;

  const f = $app.querySelector('#f'); const msg = f.querySelector('#msg');
  const host = $app; // на ПК форма живёт в колонке: перерисовываем именно её
  const redraw = () => { const y = window.scrollY; const sc = host.scrollTop; const prev = $app; $app = host; try { viewRate(); } finally { $app = prev; } window.scrollTo(0, y); host.scrollTop = sc; };
  f.addEventListener('change', async (e) => {
    const { name, value } = e.target;
    if (e.target.id === 'ph') {
      msg.textContent = '';
      for (const file of [...e.target.files].slice(0, 5 - R.photos.length)) {
        try { const blob = await compress(file); R.photos.push({ blob, thumb: await makeThumb(blob), url: URL.createObjectURL(blob) }); }
        catch { msg.textContent = 'Не удалось подготовить одно из фото (формат или размер).'; }
      }
      redraw(); return;
    }
    if (name === 'anon') { R.anon = e.target.checked; redraw(); }
    else if (name === 'place') { R.placeId = value ? Number(value) : null; R.mode = value ? 'exist' : 'new'; prefill(); redraw(); }
    else if (name === 'verdict') R.verdict = Number(value);
    else if (name === 'toilet_present') { R.toilet_present = value === 'yes' ? true : value === 'no' ? false : 'unknown'; if (value !== 'yes') R.toilet = null; redraw(); }
    else if (name === 'toilet' || SCALE_KEYS.some(([k]) => k === name)) R[name] = Number(value);
  });
  f.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name === 'comment') R.comment = value;
    else if (name === 'aname') R.name = value;
    else if (name === 'mlink') R.np.link = value;
    else if (name === 'price_from' || name === 'price_to') R[name] = parsePrice(value);
    else if (['name', 'address'].includes(name)) { R.np[name] = value; if (name === 'name') clearTimeout(R.t), R.t = setTimeout(redrawKeepFocus, 600); }
  });
  const redrawKeepFocus = () => { const id = document.activeElement?.id; redraw(); if (id) document.getElementById(id)?.focus(); };
  f.addEventListener('click', (e) => {
    const kd = e.target.closest('[data-kind]'); if (kd) { R.np.kind = kd.dataset.kind; redraw(); return; }
    if (e.target.closest('[data-kind-more]')) { R.kindsOpen = true; redraw(); return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { const [gone] = R.photos.splice(Number(rm.dataset.rm), 1); URL.revokeObjectURL(gone.url); redraw(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr) { const [a, b] = pr.dataset.price.split('-'); R.price_from = a === '' ? null : Number(a); R.price_to = b === '' ? null : Number(b); redraw(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { e.preventDefault(); R.placeId = Number(pk.dataset.pick); R.mode = 'exist'; prefill(); redraw(); }
    const fd = e.target.closest('[data-found]'); if (fd) { const x = R.found[fd.dataset.found]; R.np.lat = +(+x.lat).toFixed(6); R.np.lon = +(+x.lon).toFixed(6); R.np.address = R.np.address || x.display_name; R.found = []; redraw(); }
  });
  const fromLink = async () => {
    const np = R.np;
    const note = await resolvePlaceLink(np.link, np, (t) => { const el = f.querySelector('#linkst'); if (el) el.textContent = t; });
    if (!R || R.np !== np) return; // форму уже закрыли
    R.linkNote = note; redraw();
  };
  const fl = f.querySelector('#fromlink');
  if (fl) fl.onclick = () => { R.np.link = f.querySelector('#mlink').value; fromLink(); }; // раскрываем только по нажатию
  const find = f.querySelector('#find');
  if (find) find.onclick = async () => {
    const q = R.np.address || R.np.name; if (!q.trim()) { msg.textContent = 'Введите адрес или название.'; return; }
    find.disabled = true; msg.textContent = '';
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ru&q=${encodeURIComponent(q)}`);
      R.found = r.ok ? await r.json() : [];
      if (!R.found.length) msg.textContent = 'Адрес не найден. Поставьте точку на карте вручную.'; else redraw();
    } catch { msg.textContent = 'Поиск адреса недоступен. Поставьте точку на карте вручную.'; }
    setTimeout(() => { find.disabled = false; }, 1100); // Nominatim: не чаще 1 запроса в секунду
  };
  if (R.mode === 'new') {
    if (!window.L) f.querySelector('#pickmap').outerHTML = '<div class="notice">Карта не загрузилась: найдите адрес кнопкой «Найти».</div>';
    else mountPicker('pickmap', R.np.lat != null ? R.np : null, (c) => { R.np.lat = c.lat; R.np.lon = c.lon; });
  }

  f.querySelector('#send').onclick = (e) => {
    e.preventDefault(); msg.textContent = '';
    const miss = formMissing();
    if (miss.length) { msg.textContent = `Не заполнено: ${miss.join(', ')}.`; return; }
    if (formNeedsCompare()) { CMP = { kind: 'form', s: formSession(), started: true }; go('compare'); return; } // «Отправить» — после сравнений
    submitReview(e.target, msg, []);
  };
}
// Чего не хватает в форме рецензии.
function formMissing() {
  const miss = [];
  if (!R.anon && !R.name.trim()) miss.push('имя (или «Анонимно»)');
  if (R.mode === 'new') {
    if (!R.np.name.trim()) miss.push('название'); if (!R.np.kind) miss.push('кухню'); if (!R.np.address.trim()) miss.push('адрес');
    if (R.np.lat == null) miss.push('точку на карте');
  } else if (!R.placeId) miss.push('заведение');
  if (R.verdict == null) miss.push('общий вердикт');
  SCALE_KEYS.forEach(([k, n]) => { if (R[k] == null) miss.push(n.toLowerCase()); });
  if (R.toilet_present === undefined) miss.push('туалет (есть / нет / не помню)');
  else if (R.toilet_present === true && R.toilet == null) miss.push('оценку туалета');
  return miss;
}
// Сохранить рецензию (и фото), затем ответы сравнений: answers [{a, b, r}], где новое место пока записано как NEW_ID.
async function submitReview(btn, msg, answers) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Отправляю…';
  await guard(async () => {
    let id = R.placeId;
    if (R.mode === 'new') id = await api.savePlace({ name: R.np.name.trim(), kind: R.np.kind, address: R.np.address.trim(), lat: R.np.lat, lon: R.np.lon });
    await api.saveReview({
      place_id: id, name: R.name.trim(), anon: R.anon, avatar_seed: R.anon ? null : S.seed, verdict: R.verdict, access: R.access, taste: R.taste, service: R.service, clean: R.clean, impression: R.impression,
      toilet_present: R.toilet_present === 'unknown' ? null : R.toilet_present, toilet: R.toilet, comment: R.comment.trim(),
      price_from: R.price_from ?? null, price_to: R.price_to ?? null,
    });
    let failed = 0;
    for (const [i, ph] of R.photos.entries()) {
      btn.textContent = `Загружаю фото ${i + 1} из ${R.photos.length}…`;
      try { await api.addPhoto(id, await toBase64(ph.blob), await toBase64(ph.thumb)); } catch (err) { if (err instanceof ApiError && err.kind === 'bad_code') throw err; failed++; }
      URL.revokeObjectURL(ph.url);
    }
    if (answers.length) {
      btn.textContent = 'Сохраняю сравнения…';
      const fix = (x) => (x === NEW_ID ? id : x);
      await saveCmps(answers.map((x) => ({ a: fix(x.a), b: fix(x.b), r: x.r })), [...new Set([...myPlaceIds(), id])]);
    }
    S.anon = R.anon; ls.set('gas_anon', S.anon ? '1' : '0');
    if (!R.anon) { S.name = R.name.trim(); ls.set('gas_name', S.name); }
    R = null; CMP = null; await refreshAfterWrite('Рецензия сохранена, но список ещё не обновился: связь плохая.'); go('detail', { id }, true);
    if (failed) alert(`Рецензия сохранена, но ${failed} фото не загрузились (возможно, уже 5 фото или нет связи). Добавьте их через «Изменить мою рецензию».`);
  }, msg);
  if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
}

// ---------- оценка сравнением (свайпы) ----------
// Карточка — место, где вы уже были; вправо: «оно понравилось больше», влево: «меньше», вверх: «одинаково».
// Ответы дают личный порядок мест (Брэдли–Терри), он сдвигает балл ваших рецензий не больше чем на ±RATING.cmpMax.
const NEW_ID = -1; // новое место, у которого ещё нет номера в базе
let CMP = null; // { kind: 'form' | 'first', s: сессия, started, ranked, pending, total, done, unsaved }
const cmpReady = () => !!S.data && Array.isArray(S.data.my_cmp); // без migration-17 сравнения выключены
const myPlaceIds = () => S.sums.filter((s) => s.reviews.some((r) => r.mine)).map((s) => s.place.id);
const myCmps = () => readCmps(S.data?.my_cmp);
function formSession() {
  const target = R.mode === 'new' ? NEW_ID : R.placeId;
  return cmpStart(target, myPlaceIds().filter((id) => id !== target), myCmps());
}
const formNeedsCompare = () => cmpReady() && !!R && cmpNext(formSession()) != null;
// Сохранить ответы и пересчитать поправки ко всем своим рецензиям.
async function saveCmps(items, ids) {
  const all = [...myCmps(), ...items];
  const adj = cmpAdjustments(ids, all);
  await api.saveComparisons(items, [...adj].map(([place_id, v]) => ({ place_id, adj: v })));
  if (S.data) S.data.my_cmp = all.map((c) => [c.a, c.b, c.r]); // пока данные не обновились, считаем уже с новыми ответами
}
// Обязательный первый раз: свои места, которые ещё ни разу не сравнивались.
const needFirst = () => cmpReady() && cmpUnranked(myPlaceIds(), myCmps()).length > 0;
const FIRST_FREE = new Set(['compare', 'net', 'news', 'me', 'invites', 'errors']); // экраны, куда пускаем и до сравнений
function startFirst() {
  const my = myPlaceIds(); const cmps = myCmps();
  const ranked = myOrder(my, cmps); const pending = cmpUnranked(my, cmps);
  // самые любимые по звёздам — первыми
  const verdict = (id) => sumById(id)?.reviews.find((r) => r.mine)?.verdict ?? 0;
  pending.sort((a, b) => verdict(b) - verdict(a));
  if (!ranked.length) ranked.push(pending.shift());
  const target = pending.shift();
  CMP = { kind: 'first', ranked, pending, s: cmpStart(target, ranked, cmps, { first: true }), started: false, total: estimateFirst(ranked.length, pending.length + 1), done: 0 };
}
const estimateFirst = (have, add) => { let t = 0; for (let k = 0; k < add; k++) t += Math.ceil(Math.log2(have + k + 1)); return t; };
const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many);

function viewCompare() {
  if (!CMP && needFirst()) startFirst();
  if (!CMP || (CMP.kind === 'form' && !R)) { CMP = null; return go('menu', {}, true); }
  drawCompare($app);
}
function placeCover(s, cls = '') {
  const ph = bannerPhotos.get(s.place.id);
  return ph ? `<span class="cov ${cls}" style="background-image:url('${ph}')"></span>`
    : `<span class="cov ${cls}">${posterSvg(s.place, { label: s.place.name })}${cls ? '' : `<i class="cov-kind" style="color:${kindColor(s.place.kind)}">${esc((s.place.kind || 'место').toUpperCase())}</i>`}</span>`;
}
function drawCompare(host) {
  const prev = $app; $app = host;
  try { drawCompareIn(host); } finally { $app = prev; }
}
function drawCompareIn(host) {
  const c = CMP; const first = c.kind === 'first';
  if (S.keyFn) { document.removeEventListener('keydown', S.keyFn); S.keyFn = null; }
  if (first && !c.started) {
    const n = myPlaceIds().length;
    $app.innerHTML = `${bar('Сравните свои места', false)}<div class="cmp-intro">
      <span class="label" style="color:var(--acc-text)">Новое в G.A.S.</span>
      <h2>Что понравилось больше?</h2>
      <p>У вас ${n} ${plural(n, 'рецензия', 'рецензии', 'рецензий')}. Пара минут: смахивайте карточки — вправо, если место понравилось больше, влево — если меньше, вверх — одинаково. Так рейтинг станет точнее, а звёзды останутся как были.</p>
      <div class="row wrap"><span class="chip">~${c.total} ${plural(c.total, 'свайп', 'свайпа', 'свайпов')}</span><span class="chip">один раз</span><span class="chip">можно прервать</span></div>
      <button class="btn accent block" id="cgo" style="margin-top:18px">Начать</button>
      <p class="small muted">Пропустить нельзя, но можно закрыть сайт — продолжите со следующего входа.</p></div>`;
    $app.querySelector('#cgo').onclick = () => { c.started = true; drawCompare(host); };
    return;
  }
  const other = cmpNext(c.s);
  if (other == null) { finishCompare(host); return; }
  const target = c.s.target === NEW_ID ? { place: { id: NEW_ID, name: R?.np.name || 'Новое место', kind: R?.np.kind || '' }, reviews: [] } : sumById(c.s.target);
  const myV = (s) => s?.reviews.find((r) => r.mine)?.verdict;
  const tVerdict = c.kind === 'form' ? R?.verdict : myV(target);
  const step = first ? c.done + c.s.answers.length : c.s.answers.length;
  const total = Math.max(step + 1, first ? c.total : cmpTotal(c.s));
  const o = sumById(other);
  $app.innerHTML = `${bar(first ? 'Сравните свои места' : 'Сравнение', !first)}<div class="cmp">
    <div class="cmp-top"><span class="label">${step + 1} из ~${total}</span><span class="label">вверх — одинаково</span></div>
    <div class="cmp-bar"><i style="width:${Math.min(100, (step / total) * 100)}%"></i></div>
    <div class="cmp-target">${placeCover(target, 'sm')}
      <span class="grow"><span class="label" style="color:var(--acc-text)">${first ? 'Куда поставить' : 'Ваше новое'}</span><b>${esc(target.place.name)}</b></span>${tVerdict != null ? stars(tVerdict) : ''}</div>
    <h2 class="cmp-q">Это нравится больше?</h2>
    <div class="cmp-stage"><div class="cmp-card" id="ccard">${placeCover(o)}
      <div class="cmp-bd"><b>${esc(o.place.name)}</b><span class="small muted">${esc(o.place.kind || 'место')}${((w) => (w ? ` · вы были ${w === 'сегодня' ? w : `${w} назад`}` : ''))(ago(((r) => r?.updated_at || r?.created_at)(o.reviews.find((x) => x.mine))))}</span>${myV(o) != null ? stars(myV(o)) : ''}</div>
      <span class="stamp yes" id="syes">БОЛЬШЕ</span><span class="stamp no" id="sno">МЕНЬШЕ</span><span class="stamp same" id="ssame">ОДИНАКОВО</span></div></div>
    <div class="cmp-btns"><button class="cb no" data-ans="1" aria-label="Это нравится меньше">✕</button><button class="cb same" data-ans="0" aria-label="Одинаково">=</button><button class="cb yes" data-ans="-1" aria-label="Это нравится больше">♥</button></div>
    <div class="small muted dk-only" style="text-align:center">Клавиши: ← меньше · → больше · ↑ одинаково</div></div>`;
  prefetchCovers(c, host);
  const card = $app.querySelector('#ccard'); const g = G();
  let busy = false;
  // r: 1 — новое лучше (карточка «меньше»), -1 — карточка лучше, 0 — одинаково
  const answer = (r) => {
    if (busy || !card.isConnected) return; busy = true; sound('swipe'); buzz(10);
    const fly = r === 0 ? { y: -innerHeight, rotation: 0 } : { x: (r < 0 ? 1 : -1) * innerWidth, rotation: r < 0 ? 24 : -24 };
    let done = false;
    const next = () => { if (done) return; done = true; c.s = cmpAnswer(c.s, other, r); if (host.isConnected) drawCompare(host); };
    if (g && !calm()) { g.to(card, { ...fly, duration: 0.32, ease: 'power2.in', overwrite: true, onComplete: next }); setTimeout(next, 700); } // страховка: вкладка в фоне не крутит анимацию
    else next();
  };
  host.querySelectorAll('[data-ans]').forEach((b) => { b.onclick = () => answer(Number(b.dataset.ans)); });
  const stamp = (id, v) => { const el = host.querySelector(id); if (el) el.style.opacity = String(Math.max(0, Math.min(1, v))); };
  const stamps = (x, y) => { stamp('#syes', x / 110); stamp('#sno', -x / 110); stamp('#ssame', -y / 90 - Math.abs(x) / 200); };
  if (g && window.Draggable) {
    if (!S.dragReady) { g.registerPlugin(window.Draggable, ...(window.InertiaPlugin ? [window.InertiaPlugin] : [])); S.dragReady = true; }
    window.Draggable.create(card, {
      type: 'x,y',
      onDrag() { g.set(card, { rotation: this.x / 18 }); stamps(this.x, this.y); },
      onRelease() {
        const vx = window.InertiaPlugin?.getVelocity?.(card, 'x') || 0;
        if (this.x > 110 || vx > 900) answer(-1);
        else if (this.x < -110 || vx < -900) answer(1);
        else if (this.y < -90) answer(0);
        else { g.to(card, { x: 0, y: 0, rotation: 0, duration: 0.45, ease: 'elastic.out(1,0.6)' }); stamps(0, 0); }
      },
    });
    try { window.InertiaPlugin?.track?.(card, 'x'); } catch { /* без скорости — только по расстоянию */ }
  }
  S.keyFn = (e) => { const k = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: 0 }[e.key]; if (k === undefined || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return; e.preventDefault(); answer(k); };
  document.addEventListener('keydown', S.keyFn);
}
// обложки (первое фото) для мест сессии — одним запросом, как у баннеров; пришли — перерисовываем карточку
async function prefetchCovers(c, host) {
  if (c.coversAsked) return; c.coversAsked = true;
  const ids = [...new Set([...(c.s.order || []), ...(c.s.queue || []), ...(c.ranked || []), ...(c.pending || []), ...myPlaceIds(), c.s.target])].filter((id) => id > 0 && !bannerPhotos.has(id));
  if (!ids.length) return;
  try {
    const got = await api.getCovers(ids); ids.forEach((id) => bannerPhotos.set(id, null)); got.forEach((x) => bannerPhotos.set(x.place_id, `data:image/jpeg;base64,${x.data}`));
    if (got.length && host.isConnected && CMP === c && cur.view === 'compare') drawCompare(host);
  } catch { /* без фото — постеры */ }
}
function finishCompare(host) {
  const c = CMP;
  if (c.kind === 'first') {
    // место встало в личный порядок — сохраняем сразу (если закроют сайт, продолжат со следующего входа)
    const s = c.s; const ranked = [...s.order.slice(0, s.lo), s.target, ...s.order.slice(s.lo)];
    c.done += s.answers.length;
    if (s.answers.length) { const items = s.answers; saveCmps(items, myPlaceIds()).catch(() => { c.unsaved = (c.unsaved || []).concat(items); }); }
    c.ranked = ranked;
    if (c.pending.length) { const t = c.pending.shift(); c.s = cmpStart(t, ranked, myCmps().concat(c.unsaved || [], s.answers), { first: true }); drawCompare(host); return; }
    $app.innerHTML = `${bar('Сравните свои места', false)}<div class="cmp-intro"><h2>Готово!</h2><p>Ваш личный топ:</p>
      <ol class="cmp-top-list">${ranked.map((id) => `<li>${esc(sumById(id)?.place.name || '')}</li>`).join('')}</ol>
      <div class="err" id="cmsg"></div><button class="btn accent block" id="cdone">К сайту</button></div>`;
    sound('win');
    $app.querySelector('#cdone').onclick = () => guard(async () => {
      if (c.unsaved?.length) { await saveCmps(c.unsaved, myPlaceIds()); c.unsaved = []; }
      CMP = null; await refreshAfterWrite('Сравнения сохранены, но данные ещё не обновились: связь плохая.'); go('menu', {}, true);
    }, $app.querySelector('#cmsg'));
    return;
  }
  // форма: показываем, куда встало место, и только теперь — «Отправить»
  const ids = [...myPlaceIds().filter((id) => id !== c.s.target), c.s.target];
  const order = myOrder(ids, [...myCmps(), ...c.s.answers]); const pos = order.indexOf(c.s.target) + 1;
  const name = c.s.target === NEW_ID ? R?.np.name || 'Новое место' : sumById(c.s.target)?.place.name || '';
  $app.innerHTML = `${bar('Сравнение')}<div class="cmp-intro"><h2>Готово!</h2>
    <p>${esc(name)} — ${pos ? `${pos}-е место из ${order.length} у вас` : 'сравнения сохранятся вместе с рецензией'}.</p>
    <div class="err" id="cmsg"></div><button class="btn accent block" id="csend">Отправить рецензию</button>
    <button class="btn block" id="credo" style="margin-top:10px">Сравнить заново</button></div>`;
  sound('win');
  $app.querySelector('#csend').onclick = (e) => { if (!R) return go('rate', {}, true); submitReview(e.currentTarget, host.querySelector('#cmsg'), c.s.answers); };
  $app.querySelector('#credo').onclick = () => { c.s = formSession(); drawCompare(host); };
}

// ---------- автомат «Табло» ----------
// Три строки табло (кухня, чек, путь) перелистываются и останавливаются по очереди, потом «прибывает» место.
// Место выбирается заранее по весам (давно не были, ближе, балл), а барабаны показывают его кухню, чек и путь;
// «Держать» строку = следующие прокруты только среди мест с тем же значением. Три попытки — потом решено.
const T = { mode: ['tested', 'new', 'mix'].includes(ls.get('gas_mode')) ? ls.get('gas_mode') : 'mix', held: [null, null, null], tries: 0, last: null,
  win: null, reels: null, note: '', center: null, geo: 'idle', manual: false, spinning: false, visit: null, room: null, joinId: null, shown: 0 };
const G = () => window.gsap; // если GSAP не загрузился, всё работает без конфетти
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const MODES = [['tested', 'Проверенное'], ['new', 'Неизведанное'], ['mix', 'Микс']];
const ROWS = ['КУХНЯ', 'ЧЕК', 'ПУТЬ'];
// на табло короткие подписи (строка из 11 клеток); в данных и при «держать» — полные
const BOARD_SHORT = { 'Бургеры и фастфуд': 'Бургеры', 'Шашлык и мясо': 'Шашлык', 'Рамен и японская': 'Рамен', 'Азиатская разная': 'Азия', 'Пицца и итальянская': 'Пицца', 'дальше 10 км': '10+ км' };
const boardText = (v) => (v == null ? '—' : (BOARD_SHORT[v] || v).toUpperCase());
const AZ = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789';
const rndCh = () => AZ[Math.floor(Math.random() * AZ.length)];
const padC = (s, n) => { s = s.slice(0, n); const l = Math.floor((n - s.length) / 2); return ' '.repeat(l) + s + ' '.repeat(n - s.length - l); };
const flapsHtml = (s, cls = '') => [...s].map((c) => `<span class="fl${cls}">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');

// звук: ZzFX (vendor/zzfx, 10 КБ) подгружается при первом прокруте; выключатель запоминается
const SND = { on: ls.get('gas_sound') !== '0', fx: null };
async function sound(kind) {
  if (!SND.on) return;
  try {
    if (!SND.fx) { const m = await import('./vendor/zzfx/ZzFX.js'); m.ZZFX.volume = 0.25; SND.fx = m.zzfx; }
    const p = { tick: [0.25, 0, 1900, 0, 0, 0.012, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4], stop: [0.7, 0, 180, 0, 0.02, 0.07, 2, 0, 0, 0, 0, 0, 0, 1.5],
      win: [0.8, 0, 520, 0.01, 0.12, 0.25, 0, 1.2, 0, 0, 260, 0.07, 0.09], swipe: [0.35, 0.05, 420, 0.01, 0.02, 0.09, 4, 0, -12], jack: [1, 0, 660, 0.02, 0.3, 0.5, 0, 1, 0, 0, 330, 0.06, 0.1, 0, 0, 0, 0.05] }[kind];
    if (p) SND.fx(...p);
  } catch { SND.on = false; } // без звука автомат работает так же
}
const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* вибрация есть не везде */ } };

// Прокрут на табло: start() — строки листаются, finish(reels, name) — останавливаются по очереди и «прибывает» место.
function board(root, held) {
  const rows = [0, 1, 2].map((i) => root.querySelector(`#brow${i} .flaps`));
  const nameBox = root.querySelector('#bname');
  const n = rows[0].children.length; const nn = Number(nameBox.dataset.n);
  const flip = (el) => [...el.children].forEach((c) => { c.textContent = rndCh(); c.classList.add('go'); });
  const stopped = held.map((h) => h != null); let timer = 0; let ticks = 0;
  const run = () => { timer = setInterval(() => {
    rows.forEach((el, i) => { if (!stopped[i]) flip(el); });
    nameBox.querySelectorAll('.fl:not(.done)').forEach((c) => { c.textContent = rndCh(); c.classList.add('go'); });
    if (++ticks % 2 === 0) sound('tick');
  }, 70); };
  return {
    start() { if (!calm()) run(); },
    stop() { clearInterval(timer); },
    finish(reels, name) {
      return new Promise((done) => {
        const lines = boardLines(name, nn);
        const setName = (k) => { // k первых букв уже на месте
          let j = 0;
          nameBox.innerHTML = lines.map((l) => `<div class="nl">${[...padC(l, nn)].map((c) => { const ok = j++ < k; return `<span class="fl big${ok ? ' done' : ''}">${ok ? (c === ' ' ? '&nbsp;' : esc(c)) : esc(rndCh())}</span>`; }).join('')}</div>`).join('');
        };
        const setRow = (i) => { rows[i].innerHTML = flapsHtml(padC(boardText(reels[i]), n), reels[i] == null ? ' dim' : ''); };
        if (calm()) { clearInterval(timer); [0, 1, 2].forEach(setRow); setName(nn * 2); done(); return; }
        setName(0);
        const order = [0, 1, 2].filter((i) => !stopped[i]);
        order.forEach((i, k) => setTimeout(() => { stopped[i] = true; setRow(i); sound('stop'); buzz(12); }, 450 + k * 380));
        let k = 0;
        setTimeout(() => {
          const iv = setInterval(() => {
            k += 2; setName(k);
            if (k >= nn * lines.length) { clearInterval(iv); clearInterval(timer); done(); }
          }, 55);
        }, 450 + order.length * 380);
      });
    },
  };
}

function viewSlot() {
  if (T.visit !== cur) { // новый заход на экран: попытки и «держать» с нуля
    if (T.visit && !T.room) { T.tries = 0; T.held = [null, null, null]; T.win = null; T.reels = null; T.note = ''; }
    T.visit = cur;
  }
  const n = DESK.matches ? 13 : 11; const nn = DESK.matches ? 20 : 16;
  const room = () => T.room;
  const triesLeft = () => (room() ? room().tries_left : 3 - T.tries);
  const pool = () => {
    let xs = matchHeld(slotCandidates(S.sums, T.mode), T.held, T.center);
    if (room()) { const vetoed = new Set(room().spins.filter((s) => s.veto_name).map((s) => s.place_id)); xs = xs.filter((s) => !vetoed.has(s.place.id)); }
    return xs;
  };
  const pick = (xs) => { const ys = xs.length > 1 && T.last != null ? xs.filter((s) => s.place.id !== T.last) : xs; return pickWeighted(ys, slotWeights(ys, { center: T.center })); };
  const nameOf = () => (T.win ? T.win.place.name : 'Куда едем?');
  $app.innerHTML = `<header class="bar"><button class="icon-btn" data-act="back" aria-label="Назад">${ico('back')}</button><h1>Куда едем</h1>
      <button class="btn sm" id="together" aria-label="Крутить вместе с друзьями">${ico('people')}<span>Вместе</span></button>
      <button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>
    <div id="roomstrip"></div>
    <div class="slot-grid"><div class="slot-l">
      <div class="board" id="board">
        <div class="b-top"><span class="b-dot"></span><span class="grow b-ttl">ОТПРАВЛЕНИЯ</span><span id="btries"></span>
          <button type="button" class="b-snd" id="snd" aria-pressed="${SND.on}" aria-label="Звук">${ico(SND.on ? 'sound' : 'mute')}</button></div>
        <div class="b-modes" role="radiogroup" aria-label="Что крутим">${MODES.map(([id, t]) => `<button type="button" class="b-mode${T.mode === id ? ' on' : ''}" data-mode="${id}" role="radio" aria-checked="${T.mode === id}">${t}</button>`).join('')}</div>
        <div class="b-line"></div>
        ${ROWS.map((label, i) => `<div class="b-row" id="brow${i}"><span class="b-lbl">${label}</span><span class="flaps">${flapsHtml(padC(T.reels ? boardText(T.reels[i]) : '···', n), T.reels && T.reels[i] != null ? '' : ' dim')}</span>
          <button type="button" class="b-lock${T.held[i] != null ? ' on' : ''}" data-hold="${i}" aria-pressed="${T.held[i] != null}" aria-label="Держать: ${label.toLowerCase()}">${ico('lock')}</button></div>`).join('')}
        <div class="b-line"></div>
        <div class="b-lbl">ПРИБЫТИЕ</div>
        <div class="b-name" id="bname" data-n="${nn}">${boardLines(nameOf(), nn).map((l) => `<div class="nl">${flapsHtml(padC(l, nn), T.win ? ' big done' : ' big dim')}</div>`).join('')}</div>
      </div>
      <button class="spin" id="spin"></button>
      <div class="small muted" id="st" style="margin-top:10px"></div>
      <div id="pickwrap" class="${T.manual ? '' : 'hidden'}"><div id="pickmap"></div></div>
      <div class="row wrap" id="geoBtns" style="margin-top:8px"></div>
      <div class="small muted dk-only" style="margin-top:6px">Пробел — крутить</div>
    </div><div class="slot-r"><div id="out" aria-live="polite"></div><div id="resmap" class="res-map dk-only hidden"></div></div></div>`;
  const $ = (s) => $app.querySelector(s);
  const host = $app;

  const status = () => {
    if (T.geo === 'asking') return 'Определяю, где вы, чтобы посчитать путь…';
    if (!T.center) return 'Не знаю, где вы: строка «путь» пустая. Поставьте точку на карте, если нужен путь.';
    return `Путь считаю от ${T.manual ? 'выбранной точки' : 'вас'}.`;
  };
  const paint = () => {
    const left = triesLeft(); const used = 3 - left; const decided = left <= 0;
    const empty = pool().length === 0;
    $('#btries').textContent = decided ? '3/3 · РЕШЕНО' : `ПОПЫТКА ${Math.min(used + (T.spinning ? 0 : 1), 3)}/3`;
    const sp = $('#spin');
    sp.textContent = decided ? 'РЕШЕНО' : T.spinning ? 'КРУТИТСЯ…' : T.win || used ? 'ЕЩЁ РАЗ' : 'КРУТИТЬ';
    sp.disabled = T.spinning || decided || empty;
    $app.querySelectorAll('[data-hold]').forEach((b) => { const i = Number(b.dataset.hold); b.disabled = T.spinning || decided || !T.reels || T.reels[i] == null; });
    $app.querySelectorAll('[data-mode]').forEach((b) => { b.disabled = T.spinning; });
    $('#st').textContent = status();
    $('#geoBtns').innerHTML = `<button class="btn sm" id="setpt">${T.center ? 'Другая точка' : 'Поставить точку на карте'}</button>`;
    $('#setpt').onclick = () => { T.manual = true; $('#pickwrap').classList.remove('hidden'); mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paint(); }); };
    if (T.manual && !S.pick && !$('#pickwrap').classList.contains('hidden')) mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paint(); });
    if (!T.spinning && !T.win) {
      $('#out').innerHTML = empty ? `<div class="notice">${ico('warn')}<span>${T.held.some((h) => h != null) ? 'Под эти строки мест нет. Отпустите одну из них (замок справа).'
        : T.mode === 'new' ? 'Неизведанных мест нет: вы были везде. Добавьте место в «Хочу сходить» в списке мест или выберите «Проверенное».' : 'Пока нет мест с высоким итоговым баллом. Оцените что-нибудь!'}</span></div>`
        : `<div class="notice soft">${ico('info')}<span>Табло выберет кухню, чек и путь, и «прибудет» место. Замок справа держит строку: следующий прокрут будет только среди таких мест. Три попытки, потом решено.</span></div>`;
    }
    paintRoom();
  };

  // ---- «Вместе»: полоса комнаты, ссылка, вето ----
  const paintRoom = () => {
    const r = room(); const box = $('#roomstrip'); if (!box) return;
    $('#together').classList.toggle('hidden', !!r);
    if (!r) { box.innerHTML = ''; return; }
    const here = r.people.filter((p) => p.here || p.me);
    box.innerHTML = `<div class="roomstrip"><span class="r-avs">${here.slice(0, 5).map((p) => `<span class="r-av">${avatarSvg(p.seed ?? 1, { size: 30, label: p.name })}</span>`).join('')}</span>
      <span class="grow"><b>Едем вместе</b><small>${esc(here.map((p) => (p.me ? 'вы' : p.name)).join(', '))}</small></span>
      <button class="btn sm" id="rlink">${ico('share')}<span>Ссылка</span></button><button class="icon-btn" id="rleave" aria-label="Выйти из комнаты">×</button></div><div class="err" id="rmsg"></div>`;
    $('#rlink').onclick = () => shareRoom(r.id, $('#rmsg'));
    $('#rleave').onclick = () => { leaveRoom(); T.win = null; T.reels = null; T.tries = 0; paint(); };
  };
  const leaveRoom = () => { T.room = null; clearInterval(T.pollT); T.pollT = 0; };
  const joinRoom = (st) => {
    T.room = st; T.shown = st.spins.length; T.tries = 0;
    const lastSpin = st.spins[st.spins.length - 1];
    if (lastSpin && sumById(lastSpin.place_id)) { T.win = sumById(lastSpin.place_id); T.reels = lastSpin.reels; T.last = lastSpin.place_id; }
    clearInterval(T.pollT); T.pollT = setInterval(poll, 3000);
  };
  async function poll() {
    if (!T.room || T.spinning || document.hidden || !host.isConnected) return;
    let st; try { st = await api.roomGet(T.room.id); } catch (e) {
      if (e instanceof ApiError && e.kind === 'rejected' && /no_room/.test(e.detail)) { leaveRoom(); T.note = 'Комната закрылась: прошло больше 12 часов.'; if (host.isConnected) paint(); }
      return;
    }
    if (!T.room || T.spinning || !host.isConnected) return;
    const fresh = st.spins.length > T.shown; const before = JSON.stringify(T.room.spins.map((s) => s.veto_name));
    T.room = st;
    if (fresh) { const s = st.spins[st.spins.length - 1]; T.shown = st.spins.length; await play(sumById(s.place_id), s.reels, [null, null, null]); }
    else if (before !== JSON.stringify(st.spins.map((s) => s.veto_name))) { reveal(false); paint(); }
    else paintRoom();
  }
  $('#together').onclick = () => guard(async () => {
    const st = await api.roomCreate(); joinRoom(st); T.win = null; T.reels = null; T.held = [null, null, null]; paint(); shareRoom(st.id, $('#rmsg'));
  }, $('#out'));

  // ---- прокрут ----
  async function play(win, reels, held) { // показать результат на табло (свой прокрут или чужой из комнаты)
    if (!win) return;
    T.spinning = true; paint();
    const b = board(host, held); b.start();
    await b.finish(reels, win.place.name);
    T.spinning = false; T.win = win; T.reels = reels; T.last = win.place.id;
    if (host.isConnected) { reveal(true); paint(); }
  }
  async function spin() {
    if (T.spinning || triesLeft() <= 0) return;
    const xs = pool(); if (!xs.length) return;
    T.note = '';
    if (!room()) { const win = pick(xs); T.tries++; return play(win, reelsOf(win, T.center), T.held); }
    // в комнате: сначала база принимает прокрут (кто-то мог крутить одновременно), табло листается, пока ждём
    T.spinning = true; paint(); $('#out').innerHTML = '';
    const b = board(host, T.held); b.start();
    const win = pick(xs); const reels = reelsOf(win, T.center);
    let st;
    try { st = await api.roomSpin(room().id, T.shown, win.place.id, reels); } catch (e) { b.stop(); T.spinning = false; paint(); guard(() => Promise.reject(e), $('#out')); return; }
    T.room = st; T.shown = st.spins.length;
    const s = st.spins[st.spins.length - 1];
    if (!st.accepted) T.note = st.tries_left <= 0 ? 'Попытки кончились: решено.' : 'Кто-то крутил одновременно с вами — вот его результат.';
    const w = s ? sumById(s.place_id) : null;
    if (!w) { b.stop(); T.spinning = false; paint(); return; }
    await b.finish(s.reels, w.place.name);
    T.spinning = false; T.win = w; T.reels = s.reels; T.last = w.place.id;
    if (host.isConnected) { reveal(true); paint(); }
  }

  // ---- результат ----
  function reveal(fx) {
    const win = T.win; if (!win) return;
    const km = T.center ? distanceKm(T.center.lat, T.center.lon, win.place.lat, win.place.lon) : null;
    const jack = jackpotOf(win);
    const tag = jack ? `ДЖЕКПОТ · ${jack}` : !win.count ? 'НЕИЗВЕДАННОЕ · ИЗ «ХОЧУ СХОДИТЬ»' : isThin(win) ? 'НЕИЗВЕДАННОЕ · МАЛО ОЦЕНОК'
      : win.reviews.some((r) => r.mine) ? 'ПРОВЕРЕННОЕ' : 'ПРОВЕРЕННОЕ · ВЫ ЗДЕСЬ НЕ БЫЛИ';
    const r = room(); const s = r ? r.spins[r.spins.length - 1] : null;
    const vetoed = !!s?.veto_name;
    const lastVeto = r ? [...r.spins].reverse().find((x) => x.veto_name) : null;
    const score = isThin(win) ? `<span class="thin-tag">${win.count ? 'МАЛО ДАННЫХ' : 'НЕТ ОЦЕНОК'}</span>` : `<div class="big ${scoreClass(win.score)}">${fmt(win.score)}<small>/10</small></div>`;
    $('#out').innerHTML = `<div class="result${jack && !vetoed ? ' jack' : ''}${vetoed ? ' vetoed' : ''}">
      <div class="r-tag">${vetoed ? `ВЕТО · ${esc(s.veto_me ? 'ВЫ' : s.veto_name.toUpperCase())}` : esc(tag)}</div>
      <div class="row" style="align-items:flex-start;gap:12px"><div class="grow"><h3>${esc(win.place.name)}</h3>
        <div class="muted small" style="margin-top:6px">${esc([win.place.kind, win.place.address, km != null ? `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} км` : ''].filter(Boolean).join(' · '))}</div></div>${score}</div>
      <div class="row" style="margin-top:10px;gap:10px">${isThin(win) ? '' : stars(win.stars)}<span class="small muted">${esc(fmtPrice(win.price) ? `${fmtPrice(win.price)} на человека` : 'цены пока неизвестны')}</span></div>
      ${s ? `<div class="small muted" style="margin-top:8px">Крутил${s.by_me ? 'и вы' : ` ${esc(s.by_name)}`} · попытка ${r.spins.filter((x) => !x.veto_name || x.n === s.n).length} из 3</div>` : ''}
      ${T.note ? `<div class="small" style="margin-top:8px;color:var(--vio)">${esc(T.note)}</div>` : ''}
      <div class="row" style="margin-top:14px">${vetoed ? '' : `<a class="btn accent grow" id="letsgo" href="${esc(mapsLink(win.place.lat, win.place.lon))}" target="_blank" rel="noopener">Едем!</a>`}
        ${r ? `<button class="btn veto" id="veto" ${!r.my_veto || vetoed ? 'disabled' : ''}>${r.my_veto ? 'Вето · у вас 1' : 'Вето потрачено'}</button>`
          : `<button class="btn icon-only" id="slotshare" aria-label="Поделиться местом" title="Поделиться">${ico('share')}</button>`}
        <button class="btn" data-act="go" data-view="detail" data-id="${win.place.id}">Подробнее</button></div>
      ${lastVeto && lastVeto !== s ? `<div class="small muted" style="margin-top:10px">${esc(lastVeto.veto_me ? 'Вы наложили' : `${lastVeto.veto_name} наложил(а)`)} вето на «${esc(sumById(lastVeto.place_id)?.place.name || 'место')}»</div>` : ''}
      <div class="err" id="slotmsg"></div></div>`;
    const lg = $('#letsgo'); if (lg) lg.onclick = () => { ls.set('gas_trip', JSON.stringify({ id: win.place.id, at: Date.now() })); };
    const sh = $('#slotshare'); if (sh) sh.onclick = () => sharePlace(win, $('#slotmsg'));
    const vb = $('#veto');
    if (vb) vb.onclick = () => guard(async () => {
      vb.disabled = true; const st = await api.roomVeto(r.id, s.n); T.room = st;
      T.note = st.accepted ? 'Вето принято: можно крутить ещё.' : 'Вето не прошло: кто-то уже крутил заново или вето потрачено.';
      if (st.spins.length > T.shown) { T.shown = st.spins.length; const x = st.spins[st.spins.length - 1]; T.win = sumById(x.place_id) || T.win; T.reels = x.reels; }
      reveal(false); paint();
    }, $('#slotmsg'));
    if (DESK.matches && window.L) {
      const m = $('#resmap'); m.classList.remove('hidden');
      if (S.map) { S.map.remove(); S.map = null; }
      S.map = L.map('resmap', { zoomControl: false, attributionControl: false }).setView([win.place.lat, win.place.lon], 15); tiles().addTo(S.map);
      L.marker([win.place.lat, win.place.lon], { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], html: `<div class="pin"><span>${isThin(win) ? '?' : win.stars}</span></div>` }) }).addTo(S.map);
    }
    if (!fx || vetoed) return;
    sound(jack ? 'jack' : 'win'); buzz(jack ? [20, 60, 20, 60, 40] : 25);
    const g = G(); if (calm() || !g) return;
    g.from('.result', { y: 24, autoAlpha: 0, duration: 0.45, ease: 'power3.out' });
    if (!jack) return;
    const bd = $('#board'); const colors = ['#C8F25A', '#8F82FF', '#FFB86B'];
    g.fromTo(bd, { boxShadow: '0 0 0 0 rgba(200,242,90,0)' }, { boxShadow: '0 0 40px 4px rgba(200,242,90,.45)', duration: 0.4, yoyo: true, repeat: 3 });
    for (let k = 0; k < 28; k++) {
      const el = Object.assign(document.createElement('i'), { className: 'fx' }); el.style.background = colors[k % 3];
      el.style.left = `${bd.clientWidth / 2}px`; el.style.top = `${bd.clientHeight - 40}px`; bd.appendChild(el);
      g.fromTo(el, { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1 }, { x: rnd(-170, 170), y: rnd(-150, 40), rotation: rnd(-260, 260), scale: 0, duration: 1.1, ease: 'power2.out', onComplete: () => el.remove() });
    }
  }

  // ---- кнопки ----
  $('#spin').onclick = spin;
  $('#snd').onclick = (e) => { SND.on = !SND.on; ls.set('gas_sound', SND.on ? '1' : '0'); e.currentTarget.setAttribute('aria-pressed', String(SND.on)); e.currentTarget.innerHTML = ico(SND.on ? 'sound' : 'mute'); if (SND.on) sound('tick'); };
  $app.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => {
    T.mode = b.dataset.mode; ls.set('gas_mode', T.mode); T.held = [null, null, null];
    $app.querySelectorAll('[data-mode]').forEach((x) => { const on = x.dataset.mode === T.mode; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
    $app.querySelectorAll('[data-hold]').forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
    if (!T.win) $('#out').innerHTML = ''; paint();
  }; });
  $app.querySelectorAll('[data-hold]').forEach((b) => { b.onclick = () => {
    const i = Number(b.dataset.hold); if (!T.reels || T.reels[i] == null) return;
    T.held[i] = T.held[i] == null ? T.reels[i] : null;
    b.classList.toggle('on', T.held[i] != null); b.setAttribute('aria-pressed', String(T.held[i] != null)); paint();
  }; });
  const locate = () => {
    if (T.center || T.geo !== 'idle') return;
    if (!navigator.geolocation) { T.geo = 'failed'; return; }
    T.geo = 'asking';
    navigator.geolocation.getCurrentPosition(
      (p) => { T.center = { lat: p.coords.latitude, lon: p.coords.longitude }; T.geo = 'done'; T.manual = false; if (host.isConnected) paint(); },
      () => { T.geo = 'failed'; if (host.isConnected) paint(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  };
  if (DESK.matches) {
    S.keyFn = (e) => { if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(document.activeElement?.tagName || '')) return; e.preventDefault(); spin(); };
    document.addEventListener('keydown', S.keyFn);
  }
  S.onLeave = () => { clearInterval(T.pollT); T.pollT = 0; T.spinning = false; };
  if (T.room && !T.pollT) T.pollT = setInterval(poll, 3000);
  locate(); paint();
  if (T.win) reveal(false);
  if (T.joinId) { // открыли ссылку на комнату
    const id = T.joinId; T.joinId = null;
    guard(async () => { const st = await api.roomGet(id); joinRoom(st); paint(); if (T.win) reveal(false); }, $('#out'))
      .then(() => { if (!T.room && host.isConnected) $('#out').innerHTML = `<div class="notice">${ico('warn')}<span>Комната не открылась: ссылка устарела (комната живёт 12 часов) или связь плохая.</span></div>`; });
  }
}

// Ссылка на комнату: на телефоне — меню «Поделиться», на компьютере — в буфер. Личный ключ в ссылку не попадает.
async function shareRoom(id, msg) {
  const url = roomLink(location.origin + location.pathname, id);
  const text = `Крутим автомат G.A.S. вместе: ${url}`;
  if (matchMedia('(pointer: coarse)').matches && navigator.share) { try { await navigator.share({ title: 'G.A.S. · вместе', text }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(text); if (msg) { msg.style.color = 'var(--acc-text)'; msg.textContent = 'Ссылка на комнату скопирована. Отправьте её друзьям.'; } }
  catch { if (msg) { msg.style.color = ''; msg.textContent = `Ссылка на комнату: ${url}`; } }
}

// ---------- старт ----------
(async () => {
  window.__gasBoot = true; // сайт загрузился (см. страховку в index.html)
  const cached = !isDemo && S.code ? readCache() : null;
  if (cached) { build(cached); S.gate = null; render(); openDeep(); } else viewLoading();
  const before = cached ? JSON.stringify(cached) : null;
  const ok = await refresh();
  clearTimeout(S.slowT);
  if (ok) { syncAvatar(); flushErrors(); } // неподтверждённый выбор кубиком и накопленные ошибки отправляем снова
  if (!cached) { render(); openDeep(); return; }
  if (openDeep()) return;
  if (!ok) { if (S.gate) return render(); S.err = null; if (cur.view === 'menu') render(); return; } // нет связи: остаёмся на данных из кэша
  // свежие данные: перерисовываем только безопасные экраны (не форму оценки)
  if ((JSON.stringify(S.data) !== before && (cur.view === 'menu' || cur.view === 'list')) || cur.view === 'menu') render();
})();
