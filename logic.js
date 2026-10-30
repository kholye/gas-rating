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

// ---- Итоговый балл места (0–10). Все числа настраиваются здесь ----
export const RATING = {
  weights: { taste: 3, impression: 2, service: 2, clean: 2, access: 1, toilet: 1 }, // вес критерия в «качестве»
  qualityShare: 0.5,   // доля качества по критериям в баллах рецензии (остальное — звёзды)
  biasFactor: 0.5,     // какую часть «строгости автора» выравниваем
  biasMinReviews: 4,   // выравниваем только авторов, у которых не меньше стольких рецензий
  priorWeight: 0.5,    // вес «среднего по группе», подмешиваемого к каждому месту (одна рецензия не взлетает и не падает)
  poolMin: 6.5,        // с какого итогового балла место попадает в слот-машину
  qualityGap: 2.5,     // разброс качества (из 10), с которого мнения считаются расходящимися
  scaleGap: 3,         // разброс одной шкалы (из 5), с которого мнения считаются расходящимися
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Качество рецензии по критериям, 0–10 (оценки 1–5 растягиваются на 0–10; «нет туалета» не учитывается).
export function qualityOf(r) {
  let sum = 0; let w = 0;
  for (const [k, weight] of Object.entries(RATING.weights)) {
    const v = scoreOf(r, k);
    if (v != null) { sum += weight * v; w += weight; }
  }
  return w ? (sum / w - 1) * 2.5 : 0;
}
const verdict10 = (r) => (r.verdict * 10) / 3;
export const reviewScore = (r) => RATING.qualityShare * qualityOf(r) + (1 - RATING.qualityShare) * verdict10(r);
const authorKey = (r) => (r.author_name ? r.author_name.trim().toLowerCase() : null);

// Контекст расчёта по всем рецензиям: общий средний балл и поправка на строгость каждого автора (по имени).
export function ratingModel(allReviews) {
  const scores = allReviews.map(reviewScore);
  const global = mean(scores) ?? 0;
  const byAuthor = new Map();
  allReviews.forEach((r, i) => { const k = authorKey(r); if (k) { if (!byAuthor.has(k)) byAuthor.set(k, []); byAuthor.get(k).push(scores[i]); } });
  const shift = new Map();
  for (const [k, xs] of byAuthor) if (xs.length >= RATING.biasMinReviews) shift.set(k, RATING.biasFactor * (mean(xs) - global));
  return { global, adjusted: (r) => reviewScore(r) - (shift.get(authorKey(r)) ?? 0) };
}

// Итоговый балл места: среднее выровненных баллов рецензий с «щепоткой» общего среднего. Нет рецензий — null.
export function placeScore(reviews, model) {
  if (!reviews.length) return null;
  const xs = reviews.map(model.adjusted);
  return clamp((xs.reduce((a, b) => a + b, 0) + RATING.priorWeight * model.global) / (xs.length + RATING.priorWeight), 0, 10);
}

// Звёзды места: медиана вердиктов (одна резкая оценка не переворачивает итог), округление вверх от .5. Нет рецензий — null.
export function placeStars(reviews) {
  if (!reviews.length) return null;
  const v = reviews.map((r) => r.verdict).sort((a, b) => a - b); const n = v.length;
  return Math.round(n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2);
}

// Место попадает в слот-машину по итоговому баллу, а не по округлённым звёздам.
export const inPool = (summary) => summary.score != null && summary.score >= RATING.poolMin;

export function summarize(place, reviews, model = ratingModel(reviews)) {
  const scores = Object.fromEntries(SCALES.map(([k]) => [k, avgScore(reviews, k)]));
  return { place, reviews, stars: placeStars(reviews), count: reviews.length, scores, score: placeScore(reviews, model), quality: reviews.length ? mean(reviews.map(qualityOf)) : null };
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
    if (!inPool(s)) return false;
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
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  stars: (a, b) => (b.stars ?? -1) - (a.stars ?? -1),
  taste: (a, b) => (b.scores.taste ?? -1) - (a.scores.taste ?? -1),
  name: (a, b) => a.place.name.localeCompare(b.place.name, 'ru'),
  new: (a, b) => String(b.place.created_at).localeCompare(String(a.place.created_at)),
};
export const sortSummaries = (list, by) => [...list].sort(SORTS[by] ?? SORTS.score);

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

// Разногласие по КАЧЕСТВУ: итоговое качество рецензий расходится на 2,5+ из 10 или одна шкала на 3+.
// Если качество оценили одинаково, а вердикты разные (на 2+ звезды), это не спор, а разное решение «стоит ли ехать»: kind 'trip'.
export function disagreement(reviews) {
  if (reviews.length < 2) return null;
  const q = reviews.map(qualityOf);
  const scales = SCALES.filter(([k]) => {
    const xs = reviews.map((r) => scoreOf(r, k)).filter((v) => v != null);
    return xs.length >= 2 && Math.max(...xs) - Math.min(...xs) >= RATING.scaleGap;
  }).map(([, name]) => name);
  const v = reviews.map((r) => r.verdict);
  const tripGap = Math.max(...v) - Math.min(...v) >= 2;
  if (Math.max(...q) - Math.min(...q) >= RATING.qualityGap || scales.length) return { kind: 'quality', scales, tripGap };
  return tripGap ? { kind: 'trip', scales: [], tripGap } : null;
}

// Подкрутка слота: больше шансов у мест с баллом 8+, у мест, где давно не были (по дате последней рецензии), и у тех, что ближе.
export function slotWeights(pool, { center = null, now = Date.now() } = {}) {
  return pool.map((s) => {
    let w = s.score >= 8 ? 1.5 : 1;
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

// «2 дн.», «1 нед.», «3 мес.»: давность рецензии для постов.
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!t) return '';
  const d = Math.floor((now - t) / 864e5);
  if (d < 1) return 'сегодня';
  if (d < 7) return `${d} дн.`;
  if (d < 30) return `${Math.floor(d / 7)} нед.`;
  if (d < 365) return `${Math.floor(d / 30)} мес.`;
  return `${Math.floor(d / 365)} г.`;
}

// Имя автора для поста: анонимная рецензия хранится без имени.
export const displayName = (r) => r.author_name || 'Аноним';

// Код профиля — обычный uuid (его можно перенести на другой телефон).
export const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || '').trim());
