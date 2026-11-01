import {
  SCALES, summarize, RATED_SORTS, slotPool, searchSummaries, sortSummaries, findDuplicates,
  distanceKm, mapsLink, readCode, parsePastedLink, disagreement, slotWeights, pickWeighted, ago, displayName, isUuid, ratingModel, isThin, shareText, readPlace, parseMapLink, MAP_APPS, fmtPrice, priceToPct, parsePrice,
} from './logic.js';
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
  if (fromUrl) ls.set('gas_code', code);
  if (fromUrl || S.deepPlace != null) history.replaceState(null, '', location.pathname + location.search);
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
  if (S.deepPlace == null || S.gate || !S.data) return false;
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
  $app = $root; document.body.classList.remove('desk');
  if (S.gate) return viewGate();
  if (S.err) return viewError();
  if (!S.data) return viewLoading();
  if (DESK.matches) renderDesk(); else (VIEWS[cur.view] || viewMenu)();
  if (S.flash) { ($root.querySelector('.dk-b header') || $root.querySelector('header'))?.insertAdjacentHTML('afterend', `<div class="notice soft">${ico('info')}<span>${esc(S.flash)} <a href="#" id="flash-retry">Обновить</a></span></div>`); S.flash = '';
    const fr = $root.querySelector('#flash-retry'); if (fr) fr.onclick = async (e) => { e.preventDefault(); fr.textContent = 'обновляю…'; await refreshAfterWrite('Связь всё ещё плохая. Попробуйте позже.'); render(); }; }
}
// Загрузка: если база долго молчит, честно говорим об этом (запрос сам оборвётся по таймауту и покажет «Повторить»).
const VIEWS = { news: () => viewNews(), errors: () => viewErrors(), menu: () => viewMenu(), list: () => viewList(), detail: () => viewDetail(), map: () => viewMap(), slot: () => viewSlot(), rate: () => viewRate(), me: () => viewMe(), invites: () => viewInvites(), editplace: () => viewEditPlace(), net: () => viewNet() };
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
  const two = v === 'list' || v === 'detail' || v === 'map';
  const oldA = $root.querySelector('.dk.two .dk-a'); const keep = two && oldA ? oldA.scrollTop : 0; // список не прыгает наверх при выборе места
  document.body.classList.add('desk');
  $root.innerHTML = `<div class="dk ${two ? 'two' : 'one'} v-${v}" style="${deskStyle()}"><aside class="rail">${railHtml(v)}</aside><main class="dk-a"></main>${two ? '<section class="dk-b"></section>' : ''}</div>`;
  const A = $root.querySelector('.dk-a'); const B = $root.querySelector('.dk-b');
  fixDeskHeight($root.querySelector('.dk'));
  try {
    if (two) { $app = A; viewList(); $app = B; if (v === 'detail') viewDetail(); else viewMapPane(); }
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

function viewMenu() {
  const rated = S.sums.filter((s) => s.count).length;
  $app.innerHTML = `<header class="bar mehead"><button class="me-tile" data-act="go" data-view="me" aria-label="Открыть профиль">${avatarSvg(S.seed, { size: 52, animate: true, label: 'Ваш аватар' })}${S.role === 'admin' ? crownSvg() : ''}</button>
      <div class="grow"><div class="mename">${esc(S.role === 'admin' ? (S.name || 'Админ') : S.name && !S.anon ? S.name : 'Аноним')}</div><div class="label" style="font-size:11px;margin-top:2px">${S.role === 'admin' ? 'админ' : 'участник'} · профиль</div></div>
      <button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>
    ${isDemo ? `<div class="notice">${ico('warn')}<span>Демо-режим: выдуманные примеры. Настоящая база подключается в <code>config.js</code>.</span></div>` : ''}
    <h1 class="hero">Куда<br>едем<i>.</i></h1>
    <button class="tile primary" data-act="go" data-view="slot"><span class="tag">01 · Слот-машина</span><span class="ttl">Выбрать место</span><span class="letters" aria-hidden="true"><b>G</b><b>A</b><b>S</b></span></button>
    <div class="grid2">
      <button class="tile sq" data-act="go" data-view="list"><span class="tag">02 · Список</span><span><span class="num">${String(rated).padStart(2, '0')}</span><span class="ttl">Все оценённые</span></span></button>
      <button class="tile sq map" data-act="go" data-view="map"><span class="tag">03 · Карта</span>
        <span class="grid" aria-hidden="true"></span>
        <svg class="route" viewBox="0 0 169 152" preserveAspectRatio="none" aria-hidden="true"><path d="M20 94 C 55 100, 75 70, 117 50" fill="none" stroke="var(--acc)" stroke-width="1.5" stroke-dasharray="3 5" stroke-linecap="round" vector-effect="non-scaling-stroke" opacity=".7"/></svg>
        <i class="pin"></i><i class="pin2"></i>
        <span class="ttl">Карта</span></button>
    </div>
    <button class="tile rate" data-act="go" data-view="rate"><span class="plus">${ico('plus')}</span><span><b>Оценить заведение</b><small>новая или обновлённая рецензия</small></span></button>
    <div class="foot${S.online === false ? ' off' : ''}"><span class="dot"></span><span>${isDemo ? 'демо' : S.online === false ? 'нет связи с базой · показаны сохранённые данные' : S.online ? 'база на связи' : 'обновляю…'}</span><button class="ver" data-act="go" data-view="news">β ${VERSION}</button></div>`;
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
    <label class="lbl" for="ek">Тип</label><input type="text" id="ek" maxlength="40" value="${esc(p.kind || '')}">
    <label class="lbl" for="ea">Адрес</label><input type="text" id="ea" maxlength="300" value="${esc(p.address)}">
    <div class="small muted" style="margin-top:8px">Точка на карте: нажмите или перетащите булавку.</div><div id="pickmap"></div>
    <div class="err" id="msg"></div><button class="btn accent block" id="save" style="margin-top:14px">Сохранить</button></form>`;
  mountPicker('pickmap', { lat: p.lat, lon: p.lon }, (c) => { draft.lat = c.lat; draft.lon = c.lon; });
  const msg = $app.querySelector('#msg');
  $app.querySelector('#save').onclick = (e) => {
    e.preventDefault();
    draft.name = $app.querySelector('#en').value.trim(); draft.kind = $app.querySelector('#ek').value.trim(); draft.address = $app.querySelector('#ea').value.trim();
    if (!draft.name || !draft.address) { msg.textContent = 'Нужны название и адрес.'; return; }
    guard(async () => { await api.savePlace({ id: p.id, ...draft }); await refreshAfterWrite('Место сохранено, но список ещё не обновился: связь плохая.'); go('detail', { id: p.id }, true); }, msg);
  };
}

// ---------- список ----------
const LST = { q: '', sort: 'score', min: '0' };
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
function viewList() {
  $app.innerHTML = `${bar('Все оценённые')}
    <input type="search" id="q" placeholder="Поиск по названию или адресу" value="${esc(LST.q)}">
    <div class="row" style="margin:8px 0 12px"><select id="sort" aria-label="Сортировка">
      ${[['score', 'Сначала лучшие'], ['stars', 'По звёздам'], ['taste', 'По вкусу'], ['name', 'По названию'], ['new', 'Сначала новые']].map(([v, n]) => `<option value="${v}" ${LST.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="min" aria-label="Минимум звёзд">${[['0', 'Любые'], ['1', '1+ звезда'], ['2', '2+ звезды'], ['3', '3 звезды']].map(([v, n]) => `<option value="${v}" ${LST.min === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div id="items"></div>`;
  const paint = () => {
    // мало данных: звёзды не показываются, при фильтре по звёздам такие места не берём
    let xs = searchSummaries(S.sums, LST.q).filter((s) => Number(LST.min) === 0 || (!isThin(s) && (s.stars ?? -1) >= Number(LST.min)));
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
  $app.querySelector('#q').oninput = (e) => { LST.q = e.target.value; paint(); };
  $app.querySelector('#sort').onchange = (e) => { LST.sort = e.target.value; paint(); };
  $app.querySelector('#min').onchange = (e) => { LST.min = e.target.value; paint(); };
  paint();
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
    ${s.count ? barsHtml(s.scores) : '<p class="muted">Пока нет рецензий.</p>'}
    ${priceHtml(s)}
    ${s.count && isThin(s) ? `<div class="notice soft">${ico('info')}<span>Пока одна рецензия: звёзды и итог появятся после второй, а в слот-машину место попадёт после неё.</span></div>` : ''}
    <details class="how"><summary>Как считается итоговый балл</summary><p>Балл рецензии: примерно поровну качество по критериям (вкус весит больше всего, затем впечатление, сервис и чистота) и звёзды. Доступность и туалет показываются отдельно и в итог не входят. Строгость авторов слегка выравнивается, а к каждому месту подмешивается среднее по группе (как две лишние рецензии), чтобы одна оценка не решала всё. Звёзды места — медиана вердиктов; при ничьей берётся меньшее, а «ехать специально» не выдаётся, если кто-то поставил 0. Меньше двух рецензий — «мало данных»: такое место не попадает в слот-машину.</p></details>
    ${d?.kind === 'quality' ? `<div class="notice">${ico('warn')}<span>Мнения о качестве расходятся${d.scales.length ? `: сильно разные оценки: ${esc(d.scales.join(', ').toLowerCase())}` : ''}.</span></div>` : d?.kind === 'trip' ? `<div class="notice soft">${ico('info')}<span>Качество оценили похоже, но по-разному решили, стоит ли ехать специально (вердикты от ${Math.min(...vs)} до ${Math.max(...vs)}). Это не спор: у каждого своя мера «поехать специально».</span></div>` : ''}
    <div class="row" style="margin-top:14px"><a class="btn grow" href="${esc(mapsLink(p.lat, p.lon))}" target="_blank" rel="noopener">${ico('map')}<span class="lbl-long">Открыть в картах</span><span class="lbl-short">Карты</span></a>
      <button class="btn icon-only" id="share" aria-label="Поделиться местом" title="Поделиться">${ico('share')}</button>
      <button class="btn accent grow" data-act="go" data-view="rate" data-id="${p.id}">${mine ? '<span class="lbl-long">Изменить мою</span><span class="lbl-short">Изменить</span>' : 'Оценить'}</button></div>
    ${s.count ? `<div class="label" style="margin-top:26px">Рецензии · ${s.count}</div><div class="small muted" id="phnote" style="margin-top:6px">Загружаю фото…</div><div class="thread">${s.reviews.map((r, i) => postHtml(r, i === s.reviews.length - 1)).join('')}</div>` : ''}
    <div class="err" id="msg"></div>
    <div class="row wrap" style="margin-top:12px">${mine ? '<button class="btn danger" id="delrev">Удалить мою рецензию</button>' : ''}${admin ? `<button class="btn" data-act="go" data-view="editplace" data-id="${p.id}">Изменить место</button>` : ''}${!s.count ? '<button class="btn danger" id="delplace">Удалить заведение</button>' : ''}</div>`;
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
      <label class="lbl" for="kd">Тип (кафе, ресторан, фастфуд…)</label><input type="text" id="kd" name="kind" list="kinds" value="${esc(R.np.kind)}" maxlength="40">
      <datalist id="kinds"><option>кафе<option>ресторан<option>фастфуд<option>шаурмечная<option>шашлычная<option>бар<option>пекарня</datalist>
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
    <button class="btn accent block" id="send" style="margin-top:14px">Отправить</button></form>`;

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
    else if (['name', 'kind', 'address'].includes(name)) { R.np[name] = value; if (name === 'name') clearTimeout(R.t), R.t = setTimeout(redrawKeepFocus, 600); }
  });
  const redrawKeepFocus = () => { const id = document.activeElement?.id; redraw(); if (id) document.getElementById(id)?.focus(); };
  f.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]'); if (rm) { const [gone] = R.photos.splice(Number(rm.dataset.rm), 1); URL.revokeObjectURL(gone.url); redraw(); return; }
    const pr = e.target.closest('[data-price]');
    if (pr) { const [a, b] = pr.dataset.price.split('-'); R.price_from = a === '' ? null : Number(a); R.price_to = b === '' ? null : Number(b); redraw(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { e.preventDefault(); R.placeId = Number(pk.dataset.pick); R.mode = 'exist'; prefill(); redraw(); }
    const fd = e.target.closest('[data-found]'); if (fd) { const x = R.found[fd.dataset.found]; R.np.lat = +(+x.lat).toFixed(6); R.np.lon = +(+x.lon).toFixed(6); R.np.address = R.np.address || x.display_name; R.found = []; redraw(); }
  });
  // ссылка из приложения карт: разбираем, короткую раскрывает база, адрес и название — по точке (OpenStreetMap)
  const fromLink = async () => {
    const st = (t) => { const el = f.querySelector('#linkst'); if (el) el.textContent = t; };
    let p = parseMapLink(R.np.link);
    if (!p) { st(`Не узнаю эту ссылку. Поддерживаются ${MAP_APPS}.`); return; }
    if (p.short) {
      st('Раскрываю короткую ссылку…');
      let res = null; try { res = await api.resolveLink(p.url); } catch { /* ниже сообщение */ }
      const name0 = p.name; const full = typeof res === 'string' ? res : res?.url;
      p = full ? parseMapLink(full) : null;
      if (p && !p.name && name0) p.name = name0; // название из текста перед короткой ссылкой
      if (!R) return;
      if (!p || p.short || p.lat == null) {
        st('Не удалось раскрыть короткую ссылку. Откройте её в браузере и скопируйте полный адрес из адресной строки.');
        report('link', 'не раскрылась короткая ссылка', `${R.np.link.slice(0, 300)}\n${JSON.stringify(res).slice(0, 1500)}`);
        if (name0 && !R.np.name.trim()) { R.np.name = name0; redraw(); }
        return;
      }
    }
    if (p.name && !R.np.name.trim()) R.np.name = p.name;
    if (p.address && !R.np.address.trim()) R.np.address = p.address;
    if (p.lat != null) {
      R.np.lat = p.lat; R.np.lon = p.lon; st('Точка поставлена, ищу адрес…');
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ru&lat=${p.lat}&lon=${p.lon}`);
        const j = r.ok ? await r.json() : {}; const a = j.address || {};
        const street = [a.road || a.pedestrian || a.footway || a.square, a.house_number].filter(Boolean).join(', ');
        const addr = [street, a.city || a.town || a.village].filter(Boolean).join(', ') || j.display_name || '';
        if (R && !R.np.address.trim() && addr) R.np.address = addr;
      } catch { /* адрес можно ввести руками */ }
    }
    if (!R) return;
    R.linkNote = p.lat != null ? `Из ссылки (${p.source}): точка${p.name ? ', название' : ''}${R.np.address ? ', адрес' : ''}.${p.name ? '' : ` Название в этой ссылке не передаётся — введите его сами${p.hint ? ` (в ссылке оно латиницей: «${p.hint}»)` : ''}.`} Проверьте и поправьте, если нужно.`
      : `${p.source}: в ссылке нет координат${p.name ? ' (название подставлено)' : ''}${p.source === '2ГИС' ? ', а сайт 2ГИС не пускает автоматические запросы' : ''} — поставьте точку на карте или нажмите «Найти».`;
    redraw();
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
    const miss = [];
    if (!R.anon && !R.name.trim()) miss.push('имя (или «Анонимно»)');
    if (R.mode === 'new') {
      if (!R.np.name.trim()) miss.push('название'); if (!R.np.address.trim()) miss.push('адрес');
      if (R.np.lat == null) miss.push('точку на карте');
    } else if (!R.placeId) miss.push('заведение');
    if (R.verdict == null) miss.push('общий вердикт');
    SCALE_KEYS.forEach(([k, n]) => { if (R[k] == null) miss.push(n.toLowerCase()); });
    if (R.toilet_present === undefined) miss.push('туалет (есть / нет / не помню)');
    else if (R.toilet_present === true && R.toilet == null) miss.push('оценку туалета');
    if (miss.length) { msg.textContent = `Не заполнено: ${miss.join(', ')}.`; return; }
    const btn = e.target; btn.disabled = true; btn.textContent = 'Отправляю…';
    guard(async () => {
      let id = R.placeId;
      if (R.mode === 'new') id = await api.savePlace({ name: R.np.name.trim(), kind: R.np.kind.trim(), address: R.np.address.trim(), lat: R.np.lat, lon: R.np.lon });
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
      S.anon = R.anon; ls.set('gas_anon', S.anon ? '1' : '0');
      if (!R.anon) { S.name = R.name.trim(); ls.set('gas_name', S.name); }
      R = null; await refreshAfterWrite('Рецензия сохранена, но список ещё не обновился: связь плохая.'); go('detail', { id }, true);
      if (failed) alert(`Рецензия сохранена, но ${failed} фото не загрузились (возможно, уже 5 фото или нет связи). Добавьте их через «Изменить мою рецензию».`);
    }, msg).finally(() => { if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Отправить'; } });
  };
}

// ---------- слот-машина ----------
const T = { rig: ls.get('gas_rig') !== '0', nearby: ls.get('gas_nearby') !== '0', center: null, radius: 5, geo: 'idle', spinning: false, manual: false };
const ROW = 40; // высота строки барабана на телефоне, px; на компьютере берётся из вёрстки (.reel .cell)
const G = () => window.gsap; // если GSAP не загрузился, всё работает без анимации
const calm = () => !G() || matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);

function viewSlot() {
  const pool = () => slotPool(S.sums, { nearby: T.nearby, center: T.center, radiusKm: T.radius });
  const status = () => {
    if (!T.nearby && T.geo === 'failed') return 'Геолокация недоступна, поэтому поиск рядом выключен. Включите «Рядом» и поставьте точку на карте.';
    if (!T.nearby) return 'Поиск по радиусу выключен: берём любое место с высоким итоговым баллом.';
    if (T.geo === 'asking') return 'Определяю, где вы…';
    if (!T.center) return 'Не знаю, где вы. Поставьте точку на карте или выключите «Рядом».';
    return `Ищу в радиусе ${T.radius} км от ${T.manual ? 'выбранной точки' : 'вас'}.`;
  };
  $app.innerHTML = `${bar('Куда едем')}
    <div class="pills"><label class="pill"><input type="checkbox" id="nb" ${T.nearby ? 'checked' : ''}><span>Рядом</span></label>
      <label class="pill"><input type="checkbox" id="rig" ${T.rig ? 'checked' : ''}><span>Подкрутка</span></label></div>
    <div class="small muted" id="st" style="margin-top:10px"></div>
    <div id="pickwrap" class="${T.manual ? '' : 'hidden'}"><div id="pickmap"></div></div>
    <div class="row wrap" id="geoBtns" style="margin-top:8px"></div>
    <div class="machine" id="machine">
      <div class="reels" aria-hidden="true"><div class="band"></div>${[0, 1, 2].map((i) => `<div class="reel" id="reel${i}"><div class="strip"><div class="cell"></div><div class="cell idle">${'GAS'[i]}</div><div class="cell"></div></div></div>`).join('')}</div>
      <div class="handle" id="handle" role="group" aria-label="Ручка слот-машины"><span class="hint">ПОТЯНИ</span><button type="button" class="knob" id="knob" aria-label="Дёрнуть ручку">${ico('arrow')}</button></div>
      <div class="small muted dk-only" style="margin-top:10px;text-align:center">Пробел — крутить</div>
    </div>
    <div id="out" aria-live="polite"></div>`;
  const $ = (s) => $app.querySelector(s);
  const knob = $('#knob'); const handle = $('#handle');
  const maxX = () => handle.clientWidth - knob.offsetWidth - 10;
  const hint = !calm() ? G().to(knob, { x: 8, duration: 0.8, yoyo: true, repeat: -1, ease: 'sine.inOut' }) : null;

  const paintStatus = () => {
    $('#st').textContent = status();
    const empty = pool().length === 0;
    $('#nb + span').textContent = T.nearby ? `Рядом · ${T.radius} км` : 'Рядом';
    $('#geoBtns').innerHTML = `${T.nearby ? '<button class="btn" id="setpt">Поставить точку на карте</button>' : ''}
      ${T.nearby && empty && T.center && T.radius < 15 ? '<button class="btn" id="wider">Расширить до 15 км</button>' : ''}
      ${T.nearby && empty && T.center ? '<button class="btn" id="off">Выключить поиск рядом</button>' : ''}`;
    const blocked = T.spinning || empty || (T.nearby && !T.center);
    knob.disabled = blocked; handle.setAttribute('aria-disabled', String(blocked));
    if (!T.spinning) {
      if (empty && (!T.nearby || T.center)) $('#out').innerHTML = `<div class="notice">${ico('warn')}<span>${T.nearby ? 'Рядом нет подходящих мест.' : 'Пока нет мест с высоким итоговым баллом. Оцените что-нибудь!'}</span></div>`;
      else if ($('#out .notice')) $('#out').innerHTML = '';
    }
    const b = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    b('#setpt', () => { T.manual = true; $('#pickwrap').classList.remove('hidden'); mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paintStatus(); }); });
    b('#wider', () => { T.radius = 15; paintStatus(); });
    b('#off', () => { T.nearby = false; ls.set('gas_nearby', '0'); $('#nb').checked = false; paintStatus(); });
    if (T.manual && !S.pick) mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paintStatus(); });
  };
  const locate = () => {
    if (!T.nearby || T.center) return;
    if (!navigator.geolocation) { T.geo = 'failed'; T.nearby = false; $('#nb').checked = false; paintStatus(); return; }
    T.geo = 'asking'; paintStatus();
    navigator.geolocation.getCurrentPosition(
      (p) => { T.center = { lat: p.coords.latitude, lon: p.coords.longitude }; T.geo = 'done'; T.manual = false; paintStatus(); },
      () => { T.geo = 'failed'; T.nearby = false; $('#nb').checked = false; paintStatus(); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 });
  };
  $('#nb').onchange = (e) => {
    T.nearby = e.target.checked; ls.set('gas_nearby', T.nearby ? '1' : '0'); T.radius = 5;
    if (T.nearby && T.geo === 'failed') { T.manual = true; T.geo = 'idle'; $('#pickwrap').classList.remove('hidden'); }
    else if (T.nearby && !T.center) locate();
    paintStatus();
  };
  $('#rig').onchange = (e) => { T.rig = e.target.checked; ls.set('gas_rig', T.rig ? '1' : '0'); };
  paintStatus(); locate();
  if (DESK.matches) {
    S.keyFn = (e) => { if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(document.activeElement?.tagName || '')) return; e.preventDefault(); pull(); };
    document.addEventListener('keydown', S.keyFn);
  }

  // ---- ручка: тянется пальцем вправо или нажимается ----
  let drag = null;
  knob.addEventListener('pointerdown', (e) => {
    if (knob.disabled) return;
    hint?.kill(); if (G()) G().set(knob, { x: 0 });
    drag = { x0: e.clientX, dx: 0, moved: false }; knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = Math.max(0, Math.min(maxX(), e.clientX - drag.x0));
    if (drag.dx > 6) drag.moved = true;
    if (G()) G().set(knob, { x: drag.dx });
  });
  const release = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved || d.dx > maxX() * 0.6) pull();
    else if (G()) G().to(knob, { x: 0, duration: 0.5, ease: 'elastic.out(1,0.5)' });
  };
  knob.addEventListener('pointerup', release);
  knob.addEventListener('pointercancel', () => { drag = null; if (G()) G().to(knob, { x: 0, duration: 0.3 }); });
  knob.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pull(); } });

  function pull() {
    const p = pool(); if (!p.length || T.spinning || (T.nearby && !T.center)) return;
    T.spinning = true; knob.disabled = true; $('#out').innerHTML = ''; hint?.kill();
    const win = T.rig ? pickWeighted(p, slotWeights(p, { center: T.nearby ? T.center : null })) : p[Math.floor(Math.random() * p.length)];
    const names = p.map((s) => s.place.name);
    const any = () => names[Math.floor(Math.random() * names.length)];
    const still = calm();
    const done = [];
    [0, 1, 2].forEach((i) => {
      const n = 14 + i * 6;
      const seq = ['', 'GAS'[i], '', ...Array.from({ length: n }, any), any(), win.place.name, any()];
      const strip = $(`#reel${i} .strip`);
      strip.innerHTML = seq.map((x, k) => `<div class="cell${k === 1 ? ' idle' : ''}${k === seq.length - 2 ? ' last' : ''}">${esc(x)}</div>`).join('');
      const endY = -(seq.length - 3) * ($(`#reel${i} .cell`)?.offsetHeight || ROW);
      const land = () => { strip.style.transform = `translateY(${endY}px)`; strip.querySelector('.last').classList.add('hit'); if (done.push(i) === 3) reveal(win); };
      if (still) return land();
      const dur = 1.7 + i * 0.55;
      G().set(strip, { y: 0 });
      G().to($(`#reel${i}`), { filter: 'blur(2.5px)', duration: 0.3, delay: 0.3 });
      G().to($(`#reel${i}`), { filter: 'blur(0px)', duration: 0.45, delay: 0.3 + dur - 0.7 });
      G().to(strip, { y: endY, duration: dur, delay: 0.3, ease: 'back.out(0.55)', onComplete: land });
    });
    if (!still) {
      const x = maxX();
      G().to(knob, { x, duration: 0.2, ease: 'power2.in' });
      G().to(knob, { x: 0, duration: 0.7, delay: 0.3, ease: 'elastic.out(1,0.55)' });
    }
  }

  function reveal(win) {
    T.spinning = false;
    const km = T.center ? distanceKm(T.center.lat, T.center.lon, win.place.lat, win.place.lon) : null;
    $('#out').innerHTML = `<div class="res-grid"><div class="result"><div class="row" style="align-items:flex-start;gap:12px"><div class="grow"><h3>${esc(win.place.name)}</h3>
      <div class="muted small" style="margin-top:6px">${esc(win.place.address)}${km != null ? ` · ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} км` : ''}</div></div>
      <div class="big ${scoreClass(win.score)}">${fmt(win.score)}<small>/10</small></div></div>
      ${fmtPrice(win.price) ? `<div class="small muted" style="margin-top:6px">Цены: <b style="color:var(--ink)">${fmtPrice(win.price)}</b> на человека</div>` : ''}
      ${barsHtml(win.scores, ['taste', 'service', 'toilet'])}
      <div class="row"><a class="btn accent" style="flex:1.3" href="${esc(mapsLink(win.place.lat, win.place.lon))}" target="_blank" rel="noopener">${ico('map')}<span class="lbl-long">Открыть в картах</span><span class="lbl-short">Карты</span></a>
      <button class="btn icon-only" id="slotshare" aria-label="Поделиться местом" title="Поделиться">${ico('share')}</button>
      <button class="btn" style="flex:1" data-act="go" data-view="detail" data-id="${win.place.id}">Подробнее</button></div><div class="err" id="slotmsg"></div></div>
      <div id="resmap" class="res-map dk-only"></div></div>`;
    $('#slotshare').onclick = () => sharePlace(win, $('#slotmsg'));
    if (DESK.matches && window.L) {
      if (S.map) { S.map.remove(); S.map = null; }
      S.map = L.map('resmap', { zoomControl: false, attributionControl: false }).setView([win.place.lat, win.place.lon], 15); tiles().addTo(S.map);
      L.marker([win.place.lat, win.place.lon], { icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], html: `<div class="pin"><span>${win.stars}</span></div>` }) }).addTo(S.map);
    }
    paintStatus();
    if (calm()) return;
    const g = G();
    g.fromTo('.reel .cell.hit', { scale: 0.8 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
    g.fromTo('#machine', { boxShadow: '0 0 0 0 rgba(200,242,90,0)' }, { boxShadow: '0 0 36px 2px rgba(200,242,90,.35)', duration: 0.4, yoyo: true, repeat: 1 });
    const machine = $('#machine'); const colors = ['#C8F25A', '#8F82FF', '#FFB86B'];
    for (let k = 0; k < 18; k++) {
      const el = Object.assign(document.createElement('i'), { className: 'fx' }); el.style.background = colors[k % 3];
      const band = machine.querySelector('.band'); el.style.left = `${machine.clientWidth / 2}px`; el.style.top = `${band ? band.offsetTop + band.offsetHeight / 2 + 16 : 78}px`; machine.appendChild(el);
      g.fromTo(el, { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1 }, { x: rnd(-150, 150), y: rnd(-80, 70), rotation: rnd(-200, 200), scale: 0, duration: 0.9, ease: 'power2.out', onComplete: () => el.remove() });
    }
    g.from('.result', { y: 24, autoAlpha: 0, duration: 0.5, ease: 'power3.out' });
    g.from('.result .seg5 i.on', { scaleX: 0, transformOrigin: 'left center', duration: 0.4, stagger: 0.04, delay: 0.2 });
  }
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
