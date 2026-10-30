// Чистые функции подсчёта: без DOM и сети, чтобы их можно было проверить тестами.
// Правила — в docs/designs/gas-rating-design.md (раздел «Правила подсчёта», R3, R4).

export const SCALES = [
  ['access', 'Доступность'],
  ['taste', 'Вкус еды'],
  ['service', 'Обслуживание'],
  ['clean', 'Чистота'],
  ['toilet', 'Туалет'],
  ['impression', 'Общее впечатление'],
];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// Оценка туалета учитывается только когда он есть и оценён («нет» и «не помню» не входят).
const scoreOf = (r, key) => {
  if (key === 'toilet') return r.toilet_present === true && r.toilet != null ? r.toilet : null;
  return r[key] ?? null;
};

export function avgScore(reviews, key) {
  return mean(reviews.map((r) => scoreOf(r, key)).filter((v) => v != null));
}

// Звёзды места: среднее вердиктов тех, кто оценил, округление вверх от .5. Нет рецензий — null.
export function placeStars(reviews) {
  if (!reviews.length) return null;
  return Math.round(mean(reviews.map((r) => r.verdict)));
}

export const inPool = (reviews) => (placeStars(reviews) ?? 0) >= 2;

export function summarize(place, reviews, memberCount = 3) {
  const scores = Object.fromEntries(SCALES.map(([k]) => [k, avgScore(reviews, k)]));
  return { place, reviews, stars: placeStars(reviews), count: reviews.length, memberCount, scores };
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Пул слот-машины: места на 2–3 звезды; при включённом «Только рядом» — ещё и в радиусе.
export function slotPool(summaries, { nearby = false, center = null, radiusKm = 5 } = {}) {
  return summaries.filter((s) => {
    if (!inPool(s.reviews)) return false;
    if (!nearby || !center) return true;
    return distanceKm(center.lat, center.lon, s.place.lat, s.place.lon) <= radiusKm;
  });
}

export function searchSummaries(list, query) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((s) => `${s.place.name} ${s.place.address} ${s.place.kind ?? ''}`.toLowerCase().includes(q));
}

const SORTS = {
  stars: (a, b) => (b.stars ?? -1) - (a.stars ?? -1),
  taste: (a, b) => (b.scores.taste ?? -1) - (a.scores.taste ?? -1),
  name: (a, b) => a.place.name.localeCompare(b.place.name, 'ru'),
  new: (a, b) => String(b.place.created_at).localeCompare(String(a.place.created_at)),
};
export const sortSummaries = (list, by) => [...list].sort(SORTS[by] ?? SORTS.stars);

// Похожие заведения: то же название (без регистра) или точка в пределах 100 м.
export function findDuplicates(places, { name, lat, lon }) {
  const n = name.trim().toLowerCase();
  return places.filter(
    (p) =>
      (n && p.name.trim().toLowerCase() === n) ||
      (lat != null && lon != null && distanceKm(lat, lon, p.lat, p.lon) <= 0.1),
  );
}

// На iPhone схема geo: не работает, поэтому там ссылка на Яндекс Карты.
export function mapsLink(lat, lon, name = '', ios = false) {
  if (ios) return `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`;
  return `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`;
}

// Секретный код: из #k=... в адресе, иначе из сохранённого. Возвращает { code, fromUrl }.
export function readCode(hash, stored) {
  const m = /(?:^#|&)k=([^&]+)/.exec(hash || '');
  if (m) return { code: decodeURIComponent(m[1]), fromUrl: true };
  return { code: stored || null, fromUrl: false };
}

// Из вставленной ссылки или голого кода достаёт код.
export function parsePastedLink(text) {
  const t = (text || '').trim();
  const m = /[#&]k=([^&\s]+)/.exec(t);
  return m ? decodeURIComponent(m[1]) : t || null;
}

// Разногласие: вердикты расходятся на 2 звезды и больше, либо одна шкала — на 3 и больше. Меньше двух рецензий — null.
export function disagreement(reviews) {
  if (reviews.length < 2) return null;
  const vs = reviews.map((r) => r.verdict);
  const verdict = Math.max(...vs) - Math.min(...vs) >= 2;
  const scales = SCALES.filter(([k]) => {
    const xs = reviews.map((r) => scoreOf(r, k)).filter((v) => v != null);
    return xs.length >= 2 && Math.max(...xs) - Math.min(...xs) >= 3;
  }).map(([, name]) => name);
  return verdict || scales.length ? { verdict, scales } : null;
}

// Подкрутка слота: больше шансов у 3-звёздочных, у мест, где давно не были (по дате последней рецензии), и у тех, что ближе.
export function slotWeights(pool, { center = null, now = Date.now() } = {}) {
  return pool.map((s) => {
    let w = s.stars === 3 ? 1.5 : 1;
    const last = Math.max(0, ...s.reviews.map((r) => Date.parse(r.updated_at || r.created_at) || 0));
    const days = (now - last) / 864e5;
    w *= days >= 60 ? 1.6 : days >= 30 ? 1.3 : 1;
    if (center) {
      const km = distanceKm(center.lat, center.lon, s.place.lat, s.place.lon);
      w *= km <= 2 ? 1.5 : km <= 5 ? 1.2 : 1;
    }
    return w;
  });
}

export function pickWeighted(items, weights, rnd = Math.random) {
  let x = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { x -= weights[i]; if (x < 0) return items[i]; }
  return items[items.length - 1];
}
