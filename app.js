import {
  SCALES, summarize, slotPool, searchSummaries, sortSummaries, findDuplicates,
  distanceKm, mapsLink, readCode, parsePastedLink, disagreement, slotWeights, pickWeighted, ago,
} from './logic.js';
import { makeApi, isDemo, ApiError } from './api.js';

const $app = document.getElementById('app');
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без хранилища всё работает до перезагрузки */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (x) => (x == null ? '—' : x.toFixed(1).replace('.', ','));
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
const SPB = [59.9386, 30.3141];

const S = { code: null, me: ls.get('gas_me'), data: null, sums: [], gate: null, err: null, map: null };

// ---------- секретный код: из #k=… в адресе, затем адрес очищается ----------
{
  const { code, fromUrl } = readCode(location.hash, ls.get('gas_code'));
  S.code = code;
  if (fromUrl) { ls.set('gas_code', code); history.replaceState(null, '', location.pathname + location.search); }
}
const api = makeApi(() => S.code);

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
};
const ico = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
const themeIcon = () => ico({ light: 'sun', dark: 'moon' }[ls.get('gas_theme')] ?? 'auto');

// ---------- общие куски разметки ----------
const stars = (n) => (n == null ? '<span class="badge">—</span>' : `<span class="badge b${n}" aria-label="${n} из 3">${n}/3</span>`);
const bar = (title, back = true) => `<header class="bar">${back ? `<button class="icon-btn" data-act="back" aria-label="Назад">${ico('back')}</button>` : ''}<h1>${esc(title)}</h1><button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>`;
const SHORT = { access: 'Доступ', taste: 'Вкус', service: 'Сервис', clean: 'Чистота', toilet: 'Туалет', impression: 'Впечатл.' };
// Шкалы в виде 5 полосок: заполнено столько, сколько округлённая оценка.
const barsHtml = (sc, keys = SCALES.map(([k]) => k)) => `<div class="bars">${keys.map((k) => {
  const v = sc[k]; const on = v == null ? 0 : Math.round(v);
  return `<span>${SHORT[k].toUpperCase()}</span><span class="seg5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= on ? 'on' : ''}"></i>`).join('')}</span><b>${fmt(v)}</b>`;
}).join('')}</div>`;
const avClass = (name) => `av${Math.max(0, S.data.members.indexOf(name)) % 4}`;
const toiletStat = (r) => (r.toilet_present === true && r.toilet != null ? `Туалет ${r.toilet}` : r.toilet_present === false ? 'Туалета нет' : '');
// Рецензия как пост: аватар с линией «ветки», имя, давность, вердикт, текст, фото, показатели.
const postHtml = (r, last) => `<article class="post"><div class="side"><span class="avatar ${avClass(r.reviewer)}" aria-hidden="true">${esc(r.reviewer.slice(0, 1).toUpperCase())}</span>${last ? '' : '<span class="line"></span>'}</div>
  <div class="main"><div class="hd"><b>${esc(r.reviewer)}</b><span class="ago">· ${esc(ago(r.updated_at || r.created_at))}</span>${stars(r.verdict)}</div>
  ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<div class="thumbs" data-who="${esc(r.reviewer)}"></div>
  <div class="stats"><span>Вкус ${r.taste}</span><span>Сервис ${r.service}</span><span>Чистота ${r.clean}</span>${toiletStat(r) ? `<span>${toiletStat(r)}</span>` : ''}<span>Доступ ${r.access}</span><span>Впечатл. ${r.impression}</span></div></div></article>`;

// ---------- данные ----------
function build(data) {
  S.data = data;
  const by = new Map();
  data.reviews.forEach((r) => { if (!by.has(r.place_id)) by.set(r.place_id, []); by.get(r.place_id).push(r); });
  S.sums = data.places.map((p) => summarize(p, by.get(p.id) || [], data.members.length));
}
async function refresh() {
  if (!isDemo && !S.code) { S.gate = 'none'; return false; }
  try { build(await api.getAll()); S.gate = null; S.err = null; return true; }
  catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.kind === 'bad_code') S.gate = 'bad'; else S.err = e;
    return false;
  }
}
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

$app.addEventListener('click', (e) => {
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
    if (!(e instanceof ApiError)) { console.error(e); if (msgEl) msgEl.textContent = 'Что-то пошло не так. Попробуйте ещё раз.'; return; }
    if (e.kind === 'bad_code') { S.gate = 'bad'; render(); }
    else if (msgEl) msgEl.textContent = e.kind === 'offline' ? 'Нет связи с базой. Проверьте интернет и повторите.' : e.kind === 'db' ? 'База не отвечает (возможно, «спит»). Повторите через минуту.' : `Не удалось сохранить: ${e.detail || 'отказ базы'}`;
    else { S.err = e; render(); }
  }
}

// ---------- отрисовка ----------
function render() {
  if (S.map) { S.map.remove(); S.map = null; }
  if (S.pick) { S.pick.remove(); S.pick = null; }
  if (S.gate) return viewGate();
  if (S.err) return viewError();
  if (!S.data) return viewLoading();
  ({ menu: viewMenu, list: viewList, detail: viewDetail, map: viewMap, slot: viewSlot, rate: viewRate }[cur.view] || viewMenu)();
}
const viewLoading = () => { $app.innerHTML = `${bar('G.A.S. Rating', false)}<p class="muted">Загружаю…</p>`; };

function viewError() {
  const e = S.err;
  $app.innerHTML = `${bar('G.A.S. Rating', false)}<div class="card"><h2>База недоступна</h2>
    <p>${e.kind === 'offline' ? 'Нет связи. Проверьте интернет или включите VPN.' : 'База не отвечает. Бесплатная база засыпает, если неделю никто не заходит: откройте её в панели Supabase и нажмите «Restore», или повторите через минуту.'}</p>
    <button class="btn accent block" id="retry">Повторить</button></div>`;
  $app.querySelector('#retry').onclick = async () => { S.err = null; viewLoading(); await refresh(); render(); };
}

function viewGate() {
  const bad = S.gate === 'bad';
  $app.innerHTML = `${bar('G.A.S. Rating', false)}<div class="card"><h2>${bad ? 'Код не подходит' : 'Нужна ваша ссылка'}</h2>
    <p>${bad ? 'Сохранённый код устарел или неверен. Попросите у друзей новую ссылку и вставьте её сюда.' : 'Откройте сайт по ссылке, которую вам прислали. Если сайт открылся без неё (например, с иконки на домашнем экране), вставьте ссылку сюда один раз.'}</p>
    <label class="lbl" for="paste">Ссылка или код</label><input type="text" id="paste" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/#k=…">
    <div class="err" id="msg"></div><button class="btn accent block" id="enter" style="margin-top:12px">Войти</button></div>`;
  $app.querySelector('#enter').onclick = async () => {
    const code = parsePastedLink($app.querySelector('#paste').value);
    if (!code) return;
    S.code = code; ls.set('gas_code', code); S.gate = null; viewLoading();
    await refresh(); render();
  };
}

function viewMenu() {
  const rated = S.sums.filter((s) => s.count).length;
  const me = S.me && S.data.members.includes(S.me) ? S.me : '';
  const dots = [10, 30, 50, 70, 90, 110, 130].flatMap((x, i) => [8, 24, 40].map((y, j) => ((i + j) % 3 === 1 || (x === 70 && y === 24) || (x === 110 && y === 24) ? '' : `<circle cx="${x}" cy="${y}" r="2"/>`))).join('');
  $app.innerHTML = `<header class="bar"><span class="brand">G.A.S. / РЕЙТИНГ</span><span class="grow"></span><button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>
    ${isDemo ? `<div class="notice">${ico('warn')}<span>Демо-режим: выдуманные примеры. Настоящая база подключается в <code>config.js</code>.</span></div>` : ''}
    <h1 class="hero">Куда<br>едем<i>.</i></h1>
    <button class="tile primary" data-act="go" data-view="slot"><span class="tag">01 · Слот-машина</span><span class="ttl">Выбрать место</span><span class="letters" aria-hidden="true"><b>G</b><b>A</b><b>S</b></span></button>
    <div class="grid2">
      <button class="tile sq" data-act="go" data-view="list"><span class="tag">02 · Список</span><span><span class="num">${String(rated).padStart(2, '0')}</span><span class="ttl">Все оценённые</span></span></button>
      <button class="tile sq map" data-act="go" data-view="map"><span class="tag">03 · Карта</span>
        <svg class="dots" viewBox="0 0 140 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><g fill="var(--ln2)">${dots}</g><circle cx="70" cy="24" r="5" fill="var(--acc)"/><circle cx="110" cy="24" r="4" fill="var(--vio)"/></svg>
        <span class="ttl">Карта</span></button>
    </div>
    <button class="tile rate" data-act="go" data-view="rate"><span class="plus">${ico('plus')}</span><span><b>Оценить заведение</b><small>новая или обновлённая рецензия</small></span></button>
    <div class="foot"><span class="dot"></span><span>${isDemo ? 'демо' : 'база на связи'} · вы:</span>
      <select id="me" aria-label="Кто вы"><option value="">—</option>${S.data.members.map((m) => `<option ${m === me ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <button class="btn" id="backup" style="margin-left:auto;min-height:36px;padding:0 12px;font:12px var(--mono)">копия</button></div>`;
  $app.querySelector('#me').onchange = (e) => { S.me = e.target.value || null; ls.set('gas_me', S.me || ''); };
  $app.querySelector('#backup').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `gas-rating-${new Date().toISOString().slice(0, 10)}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

// ---------- список ----------
const LST = { q: '', sort: 'stars', min: '0' };
function viewList() {
  $app.innerHTML = `${bar('Все оценённые')}
    <input type="search" id="q" placeholder="Поиск по названию или адресу" value="${esc(LST.q)}">
    <div class="row" style="margin:8px 0 12px"><select id="sort" aria-label="Сортировка">
      ${[['stars', 'Сначала по звёздам'], ['taste', 'По вкусу'], ['name', 'По названию'], ['new', 'Сначала новые']].map(([v, n]) => `<option value="${v}" ${LST.sort === v ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <select id="min" aria-label="Минимум звёзд">${[['0', 'Любые'], ['1', '1+ звезда'], ['2', '2+ звезды'], ['3', '3 звезды']].map(([v, n]) => `<option value="${v}" ${LST.min === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div id="items"></div>`;
  const paint = () => {
    let xs = searchSummaries(S.sums, LST.q).filter((s) => (s.stars ?? -1) >= Number(LST.min));
    xs = sortSummaries(xs, LST.sort);
    $app.querySelector('#items').innerHTML = xs.length ? xs.map((s) => `<button class="item" data-act="go" data-view="detail" data-id="${s.place.id}">
      <div class="t"><span>${esc(s.place.name)}</span>${stars(s.stars)}</div>
      <div class="meta">${esc(s.place.address)}</div>
      <div class="chips"><span class="chip">${esc(s.place.kind || 'место')}</span><span class="chip">вкус ${fmt(s.scores.taste)}</span><span class="chip">оценили ${s.count} из ${s.memberCount}</span>${disagreement(s.reviews) ? '<span class="chip warn">разногласие</span>' : ''}</div></button>`).join('')
      : '<p class="muted">Ничего не найдено. Попробуйте убрать фильтры или <a href="#" data-act="go" data-view="rate">оцените новое место</a>.</p>';
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
  const p = s.place; const mine = s.reviews.find((r) => r.reviewer === S.me);
  const d = disagreement(s.reviews);
  const vs = s.reviews.map((r) => r.verdict);
  $app.innerHTML = `${bar('')}
    <div class="ph-head"><div class="grow"><div class="label">${esc(p.kind || 'место')}</div><h1>${esc(p.name)}</h1><div class="muted small" style="margin-top:8px">${esc(p.address)}</div></div>
      ${s.stars == null ? '' : `<div class="big b${s.stars}">${s.stars}<small>/3</small></div>`}</div>
    ${s.count ? barsHtml(s.scores) : '<p class="muted">Пока нет рецензий.</p>'}
    ${d ? `<div class="notice">${ico('warn')}<span>Мнения расходятся${d.verdict ? `: вердикты от ${Math.min(...vs)} до ${Math.max(...vs)} звёзд` : ''}${d.scales.length ? `${d.verdict ? '; ' : ': '}сильно разные оценки: ${esc(d.scales.join(', ').toLowerCase())}` : ''}.</span></div>` : ''}
    <div class="row" style="margin-top:14px"><a class="btn grow" href="${esc(mapsLink(p.lat, p.lon, p.name, ios))}">Открыть в картах</a>
      <button class="btn accent grow" data-act="go" data-view="rate" data-id="${p.id}">${mine ? 'Изменить мою' : 'Оценить'}</button></div>
    ${s.count ? `<div class="label" style="margin-top:26px">Рецензии · ${s.count}</div><div class="thread">${s.reviews.map((r, i) => postHtml(r, i === s.reviews.length - 1)).join('')}</div>` : ''}
    <div class="err" id="msg"></div>
    <div class="row wrap" style="margin-top:12px">${mine ? '<button class="btn danger" id="delrev">Удалить мою рецензию</button>' : ''}${!s.count ? '<button class="btn danger" id="delplace">Удалить заведение</button>' : ''}</div>`;
  const msg = $app.querySelector('#msg');
  const del = $app.querySelector('#delrev');
  if (del) del.onclick = () => confirm('Удалить вашу рецензию?') && guard(async () => { await api.deleteReview(p.id, S.me); await refresh(); go('detail', { id: p.id }, true); }, msg);
  const dp = $app.querySelector('#delplace');
  if (dp) dp.onclick = () => confirm('Удалить заведение?') && guard(async () => { await api.deletePlace(p.id); await refresh(); go('list', {}, true); }, msg);
  if (s.count) loadPhotos(p.id);
}

// ---------- фото ----------
const openPhoto = (src) => {
  const box = Object.assign(document.createElement('div'), { className: 'lightbox', innerHTML: `<img src="${src}" alt="Фото">` });
  box.onclick = () => box.remove(); document.body.appendChild(box);
};
async function loadPhotos(placeId) {
  let list;
  try { list = await api.getPhotos(placeId); } catch { return; } // без фото страница остаётся рабочей
  if (cur.view !== 'detail' || cur.p.id !== placeId) return;
  for (const ph of list) {
    const box = [...$app.querySelectorAll('.thumbs[data-who]')].find((b) => b.dataset.who === ph.reviewer); if (!box) continue;
    const src = `data:image/jpeg;base64,${ph.data}`;
    const wrap = Object.assign(document.createElement('span'), { className: 'thumb' });
    const img = Object.assign(document.createElement('img'), { src, alt: 'Фото', loading: 'lazy' });
    img.onclick = () => openPhoto(src); wrap.appendChild(img);
    if (ph.reviewer === S.me) {
      const x = Object.assign(document.createElement('button'), { type: 'button', className: 'x', textContent: '×' });
      x.setAttribute('aria-label', 'Удалить фото');
      x.onclick = () => confirm('Удалить это фото?') && guard(async () => { await api.deletePhoto(ph.id); wrap.remove(); }, $app.querySelector('#msg'));
      wrap.appendChild(x);
    }
    box.appendChild(wrap);
  }
}
// Сжатие на телефоне: стороны до 1280 px, JPEG ≤ 350 КБ; при перерисовке теряются данные EXIF (в том числе место съёмки).
async function compress(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let max = 1280; let q = 0.78;
  for (let i = 0; i < 6; i++) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= 350000) return blob;
    q -= 0.08; max *= 0.85;
  }
  throw new Error('photo_too_big');
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
  S.map = L.map('map').setView(SPB, 11); tiles().addTo(S.map);
  const pts = [];
  S.sums.forEach((s) => {
    const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 30], html: `<div class="pin"><span>${s.stars ?? '?'}</span></div>` });
    const box = document.createElement('div');
    box.innerHTML = `<b>${esc(s.place.name)}</b><br>${stars(s.stars)}<br><span class="small">вкус ${fmt(s.scores.taste)} · оценили ${s.count} из ${s.memberCount}</span><br><a href="#">Подробнее</a>`;
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
  const base = { reviewer: S.me && S.data.members.includes(S.me) ? S.me : '', placeId: placeId ?? null, mode: placeId ? 'exist' : 'new',
    np: { name: '', kind: '', address: '', lat: null, lon: null }, verdict: null, toilet_present: undefined, toilet: null, comment: '', found: [], photos: [] };
  SCALE_KEYS.forEach(([k]) => { base[k] = null; });
  R = base; prefill();
}
function prefill() {
  const r = R.placeId && R.reviewer ? S.data.reviews.find((x) => x.place_id === R.placeId && x.reviewer === R.reviewer) : null;
  if (!r) return;
  ['verdict', 'toilet', 'comment', ...SCALE_KEYS.map(([k]) => k)].forEach((k) => { R[k] = r[k] ?? (k === 'comment' ? '' : null); });
  R.toilet_present = r.toilet_present ?? 'unknown';
}

function viewRate() {
  if (!R || cur.p.fresh !== false) { startForm(cur.p.id); cur.p.fresh = false; history.replaceState(cur, ''); }
  const dups = R.mode === 'new' && (R.np.name || R.np.lat != null) ? findDuplicates(S.data.places, { name: R.np.name, lat: R.np.lat, lon: R.np.lon }) : [];
  const tp = R.toilet_present;
  $app.innerHTML = `${bar('Оценить заведение')}<form id="f" autocomplete="off">
    <label class="lbl" for="rv">Кто пишет</label>
    <select id="rv" name="reviewer"><option value="">— выберите —</option>${S.data.members.map((m) => `<option ${m === R.reviewer ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
    <label class="lbl" for="pl">Заведение</label>
    <select id="pl" name="place"><option value="">＋ Новое заведение</option>${[...S.sums].sort((a, b) => a.place.name.localeCompare(b.place.name, 'ru')).map((s) => `<option value="${s.place.id}" ${R.placeId === s.place.id ? 'selected' : ''}>${esc(s.place.name)}</option>`).join('')}</select>
    ${R.mode === 'new' ? `
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
    <div class="small muted" style="margin-top:4px">3 — ехать специально · 2 — стоит развернуться · 1 — рекомендуем, но не поедем · 0 — не рекомендуем</div>
    ${SCALE_KEYS.map(([k, n]) => `<div class="scale-row"><div class="name">${n}</div>${seg(k, [1, 2, 3, 4, 5], null, R[k])}</div>`).join('')}
    <div class="scale-row"><div class="name">Туалет</div>${seg('toilet_present', ['yes', 'no', 'unknown'], ['Есть', 'Нет', 'Не помню'], tp === true ? 'yes' : tp === false ? 'no' : tp)}</div>
    ${tp === true ? `<div class="scale-row"><div class="name">Оценка туалета</div>${seg('toilet', [1, 2, 3, 4, 5], null, R.toilet)}</div>` : ''}
    <label class="lbl" for="ph">Фото (до 5 на рецензию; сожмутся на телефоне)</label>
    <div class="form-thumbs">${R.photos.map((ph, i) => `<span class="thumb"><img src="${ph.url}" alt=""><button type="button" class="x" data-rm="${i}" aria-label="Убрать фото">×</button></span>`).join('')}</div>
    <input type="file" id="ph" accept="image/*" multiple ${R.photos.length >= 5 ? 'disabled' : ''}>
    <label class="lbl" for="cm">Комментарий</label><textarea id="cm" name="comment" maxlength="2000">${esc(R.comment)}</textarea>
    <div class="err" id="msg" role="alert"></div>
    <button class="btn accent block" id="send" style="margin-top:14px">Отправить</button></form>`;

  const f = $app.querySelector('#f'); const msg = f.querySelector('#msg');
  const redraw = () => { const y = window.scrollY; viewRate(); window.scrollTo(0, y); };
  f.addEventListener('change', async (e) => {
    const { name, value } = e.target;
    if (e.target.id === 'ph') {
      msg.textContent = '';
      for (const file of [...e.target.files].slice(0, 5 - R.photos.length)) {
        try { const blob = await compress(file); R.photos.push({ blob, url: URL.createObjectURL(blob) }); }
        catch { msg.textContent = 'Не удалось подготовить одно из фото (формат или размер).'; }
      }
      redraw(); return;
    }
    if (name === 'reviewer') { R.reviewer = value; if (value) { S.me = value; ls.set('gas_me', value); } prefill(); redraw(); }
    else if (name === 'place') { R.placeId = value ? Number(value) : null; R.mode = value ? 'exist' : 'new'; prefill(); redraw(); }
    else if (name === 'verdict') R.verdict = Number(value);
    else if (name === 'toilet_present') { R.toilet_present = value === 'yes' ? true : value === 'no' ? false : 'unknown'; if (value !== 'yes') R.toilet = null; redraw(); }
    else if (name === 'toilet' || SCALE_KEYS.some(([k]) => k === name)) R[name] = Number(value);
  });
  f.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name === 'comment') R.comment = value;
    else if (['name', 'kind', 'address'].includes(name)) { R.np[name] = value; if (name === 'name') clearTimeout(R.t), R.t = setTimeout(redrawKeepFocus, 600); }
  });
  const redrawKeepFocus = () => { const id = document.activeElement?.id; redraw(); if (id) document.getElementById(id)?.focus(); };
  f.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]'); if (rm) { const [gone] = R.photos.splice(Number(rm.dataset.rm), 1); URL.revokeObjectURL(gone.url); redraw(); return; }
    const pk = e.target.closest('[data-pick]'); if (pk) { e.preventDefault(); R.placeId = Number(pk.dataset.pick); R.mode = 'exist'; prefill(); redraw(); }
    const fd = e.target.closest('[data-found]'); if (fd) { const x = R.found[fd.dataset.found]; R.np.lat = +(+x.lat).toFixed(6); R.np.lon = +(+x.lon).toFixed(6); R.np.address = R.np.address || x.display_name; R.found = []; redraw(); }
  });
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
    if (!R.reviewer) miss.push('кто пишет');
    if (R.mode === 'new') {
      if (!R.np.name.trim()) miss.push('название'); if (!R.np.address.trim()) miss.push('адрес');
      if (R.np.lat == null) miss.push('точку на карте');
    } else if (!R.placeId) miss.push('заведение');
    if (R.verdict == null) miss.push('общий вердикт');
    SCALE_KEYS.forEach(([k, n]) => { if (R[k] == null) miss.push(n.toLowerCase()); });
    if (R.toilet_present === undefined) miss.push('туалет (есть / нет / не помню)');
    else if (R.toilet_present === true && R.toilet == null) miss.push('оценку туалета');
    if (miss.length) { msg.textContent = `Не заполнено: ${miss.join(', ')}.`; return; }
    e.target.disabled = true;
    guard(async () => {
      let id = R.placeId;
      if (R.mode === 'new') id = await api.savePlace({ name: R.np.name.trim(), kind: R.np.kind.trim(), address: R.np.address.trim(), lat: R.np.lat, lon: R.np.lon });
      await api.saveReview({
        place_id: id, reviewer: R.reviewer, verdict: R.verdict, access: R.access, taste: R.taste, service: R.service, clean: R.clean, impression: R.impression,
        toilet_present: R.toilet_present === 'unknown' ? null : R.toilet_present, toilet: R.toilet, comment: R.comment.trim(),
      });
      let failed = 0;
      for (const ph of R.photos) {
        try { await api.addPhoto(id, R.reviewer, await toBase64(ph.blob)); } catch (err) { if (err instanceof ApiError && err.kind === 'bad_code') throw err; failed++; }
        URL.revokeObjectURL(ph.url);
      }
      R = null; await refresh(); go('detail', { id }, true);
      if (failed) alert(`Рецензия сохранена, но ${failed} фото не загрузились (возможно, уже 5 фото или нет связи). Добавьте их через «Изменить мою рецензию».`);
    }, msg).finally(() => { e.target.disabled = false; });
  };
}

// ---------- слот-машина ----------
const T = { rig: ls.get('gas_rig') !== '0', nearby: ls.get('gas_nearby') !== '0', center: null, radius: 5, geo: 'idle', spinning: false, manual: false };
const ROW = 40; // высота строки барабана, px (как в стилях .reel .cell)
const G = () => window.gsap; // если GSAP не загрузился, всё работает без анимации
const calm = () => !G() || matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);

function viewSlot() {
  const pool = () => slotPool(S.sums, { nearby: T.nearby, center: T.center, radiusKm: T.radius });
  const status = () => {
    if (!T.nearby && T.geo === 'failed') return 'Геолокация недоступна, поэтому поиск рядом выключен. Включите «Рядом» и поставьте точку на карте.';
    if (!T.nearby) return 'Поиск по радиусу выключен: берём любое место на 2–3 звезды.';
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
      if (empty && (!T.nearby || T.center)) $('#out').innerHTML = `<div class="notice">${ico('warn')}<span>${T.nearby ? 'Рядом нет мест на 2–3 звезды.' : 'Пока нет мест на 2–3 звезды. Оцените что-нибудь!'}</span></div>`;
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
      const endY = -(seq.length - 3) * ROW;
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
    $('#out').innerHTML = `<div class="result"><div class="row" style="align-items:flex-start;gap:12px"><div class="grow"><h3>${esc(win.place.name)}</h3>
      <div class="muted small" style="margin-top:6px">${esc(win.place.address)}${km != null ? ` · ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} км` : ''}</div></div>
      <div class="big b${win.stars}">${win.stars}<small>/3</small></div></div>
      ${barsHtml(win.scores, ['taste', 'service', 'toilet'])}
      <div class="row"><a class="btn accent" style="flex:1.3" href="${esc(mapsLink(win.place.lat, win.place.lon, win.place.name, ios))}">Открыть в картах</a>
      <button class="btn" style="flex:1" data-act="go" data-view="detail" data-id="${win.place.id}">Подробнее</button></div></div>`;
    paintStatus();
    if (calm()) return;
    const g = G();
    g.fromTo('.reel .cell.hit', { scale: 0.8 }, { scale: 1, duration: 0.5, ease: 'back.out(3)' });
    g.fromTo('#machine', { boxShadow: '0 0 0 0 rgba(200,242,90,0)' }, { boxShadow: '0 0 36px 2px rgba(200,242,90,.35)', duration: 0.4, yoyo: true, repeat: 1 });
    const machine = $('#machine'); const colors = ['#C8F25A', '#8F82FF', '#FFB86B'];
    for (let k = 0; k < 18; k++) {
      const el = Object.assign(document.createElement('i'), { className: 'fx' }); el.style.background = colors[k % 3];
      el.style.left = `${machine.clientWidth / 2}px`; el.style.top = '78px'; machine.appendChild(el);
      g.fromTo(el, { x: 0, y: 0, scale: 1, rotation: 0, autoAlpha: 1 }, { x: rnd(-150, 150), y: rnd(-80, 70), rotation: rnd(-200, 200), scale: 0, duration: 0.9, ease: 'power2.out', onComplete: () => el.remove() });
    }
    g.from('.result', { y: 24, autoAlpha: 0, duration: 0.5, ease: 'power3.out' });
    g.from('.result .seg5 i.on', { scaleX: 0, transformOrigin: 'left center', duration: 0.4, stagger: 0.04, delay: 0.2 });
  }
}

// ---------- старт ----------
(async () => {
  viewLoading();
  await refresh();
  render();
})();
