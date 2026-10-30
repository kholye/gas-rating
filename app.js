import {
  SCALES, summarize, slotPool, searchSummaries, sortSummaries, findDuplicates,
  distanceKm, mapsLink, readCode, parsePastedLink,
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
const themeIcon = () => ({ light: '☀', dark: '☾' }[ls.get('gas_theme')] ?? '◐');

// ---------- общие куски разметки ----------
const stars = (n) => (n == null ? '<span class="muted small">нет оценок</span>'
  : n === 0 ? '<span class="zero">0 · не рекомендуем</span>'
  : `<span class="stars" aria-label="${n} из 3 звёзд">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`);
const bar = (title, back = true) => `<header class="bar">${back ? '<button class="back" data-act="back">‹ Назад</button>' : ''}<h1>${esc(title)}</h1><button class="icon-btn" data-act="theme" aria-label="Сменить тему">${themeIcon()}</button></header>`;
const scoresHtml = (sc) => `<div class="scores">${SCALES.map(([k, n]) => `<div><span>${n}</span><b>${fmt(sc[k])}</b></div>`).join('')}</div>`;
const toiletText = (r) => (r.toilet_present === true ? String(r.toilet ?? '—') : r.toilet_present === false ? 'нет' : 'не помню');
const reviewScores = (r) => `<div class="scores">${SCALES.map(([k, n]) => `<div><span>${n}</span><b>${k === 'toilet' ? toiletText(r) : r[k]}</b></div>`).join('')}</div>`;

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
  $app.innerHTML = `${bar('G.A.S. Rating', false)}
    ${isDemo ? '<div class="notice">Демо-режим: выдуманные примеры. Настоящая база подключается в <code>config.js</code>.</div>' : ''}
    <p class="muted" style="margin-top:0">Мест оценено: <b>${rated}</b> · нас ${S.data.members.length}</p>
    <button class="menu-btn primary" data-act="go" data-view="slot"><span class="ico">🎰</span><span><b>Куда едем сегодня?</b><small>слот-машина решит за нас</small></span></button>
    <button class="menu-btn" data-act="go" data-view="list"><span class="ico">📋</span><span><b>Все оценённые</b><small>список, поиск, фильтры</small></span></button>
    <button class="menu-btn" data-act="go" data-view="map"><span class="ico">🗺</span><span><b>Карта</b><small>где что находится</small></span></button>
    <button class="menu-btn" data-act="go" data-view="rate"><span class="ico">✍️</span><span><b>Оценить заведение</b><small>новая или обновлённая рецензия</small></span></button>
    <div class="row wrap" style="margin-top:18px"><label class="small muted" for="me">Вы:</label>
      <select id="me" style="width:auto;flex:1"><option value="">— выберите —</option>${S.data.members.map((m) => `<option ${m === me ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <button class="btn" id="backup">Скачать копию</button></div>`;
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
      <div class="chips"><span class="chip">${esc(s.place.kind || 'место')}</span><span class="chip">вкус ${fmt(s.scores.taste)}</span><span class="chip">оценили ${s.count} из ${s.memberCount}</span></div></button>`).join('')
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
  $app.innerHTML = `${bar(p.name)}
    <div class="card"><div class="row"><div class="grow">${stars(s.stars)}<div class="meta muted small">${esc(p.kind || '')} · ${esc(p.address)}</div></div></div>
      ${s.count ? scoresHtml(s.scores) : ''}
      <div class="row wrap" style="margin-top:12px"><a class="btn" style="display:inline-flex;align-items:center;text-decoration:none" href="${esc(mapsLink(p.lat, p.lon, p.name, ios))}">Открыть в картах</a>
        <button class="btn accent" data-act="go" data-view="rate" data-id="${p.id}">${mine ? 'Изменить мою рецензию' : 'Оценить'}</button></div></div>
    ${s.reviews.map((r) => `<div class="card"><div class="row"><b class="grow">${esc(r.reviewer)}</b>${stars(r.verdict)}</div>${reviewScores(r)}${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</div>`).join('') || '<p class="muted">Пока нет рецензий.</p>'}
    <div class="err" id="msg"></div>
    <div class="row wrap">${mine ? '<button class="btn danger" id="delrev">Удалить мою рецензию</button>' : ''}${!s.count ? '<button class="btn danger" id="delplace">Удалить заведение</button>' : ''}</div>`;
  const msg = $app.querySelector('#msg');
  const del = $app.querySelector('#delrev');
  if (del) del.onclick = () => confirm('Удалить вашу рецензию?') && guard(async () => { await api.deleteReview(p.id, S.me); await refresh(); go('detail', { id: p.id }, true); }, msg);
  const dp = $app.querySelector('#delplace');
  if (dp) dp.onclick = () => confirm('Удалить заведение?') && guard(async () => { await api.deletePlace(p.id); await refresh(); go('list', {}, true); }, msg);
}

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
    np: { name: '', kind: '', address: '', lat: null, lon: null }, verdict: null, toilet_present: undefined, toilet: null, comment: '', found: [] };
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
    ${seg('verdict', [0, 1, 2, 3], ['0 · нет', '★', '★★', '★★★'], R.verdict)}
    <div class="small muted" style="margin-top:4px">3 — ехать специально · 2 — стоит развернуться · 1 — рекомендуем, но не поедем · 0 — не рекомендуем</div>
    ${SCALE_KEYS.map(([k, n]) => `<div class="scale-row"><div class="name">${n}</div>${seg(k, [1, 2, 3, 4, 5], null, R[k])}</div>`).join('')}
    <div class="scale-row"><div class="name">Туалет</div>${seg('toilet_present', ['yes', 'no', 'unknown'], ['Есть', 'Нет', 'Не помню'], tp === true ? 'yes' : tp === false ? 'no' : tp)}</div>
    ${tp === true ? `<div class="scale-row"><div class="name">Оценка туалета</div>${seg('toilet', [1, 2, 3, 4, 5], null, R.toilet)}</div>` : ''}
    <label class="lbl" for="cm">Комментарий</label><textarea id="cm" name="comment" maxlength="2000">${esc(R.comment)}</textarea>
    <div class="err" id="msg" role="alert"></div>
    <button class="btn accent block" id="send" style="margin-top:14px">Отправить</button></form>`;

  const f = $app.querySelector('#f'); const msg = f.querySelector('#msg');
  const redraw = () => { const y = window.scrollY; viewRate(); window.scrollTo(0, y); };
  f.addEventListener('change', (e) => {
    const { name, value } = e.target;
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
      R = null; await refresh(); go('detail', { id }, true);
    }, msg).finally(() => { e.target.disabled = false; });
  };
}

// ---------- слот-машина ----------
const T = { nearby: ls.get('gas_nearby') !== '0', center: null, radius: 5, geo: 'idle', spinning: false, manual: false };
const CELL = 84;
function viewSlot() {
  T.geo = T.geo === 'idle' && T.nearby ? 'asking' : T.geo;
  const pool = () => slotPool(S.sums, { nearby: T.nearby, center: T.center, radiusKm: T.radius });
  const status = () => {
    if (!T.nearby && T.geo === 'failed') return 'Геолокация недоступна, поэтому поиск рядом выключен. Включите «Только рядом» и поставьте точку на карте.';
    if (!T.nearby) return 'Поиск по радиусу выключен: берём любое место на 2–3 звезды.';
    if (T.geo === 'asking') return 'Определяю, где вы…';
    if (!T.center) return 'Не знаю, где вы. Поставьте точку на карте или выключите «Только рядом».';
    return `Ищу в радиусе ${T.radius} км от ${T.manual ? 'выбранной точки' : 'вас'}.`;
  };
  $app.innerHTML = `${bar('Куда едем сегодня?')}
    <label class="switch"><input type="checkbox" id="nb" ${T.nearby ? 'checked' : ''}><span>Только рядом</span></label>
    <div class="small muted" id="st"></div>
    <div id="pickwrap" class="${T.manual ? '' : 'hidden'}"><div id="pickmap"></div></div>
    <div class="row wrap" id="geoBtns" style="margin:6px 0"></div>
    <div class="machine"><div class="reels" aria-hidden="true">${[0, 1, 2].map((i) => `<div class="reel" id="reel${i}"><div class="strip"><div class="cell">${['G', 'A', 'S'][i]}</div></div></div>`).join('')}</div>
      <button class="lever" id="lever" aria-label="Дёрнуть ручку"><span class="rod"></span><span class="knob"></span><span class="base"></span></button></div>
    <div id="out" aria-live="polite"></div>`;
  const $ = (s) => $app.querySelector(s);
  const paintStatus = () => {
    $('#st').textContent = status();
    const empty = pool().length === 0;
    $('#geoBtns').innerHTML = `${T.nearby ? '<button class="btn" id="setpt">Поставить точку на карте</button>' : ''}
      ${T.nearby && empty && T.center && T.radius < 15 ? '<button class="btn" id="wider">Расширить до 15 км</button>' : ''}
      ${T.nearby && empty && T.center ? '<button class="btn" id="off">Выключить поиск рядом</button>' : ''}`;
    $('#lever').disabled = T.spinning || empty || (T.nearby && !T.center);
    if (empty && (!T.nearby || T.center)) $('#out').innerHTML = `<div class="notice">${T.nearby ? 'Рядом нет мест на 2–3 звезды.' : 'Пока нет мест на 2–3 звезды. Оцените что-нибудь!'}</div>`;
    else if ($('#out .notice')) $('#out').innerHTML = '';
    const b = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
    b('#setpt', () => { T.manual = true; $('#pickwrap').classList.remove('hidden'); mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paintStatus(); }); });
    b('#wider', () => { T.radius = 15; paintStatus(); });
    b('#off', () => { T.nearby = false; ls.set('gas_nearby', '0'); $('#nb').checked = false; paintStatus(); });
    if (T.manual && !S.pick) mountPicker('pickmap', T.center, (c) => { T.center = c; T.geo = 'done'; paintStatus(); });
  };
  const locate = () => {
    if (!T.nearby || T.center) return;
    if (!navigator.geolocation) { T.geo = 'failed'; T.nearby = false; paintStatus(); return; }
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
  paintStatus(); locate();

  $('#lever').onclick = () => {
    const p = pool(); if (!p.length || T.spinning) return;
    T.spinning = true; $('#lever').disabled = true; $('#out').innerHTML = '';
    const lever = $('#lever'); lever.classList.add('pulled'); setTimeout(() => lever.classList.remove('pulled'), 220);
    const win = p[Math.floor(Math.random() * p.length)];
    const names = p.map((s) => s.place.name);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let done = 0;
    [0, 1, 2].forEach((i) => {
      const n = 14 + i * 5;
      const seq = Array.from({ length: n }, () => names[Math.floor(Math.random() * names.length)]); seq.push(win.place.name);
      const strip = $(`#reel${i} .strip`);
      strip.innerHTML = seq.map((x) => `<div class="cell">${esc(x)}</div>`).join('');
      const end = `translateY(-${(seq.length - 1) * CELL}px)`;
      const finish = () => { strip.style.transform = end; if (++done === 3) reveal(win); };
      if (reduce) return finish();
      strip.animate([{ transform: 'translateY(0)' }, { transform: end }], { duration: 1500 + i * 600, easing: 'cubic-bezier(.12,.7,.2,1)', fill: 'forwards' }).onfinish = finish;
    });
  };
  function reveal(win) {
    T.spinning = false;
    const km = T.center ? distanceKm(T.center.lat, T.center.lon, win.place.lat, win.place.lon) : null;
    $('#out').innerHTML = `<div class="card result"><div class="row"><b class="grow">${esc(win.place.name)}</b>${stars(win.stars)}</div>
      <div class="meta muted small">${esc(win.place.address)}${km != null ? ` · ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} км` : ''}</div>
      ${scoresHtml(win.scores)}
      <div class="row wrap" style="margin-top:12px"><a class="btn accent" style="display:inline-flex;align-items:center;text-decoration:none" href="${esc(mapsLink(win.place.lat, win.place.lon, win.place.name, ios))}">Открыть в картах</a>
      <button class="btn" data-act="go" data-view="detail" data-id="${win.place.id}">Подробнее</button></div></div>`;
    paintStatus();
  }
}

// ---------- старт ----------
(async () => {
  viewLoading();
  await refresh();
  render();
})();
