// Связь с базой. Две реализации с одним набором методов: live (Supabase) и demo (выдуманные примеры в localStorage).
// Роль (админ или участник) и автор определяет сервер по личному ключу; p_author браузера сервер игнорирует (оставлен для совместимости).
import { CONFIG } from './config.js';

export const isDemo = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

// kind: 'bad_code' | 'offline' | 'db' | 'forbidden' | 'rejected'
export class ApiError extends Error {
  constructor(kind, detail = '') { super(kind); this.kind = kind; this.detail = detail; }
}

const live = (getCode, getAuthor) => {
  const call = async (fn, args) => {
    const headers = { apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
    if (!CONFIG.SUPABASE_ANON_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
    let r;
    try {
      r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify({ p_code: getCode(), p_author: getAuthor(), ...args }) });
    } catch { throw new ApiError('offline'); }
    if (r.ok) return r.status === 204 ? null : r.json();
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* тело не JSON */ }
    if (msg.includes('bad_code')) throw new ApiError('bad_code');
    if (msg.includes('forbidden')) throw new ApiError('forbidden');
    if (r.status >= 500 || r.status === 404) throw new ApiError('db', String(r.status));
    throw new ApiError('rejected', msg);
  };
  return {
    getAll: () => call('get_all', {}),
    savePlace: (p) => call('save_place', { p_id: p.id ?? null, p_name: p.name, p_kind: p.kind || null, p_address: p.address, p_lat: p.lat, p_lon: p.lon }),
    saveReview: (r) => call('save_review', {
      p_place_id: r.place_id, p_name: r.anon ? null : r.name, p_anon: !!r.anon, p_verdict: r.verdict, p_access: r.access, p_taste: r.taste,
      p_service: r.service, p_clean: r.clean, p_impression: r.impression,
      p_toilet_present: r.toilet_present, p_toilet: r.toilet_present ? r.toilet : null, p_comment: r.comment || null, p_avatar_seed: r.avatar_seed ?? null,
    }),
    setAvatar: (seed) => call('update_avatar', { p_seed: seed }),
    deleteReview: (review_id) => call('delete_review', { p_review_id: review_id }),
    deletePlace: (id) => call('delete_place', { p_id: id }),
    addPhoto: (place_id, b64) => call('add_photo', { p_place_id: place_id, p_data: b64 }),
    getPhotos: (place_id) => call('get_photos', { p_place_id: place_id }),
    deletePhoto: (id) => call('delete_photo', { p_id: id }),
    listInvites: () => call('list_invites', {}),
    createInvite: (name) => call('create_invite', { p_name: name }),
    rotateInvite: (member) => call('rotate_invite', { p_member: member }),
    revokeInvite: (member) => call('revoke_invite', { p_member: member }),
    deleteInvite: (member) => call('delete_invite', { p_member: member }),
  };
};

// ---- демо: ВЫДУМАННЫЕ примеры, настоящие оценки сюда не кладём (репозиторий публичный) ----
// В демо ключ «admin» включает режим админа, любой другой (или пустой) — обычный участник.
const DEMO_KEY = 'gas_demo_v2';
const demoSeed = () => {
  const rv = (id, place_id, author, author_name, verdict, a, t, s, c, tp, tl, i, comment = '') =>
    ({ id, place_id, author, author_name, verdict, access: a, taste: t, service: s, clean: c, toilet_present: tp, toilet: tl, impression: i, comment, created_at: '2026-01-01', updated_at: '2026-01-01' });
  return {
    next: 100,
    places: [
      { id: 1, name: 'Пример: Кофейня «Зерно»', kind: 'кафе', address: 'Невский пр., 1', lat: 59.9361, lon: 30.3141, created_at: '2026-01-01' },
      { id: 2, name: 'Пример: Бургерная «Лук»', kind: 'фастфуд', address: 'Лиговский пр., 10', lat: 59.9306, lon: 30.3607, created_at: '2026-01-02' },
      { id: 3, name: 'Пример: Рамен-бар', kind: 'ресторан', address: 'Садовая ул., 12', lat: 59.9267, lon: 30.3200, created_at: '2026-01-03' },
      { id: 4, name: 'Пример: Шаурма у метро', kind: 'шаурмечная', address: 'Московский пр., 100', lat: 59.8870, lon: 30.3190, created_at: '2026-01-04' },
    ],
    reviews: [
      rv(1, 1, 'demo-a', 'Аня', 3, 5, 5, 4, 5, true, 5, 5, 'Лучший флэт уайт'),
      rv(2, 1, 'demo-b', 'Борис', 3, 5, 4, 4, 5, true, 4, 5),
      rv(3, 1, 'demo-c', null, 0, 2, 2, 2, 3, false, null, 2, 'Долго ждали, кофе остыл'),
      rv(4, 2, 'demo-a', 'Аня', 2, 4, 4, 3, 3, false, null, 4),
      rv(5, 2, 'demo-c', null, 1, 4, 3, 3, 3, null, null, 3),
      rv(6, 3, 'demo-b', 'Борис', 3, 3, 5, 5, 5, true, 5, 5, 'Бульон огонь'),
      rv(7, 4, 'demo-c', null, 0, 5, 3, 2, 2, false, null, 2, 'Больше не пойдём'),
    ].map((r) => ({ ...r, avatar_seed: r.author_name ? { 'demo-a': 3300111, 'demo-b': 4400222 }[r.author] ?? 1 : null })),
  };
};
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
  return {
    getAll: async () => {
      const me = getAuthor(); const adm = role() === 'admin';
      return structuredClone({
        role: role(), places: mem.places,
        reviews: mem.reviews.map(({ author, ...r }) => ({ ...r, mine: author === me, ...(adm ? { author } : {}) })),
      });
    },
    savePlace: async (p) => {
      if (p.id == null) { const id = mem.next++; mem.places.push({ ...p, id, created_at: new Date().toISOString() }); commit(); return id; }
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
    addPhoto: async (place_id, data) => {
      const r = mem.reviews.find((x) => x.place_id === place_id && x.author === getAuthor());
      if (!r) throw new ApiError('rejected', 'no_such_review');
      if (photos.filter((p) => p.review_id === r.id).length >= 5) throw new ApiError('rejected', 'too_many_photos');
      photos.push({ id: nextPhoto++, review_id: r.id, place_id, data }); return nextPhoto - 1;
    },
    getPhotos: async (place_id) => photos.filter((p) => p.place_id === place_id).map((p) => {
      const r = mem.reviews.find((x) => x.id === p.review_id);
      return { id: p.id, review_id: p.review_id, mine: !!r && r.author === getAuthor(), data: p.data };
    }),
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
    deleteInvite: async (member) => { if (role() !== 'admin') forbid(); const i = invites.findIndex((m) => m.author === member); if (i >= 0) invites.splice(i, 1); },
    deletePlace: async (id) => {
      if (mem.reviews.some((x) => x.place_id === id)) throw new ApiError('rejected', 'place_has_reviews');
      mem.places = mem.places.filter((p) => p.id !== id); commit();
    },
  };
};

export const makeApi = (getCode, getAuthor) => (isDemo ? demo(getCode, getAuthor) : live(getCode, getAuthor));
