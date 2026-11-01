// Связь с базой. Две реализации с одним набором методов: live (Supabase) и demo (выдуманные примеры в localStorage).
// Роль (админ или участник) и автор определяет сервер по личному ключу; p_author браузера сервер игнорирует (оставлен для совместимости).
import { CONFIG } from './config.js';

export const isDemo = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

// kind: 'bad_code' | 'offline' | 'db' | 'forbidden' | 'rejected'
export class ApiError extends Error {
  constructor(kind, detail = '') { super(kind); this.kind = kind; this.detail = detail; }
}

// Два пути к базе. 'direct' — напрямую в Supabase. 'proxy' — через шлюз Яндекса (API_BASE в config.js, local/proxy/api-gateway.yaml):
// у части российских провайдеров соединения с Supabase (он за Cloudflare) обрываются, а Яндекс доступен; зато через VPN
// с иностранным адресом шлюз Яндекса может быть недоступен. Поэтому сайт пробует оба пути и запоминает тот, что сработал.
// Через шлюз запрос «простой» (text/plain, без своих заголовков): браузеру не нужен лишний предварительный запрос, ключ добавляет шлюз.
const ROUTES = CONFIG.API_BASE ? ['proxy', 'direct'] : ['direct'];
const ROUTE_KEY = 'gas_route';
const rpcUrl = (fn, route = ROUTES[0]) => `${route === 'proxy' ? CONFIG.API_BASE.replace(/\/$/, '') : `${CONFIG.SUPABASE_URL}/rest/v1`}/rpc/${fn}`;
const rpcHeaders = (route = ROUTES[0]) => {
  if (route === 'proxy') return { 'Content-Type': 'text/plain;charset=UTF-8' };
  const h = { apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (!CONFIG.SUPABASE_ANON_KEY.startsWith('sb_')) h.Authorization = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
  return h;
};
let route = (() => { try { const r = localStorage.getItem(ROUTE_KEY); return ROUTES.includes(r) ? r : ROUTES[0]; } catch { return ROUTES[0]; } })();
const remember = (r) => { route = r; try { localStorage.setItem(ROUTE_KEY, r); } catch { /* необязательно */ } };
export const currentRoute = () => route;
// Чтения и повторяемые записи можно безопасно повторить, если связь оборвалась (повтор не создаст дубль).
const RETRY = new Set(['get_all', 'get_photos', 'get_photo', 'get_covers', 'list_invites', 'save_review', 'update_avatar', 'resolve_link', 'room_get']);

// trouble(fn, kind, info): сообщение для журнала ошибок, когда запрос окончательно не удался или сайт сменил путь к базе.
const live = (getCode, getAuthor, trouble = () => {}) => {
  // timeout покрывает весь ответ, включая чтение тела: у некоторых провайдеров соединение «замирает» посреди ответа,
  // и без этого экран «Загружаю…» или фото висели бы вечно. Обрыв в любом месте = 'offline'.
  const once = async (fn, args, timeout, via) => {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      let r; let text;
      try {
        r = await fetch(rpcUrl(fn, via), { method: 'POST', headers: rpcHeaders(via), signal: ctl.signal, body: JSON.stringify({ p_code: getCode(), p_author: getAuthor(), ...args }) });
        text = await r.text();
      } catch { throw new ApiError('offline'); }
      if (r.ok) { try { return text ? JSON.parse(text) : null; } catch { throw new ApiError('offline'); } }
      let msg = '';
      try { msg = JSON.parse(text).message || ''; } catch { /* тело не JSON */ }
      if (msg.includes('bad_code')) throw new ApiError('bad_code');
      if (msg.includes('forbidden')) throw new ApiError('forbidden');
      if (r.status >= 500 || r.status === 404 || r.status === 405) throw new ApiError('db', String(r.status));
      throw new ApiError('rejected', msg);
    } finally { clearTimeout(timer); }
  };
  // Сначала запомненный путь; при обрыве повторяемые запросы пробуют другой путь (или тот же ещё раз, если путь один).
  const call = async (fn, args, timeout = 20000) => {
    const first = route;
    try { return await once(fn, args, timeout, first); }
    catch (e) {
      if (fn === 'log_error') throw e; // сбой самого журнала не записываем
      if (!RETRY.has(fn) || (e.kind !== 'offline' && e.kind !== 'db')) { if (e.kind === 'offline' || e.kind === 'db') trouble(fn, e.kind, `путь ${first}${e.detail ? `, код ${e.detail}` : ''}`); throw e; }
      const other = ROUTES.find((r) => r !== first) ?? first;
      if (other === first) await new Promise((r) => setTimeout(r, 800));
      try {
        const res = await once(fn, args, timeout, other);
        if (other !== first) { remember(other); trouble(fn, 'route', `путь ${first} не ответил (${e.kind}), сайт перешёл на ${other}`); }
        return res;
      } catch (e2) { if (e2.kind === 'offline' || e2.kind === 'db') trouble(fn, e2.kind, `пути ${first} и ${other} не ответили`); throw e2; }
    }
  };
  return {
    getAll: () => call('get_all', {}),
    savePlace: (p) => call('save_place', { p_id: p.id ?? null, p_name: p.name, p_kind: p.kind || null, p_address: p.address, p_lat: p.lat, p_lon: p.lon }),
    saveReview: (r) => call('save_review', {
      p_place_id: r.place_id, p_name: r.anon ? null : r.name, p_anon: !!r.anon, p_verdict: r.verdict, p_access: r.access, p_taste: r.taste,
      p_service: r.service, p_clean: r.clean, p_impression: r.impression,
      p_toilet_present: r.toilet_present, p_toilet: r.toilet_present ? r.toilet : null, p_comment: r.comment || null, p_avatar_seed: r.avatar_seed ?? null, p_price_from: r.price_from ?? null, p_price_to: r.price_to ?? null,
    }),
    setAvatar: (seed) => call('update_avatar', { p_seed: seed }),
    deleteReview: (review_id) => call('delete_review', { p_review_id: review_id }),
    deletePlace: (id) => call('delete_place', { p_id: id }),
    addPhoto: (place_id, b64, thumb) => call('add_photo', { p_place_id: place_id, p_data: b64, p_thumb: thumb ?? null }, 90000),
    getPhotos: (place_id) => call('get_photos', { p_place_id: place_id }, 45000),
    getPhoto: (id) => call('get_photo', { p_id: id }, 90000),                 // полное фото по нажатию
    getCovers: (ids) => call('get_covers', { p_ids: ids }, 45000),            // миниатюры для баннеров одним запросом
    deletePhoto: (id) => call('delete_photo', { p_id: id }),
    listInvites: () => call('list_invites', {}),
    createInvite: (name) => call('create_invite', { p_name: name }),
    rotateInvite: (member) => call('rotate_invite', { p_member: member }),
    revokeInvite: (member) => call('revoke_invite', { p_member: member }),
    deleteInvite: (member) => call('delete_invite', { p_member: member }),
    logError: (x) => call('log_error', { p_kind: x.kind, p_message: x.message, p_detail: x.detail || null, p_url: x.url || null, p_ua: x.ua || null, p_version: x.version || null }, 10000),
    listErrors: () => call('list_errors', {}),
    resolveLink: (url) => call('resolve_link', { p_url: url }, 20000), // короткая ссылка карт → полная
    clearErrors: () => call('clear_errors', {}),
    // «Вместе»: общая комната автомата (local/migration-15.sql)
    roomCreate: () => call('room_create', {}),
    roomGet: (id) => call('room_get', { p_id: id }, 12000),
    roomSpin: (id, seen, placeId, reels) => call('room_spin', { p_id: id, p_seen: seen, p_place_id: placeId, p_reels: reels }),
    roomVeto: (id, n) => call('room_veto', { p_id: id, p_n: n }),
  };
};

