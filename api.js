// Связь с базой. Две реализации с одним набором методов: live (Supabase) и demo (выдуманные примеры в localStorage).
import { CONFIG } from './config.js';

export const isDemo = !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY;

// kind: 'bad_code' | 'offline' | 'db' | 'rejected'
export class ApiError extends Error {
  constructor(kind, detail = '') { super(kind); this.kind = kind; this.detail = detail; }
}

const live = (getCode) => {
  const call = async (fn, args) => {
    const headers = { apikey: CONFIG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
    if (!CONFIG.SUPABASE_ANON_KEY.startsWith('sb_')) headers.Authorization = `Bearer ${CONFIG.SUPABASE_ANON_KEY}`;
    let r;
    try {
      r = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify({ p_code: getCode(), ...args }) });
    } catch { throw new ApiError('offline'); }
    if (r.ok) return r.status === 204 ? null : r.json();
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch { /* тело не JSON */ }
    if (msg.includes('bad_code')) throw new ApiError('bad_code');
    if (r.status >= 500 || r.status === 404) throw new ApiError('db', String(r.status));
    throw new ApiError('rejected', msg);
  };
  return {
    getAll: () => call('get_all', {}),
    savePlace: (p) => call('save_place', { p_id: p.id ?? null, p_name: p.name, p_kind: p.kind || null, p_address: p.address, p_lat: p.lat, p_lon: p.lon }),
    saveReview: (r) => call('save_review', {
      p_place_id: r.place_id, p_reviewer: r.reviewer, p_verdict: r.verdict, p_access: r.access, p_taste: r.taste,
      p_service: r.service, p_clean: r.clean, p_impression: r.impression,
      p_toilet_present: r.toilet_present, p_toilet: r.toilet_present ? r.toilet : null, p_comment: r.comment || null,
    }),
    deleteReview: (place_id, reviewer) => call('delete_review', { p_place_id: place_id, p_reviewer: reviewer }),
    deletePlace: (id) => call('delete_place', { p_id: id }),
    addPhoto: (place_id, reviewer, b64) => call('add_photo', { p_place_id: place_id, p_reviewer: reviewer, p_data: b64 }),
    getPhotos: (place_id) => call('get_photos', { p_place_id: place_id }),
    deletePhoto: (id) => call('delete_photo', { p_id: id }),
  };
};

// ---- демо: ВЫДУМАННЫЕ примеры, настоящие оценки сюда не кладём (репозиторий публичный) ----
const DEMO_KEY = 'gas_demo_v1';
const demoSeed = () => {
  const rv = (place_id, reviewer, verdict, a, t, s, c, tp, tl, i, comment = '') =>
    ({ place_id, reviewer, verdict, access: a, taste: t, service: s, clean: c, toilet_present: tp, toilet: tl, impression: i, comment, created_at: '2026-01-01', updated_at: '2026-01-01' });
  return {
    next: 100,
    members: ['Аня', 'Борис', 'Вика'],
    places: [
      { id: 1, name: 'Пример: Кофейня «Зерно»', kind: 'кафе', address: 'Невский пр., 1', lat: 59.9361, lon: 30.3141, created_at: '2026-01-01' },
      { id: 2, name: 'Пример: Бургерная «Лук»', kind: 'фастфуд', address: 'Лиговский пр., 10', lat: 59.9306, lon: 30.3607, created_at: '2026-01-02' },
      { id: 3, name: 'Пример: Рамен-бар', kind: 'ресторан', address: 'Садовая ул., 12', lat: 59.9267, lon: 30.3200, created_at: '2026-01-03' },
      { id: 4, name: 'Пример: Шаурма у метро', kind: 'шаурмечная', address: 'Московский пр., 100', lat: 59.8870, lon: 30.3190, created_at: '2026-01-04' },
    ],
    reviews: [
      rv(1, 'Аня', 3, 5, 5, 4, 5, true, 5, 5, 'Лучший флэт уайт'),
      rv(1, 'Борис', 3, 5, 4, 4, 5, true, 4, 5),
      rv(2, 'Аня', 2, 4, 4, 3, 3, false, null, 4),
      rv(2, 'Вика', 1, 4, 3, 3, 3, null, null, 3),
      rv(3, 'Борис', 3, 3, 5, 5, 5, true, 5, 5, 'Бульон огонь'),
      rv(4, 'Вика', 0, 5, 3, 2, 2, false, null, 2, 'Больше не пойдём'),
    ],
  };
};
const demo = () => {
  const load = () => { try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || demoSeed(); } catch { return demoSeed(); } };
  const save = (d) => { try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch { /* нет хранилища: изменения живут до перезагрузки */ } };
  let mem = load();
  const commit = () => save(mem);
  const photos = []; // в демо фото живут только до перезагрузки страницы (чтобы не переполнить хранилище)
  let nextPhoto = 1;
  return {
    getAll: async () => structuredClone(mem),
    savePlace: async (p) => {
      if (p.id == null) { const id = mem.next++; mem.places.push({ ...p, id, created_at: new Date().toISOString() }); commit(); return id; }
      Object.assign(mem.places.find((x) => x.id === p.id), p); commit(); return p.id;
    },
    saveReview: async (r) => {
      const now = new Date().toISOString();
      const i = mem.reviews.findIndex((x) => x.place_id === r.place_id && x.reviewer === r.reviewer);
      const row = { ...r, toilet: r.toilet_present ? r.toilet : null, updated_at: now };
      if (i >= 0) mem.reviews[i] = { ...mem.reviews[i], ...row }; else mem.reviews.push({ ...row, created_at: now });
      commit();
    },
    deleteReview: async (place_id, reviewer) => {
      mem.reviews = mem.reviews.filter((x) => !(x.place_id === place_id && x.reviewer === reviewer));
      for (let i = photos.length - 1; i >= 0; i--) if (photos[i].place_id === place_id && photos[i].reviewer === reviewer) photos.splice(i, 1);
      commit();
    },
    addPhoto: async (place_id, reviewer, data) => {
      if (photos.filter((p) => p.place_id === place_id && p.reviewer === reviewer).length >= 5) throw new ApiError('rejected', 'too_many_photos');
      photos.push({ id: nextPhoto++, place_id, reviewer, data }); return nextPhoto - 1;
    },
    getPhotos: async (place_id) => photos.filter((p) => p.place_id === place_id).map(({ id, reviewer, data }) => ({ id, reviewer, data })),
    deletePhoto: async (id) => { const i = photos.findIndex((p) => p.id === id); if (i >= 0) photos.splice(i, 1); },
    deletePlace: async (id) => {
      if (mem.reviews.some((x) => x.place_id === id)) throw new ApiError('rejected', 'place_has_reviews');
      mem.places = mem.places.filter((p) => p.id !== id); commit();
    },
  };
};

export const makeApi = (getCode) => (isDemo ? demo() : live(getCode));