// ---- демо: ВЫДУМАННЫЕ примеры, настоящие оценки сюда не кладём (репозиторий публичный) ----
// В демо ключ «admin» включает режим админа, любой другой (или пустой) — обычный участник.
const DEMO_KEY = 'gas_demo_v3';
const demoSeed = () => {
  const rv = (id, place_id, author, author_name, verdict, a, t, s, c, tp, tl, i, comment = '') =>
    ({ id, place_id, author, author_name, verdict, access: a, taste: t, service: s, clean: c, toilet_present: tp, toilet: tl, impression: i, comment, created_at: '2026-01-01', updated_at: '2026-01-01' });
  return {
    next: 100,
    places: [
      { id: 1, name: 'Пример: Кофейня «Зерно»', kind: 'Кофейня', address: 'Невский пр., 1', lat: 59.9361, lon: 30.3141, created_at: '2026-01-01' },
      { id: 2, name: 'Пример: Бургерная «Лук»', kind: 'Бургеры и фастфуд', address: 'Лиговский пр., 10', lat: 59.9306, lon: 30.3607, created_at: '2026-01-02' },
      { id: 3, name: 'Пример: Рамен-бар', kind: 'Рамен и японская', address: 'Садовая ул., 12', lat: 59.9267, lon: 30.3200, created_at: '2026-01-03' },
      { id: 4, name: 'Пример: Шаурма у метро', kind: 'Шаурма', address: 'Московский пр., 100', lat: 59.8870, lon: 30.3190, created_at: '2026-01-04' },
      { id: 5, name: 'Пример: Хинкальная «Гора»', kind: 'Грузинская', address: 'ул. Рубинштейна, 20', lat: 59.9290, lon: 30.3460, created_at: '2026-01-05', added_by: 'demo-a' },
      { id: 6, name: 'Пример: Пекарня «Тесто»', kind: 'Пекарня', address: 'Большой пр. П.С., 30', lat: 59.9590, lon: 30.3010, created_at: '2026-01-06', added_by: 'demo-b' },
    ],
    reviews: [
      rv(1, 1, 'demo-a', 'Аня', 3, 5, 5, 4, 5, true, 5, 5, 'Лучший флэт уайт'),
      rv(2, 1, 'demo-b', 'Борис', 3, 5, 4, 4, 5, true, 4, 5),
      rv(8, 3, 'demo-a', 'Аня', 3, 4, 5, 4, 4, true, 4, 5),
      rv(3, 1, 'demo-c', null, 0, 2, 2, 2, 3, false, null, 2, 'Долго ждали, кофе остыл'),
      rv(4, 2, 'demo-a', 'Аня', 2, 4, 4, 3, 3, false, null, 4),
      rv(5, 2, 'demo-c', null, 1, 4, 3, 3, 3, null, null, 3),
      rv(6, 3, 'demo-b', 'Борис', 3, 3, 5, 5, 5, true, 5, 5, 'Бульон огонь'),
      rv(7, 4, 'demo-c', null, 0, 5, 3, 2, 2, false, null, 2, 'Больше не пойдём'),
    ].map((r) => ({ ...r, avatar_seed: r.author_name ? { 'demo-a': 3300111, 'demo-b': 4400222 }[r.author] ?? 1 : null })),
  };
};
const DEMO_NAMES = { 'demo-a': 'Аня', 'demo-b': 'Борис' };
const demo = (getCode, getAuthor) => {
  const load = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || demoSeed(); } catch { return demoSeed(); } };
  const save = (d) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* нет хранилища: изменения живут до перезагрузки */ } };
  let mem = load();
  const commit = () => save(mem);
  const role = () => (getCode() === 'admin' ? 'admin' : 'user');
  const photos = []; // в демо фото живут только до перезагрузки страницы (чтобы не переполнить хранилище)
  let nextPhoto = 1;
  let nextMember = 1;
  const invites = [{ author: 'demo-a', name: 'Аня', has_key: true, created_at: '2026-01-01' }, { author: 'demo-b', name: 'Борис', has_key: false, created_at: '2026-01-02' }];
  const forbid = () => { throw new ApiError('forbidden'); };
  const rooms = {};
  const roomState = (id, accepted = null) => {
    const r = rooms[id];
    return structuredClone({ id, accepted, people: [{ name: 'Вы', seed: 1, me: true, here: true }, { name: 'Аня', seed: 3300111, me: false, here: true }],
      spins: r.spins.map((s) => ({ n: s.n, place_id: s.place_id, reels: s.reels, at: s.at, by_name: 'Вы', by_me: true, veto_name: s.veto ? 'Вы' : null, veto_me: s.veto === 'me' })),
      my_veto: !r.spins.some((s) => s.veto === 'me'), tries_left: 3 - r.spins.filter((s) => !s.veto).length });
  };
  return {
    getAll: async () => {
      const me = getAuthor(); const adm = role() === 'admin';
      return structuredClone({
        role: role(), places: mem.places.map(({ added_by, ...p }) => ({ ...p, mine: !!added_by && added_by === me, added_by_name: added_by ? DEMO_NAMES[added_by] || 'Вы' : null })),
        reviews: mem.reviews.map(({ author, ...r }) => ({ ...r, mine: author === me, ...(adm ? { author } : {}) })),
      });
    },
    savePlace: async (p) => {
      if (p.id == null) { const id = mem.next++; mem.places.push({ ...p, id, created_at: new Date().toISOString(), added_by: getAuthor() }); commit(); return id; }
      if (role() !== 'admin') forbid();
      Object.assign(mem.places.find((x) => x.id === p.id), p); commit(); return p.id;
    },
    saveReview: async (r) => {
      const now = new Date().toISOString(); const me = getAuthor();
      const i = mem.reviews.findIndex((x) => x.place_id === r.place_id && x.author === me);
      const row = { ...r, author: me, author_name: r.anon ? null : r.name, avatar_seed: r.anon ? null : (r.avatar_seed ?? null), toilet: r.toilet_present ? r.toilet : null, updated_at: now };
      delete row.anon; delete row.name;
      if (i >= 0) mem.reviews[i] = { ...mem.reviews[i], ...row }; else mem.reviews.push({ ...row, id: mem.next++, created_at: now });
      commit();
    },
    setAvatar: async (seed) => { mem.reviews.forEach((x) => { if (x.author === getAuthor() && x.author_name) x.avatar_seed = seed; }); commit(); },
    deleteReview: async (review_id) => {
      const r = mem.reviews.find((x) => x.id === review_id);
      if (!r || (role() !== 'admin' && r.author !== getAuthor())) forbid();
      mem.reviews = mem.reviews.filter((x) => x.id !== review_id);
      for (let i = photos.length - 1; i >= 0; i--) if (photos[i].review_id === review_id) photos.splice(i, 1);
      commit();
    },
    addPhoto: async (place_id, data, thumb) => {
      const r = mem.reviews.find((x) => x.place_id === place_id && x.author === getAuthor());
      if (!r) throw new ApiError('rejected', 'no_such_review');
      if (photos.filter((p) => p.review_id === r.id).length >= 5) throw new ApiError('rejected', 'too_many_photos');
      photos.push({ id: nextPhoto++, review_id: r.id, place_id, data, thumb }); return nextPhoto - 1;
    },
    getPhotos: async (place_id) => photos.filter((p) => p.place_id === place_id).map((p) => {
      const r = mem.reviews.find((x) => x.id === p.review_id);
      return { id: p.id, review_id: p.review_id, mine: !!r && r.author === getAuthor(), thumb: !!p.thumb, data: p.thumb ?? p.data };
    }),
    getPhoto: async (id) => photos.find((p) => p.id === id)?.data ?? null,
    getCovers: async (ids) => ids.map((id) => ({ place_id: id, data: photos.find((p) => p.place_id === id && p.thumb)?.thumb })).filter((c) => c.data),
    deletePhoto: async (id) => {
      const i = photos.findIndex((p) => p.id === id); if (i < 0) return;
      const r = mem.reviews.find((x) => x.id === photos[i].review_id);
      if (role() !== 'admin' && (!r || r.author !== getAuthor())) forbid();
      photos.splice(i, 1);
    },
    // приглашения в демо живут до перезагрузки страницы
    listInvites: async () => { if (role() !== 'admin') forbid(); return structuredClone(invites.map((m) => ({ ...m, reviews: mem.reviews.filter((r) => r.author === m.author).length }))); },
    createInvite: async (name) => {
      if (role() !== 'admin') forbid();
      const m = { author: `demo-${nextMember++}`, name, has_key: true, created_at: new Date().toISOString() }; invites.push(m);
      return { author: m.author, key: `demo${Math.random().toString(16).slice(2).padEnd(30, '0')}` };
    },
    rotateInvite: async (member) => { if (role() !== 'admin') forbid(); invites.find((m) => m.author === member).has_key = true; return `demo${Math.random().toString(16).slice(2).padEnd(30, '0')}`; },
    revokeInvite: async (member) => { if (role() !== 'admin') forbid(); invites.find((m) => m.author === member).has_key = false; },
    logError: async () => {},
    listErrors: async () => { if (role() !== 'admin') forbid(); return []; },
    resolveLink: async () => null,
    clearErrors: async () => {},
    deleteInvite: async (member) => { if (role() !== 'admin') forbid(); const i = invites.findIndex((m) => m.author === member); if (i >= 0) invites.splice(i, 1); },
    deletePlace: async (id) => {
      if (mem.reviews.some((x) => x.place_id === id)) throw new ApiError('rejected', 'place_has_reviews');
      if (role() !== 'admin' && mem.places.find((p) => p.id === id)?.added_by !== getAuthor()) forbid();
      mem.places = mem.places.filter((p) => p.id !== id); commit();
    },
    // «Вместе» в демо: комната живёт до перезагрузки, второй участник — выдуманная Аня
    roomCreate: async () => { const id = Math.random().toString(16).slice(2, 14); rooms[id] = { spins: [] }; return roomState(id); },
    roomGet: async (id) => { if (!rooms[id]) throw new ApiError('rejected', 'no_room'); return roomState(id); },
    roomSpin: async (id, seen, placeId, reels) => {
      const r = rooms[id]; if (!r) throw new ApiError('rejected', 'no_room');
      if (seen !== r.spins.length || r.spins.filter((s) => !s.veto).length >= 3) return roomState(id, false);
      r.spins.push({ n: r.spins.length + 1, place_id: placeId, reels, at: new Date().toISOString(), veto: null }); return roomState(id, true);
    },
    roomVeto: async (id, n) => {
      const r = rooms[id]; const s = r?.spins[n - 1];
      if (!s || n !== r.spins.length || s.veto || r.spins.some((x) => x.veto === 'me')) return roomState(id, false);
      s.veto = 'me'; return roomState(id, true);
    },
  };
};

// Проверка связи: сколько байт дошло и за сколько, без разбора ответа. Показывает «замирание» соединения посреди ответа.
export async function probe(url, init = {}, timeout = 20000) {
  const t0 = performance.now(); let bytes = 0; let status = 0;
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, signal: ctl.signal }); status = r.status;
    const reader = r.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; }
    return { ok: r.ok, status, bytes, ms: Math.round(performance.now() - t0) };
  } catch { return { ok: false, status, bytes, ms: Math.round(performance.now() - t0), stalled: true }; } finally { clearTimeout(timer); }
}
export const probeRpc = (fn, body, timeout, via) => probe(rpcUrl(fn, via), { method: 'POST', headers: rpcHeaders(via), body: JSON.stringify(body) }, timeout);
export const routes = () => [...ROUTES];

export const makeApi = (getCode, getAuthor, trouble) => (isDemo ? demo(getCode, getAuthor) : live(getCode, getAuthor, trouble));
