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
  weights: { taste: 3, impression: 2, service: 2, clean: 2 }, // вес критерия в «качестве»; доступность и туалет в итог не входят (показываются отдельно)
  qualityShare: 0.65,  // доля качества по критериям в баллах рецензии (остальное — звёзды); при такой доле вклад критериев и вердикта в разброс балла примерно равен (звёзды разбросаны шире)
  biasFactor: 0.5,     // какую часть «строгости автора» выравниваем
  biasMinReviews: 4,   // выравниваем только авторов, у которых не меньше стольких рецензий
  priorWeight: 2,      // вес «среднего по группе» в рецензиях: подмешивается к каждому месту, чтобы одна рецензия не взлетала и не падала (байесовское среднее)
  minReviews: 2,       // меньше рецензий — «мало данных»: такое место не попадает в слот и не получает баннер
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

// Звёзды места: медиана вердиктов (одна резкая оценка не переворачивает итог); при чётном числе рецензий ничья округляется вниз.
// «Ехать специально» (3) не выдаётся, если хоть кто-то поставил 0. Нет рецензий — null.
export function placeStars(reviews) {
  if (!reviews.length) return null;
  const v = reviews.map((r) => r.verdict).sort((a, b) => a - b); const n = v.length;
  const med = n % 2 ? v[(n - 1) / 2] : Math.floor((v[n / 2 - 1] + v[n / 2]) / 2);
  return med === 3 && v[0] === 0 ? 2 : med;
}

// Мало данных: рецензий меньше RATING.minReviews (оценка предварительная).
export const isThin = (summary) => summary.count < RATING.minReviews;

// Место попадает в слот-машину по итоговому баллу; не берём места с одной рецензией и те, где звёзды места 0 («не моё»), как бы высоко ни стояли критерии.
export const inPool = (summary) => summary.score != null && !isThin(summary) && summary.stars >= 1 && summary.score >= RATING.poolMin;

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
// Сортировки по оценкам (лучшие, звёзды, вкус) ставят места с малым числом рецензий после остальных: они не попадают в топ.
export const RATED_SORTS = new Set(['score', 'stars', 'taste']);
export function sortSummaries(list, by) {
  const key = SORTS[by] ? by : 'score';
  const cmp = SORTS[key];
  if (!RATED_SORTS.has(key)) return [...list].sort(cmp);
  return [...list].sort((a, b) => (isThin(a) - isThin(b)) || cmp(a, b));
}

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
// Ссылка «Открыть в картах»: обычная https-ссылка на Яндекс Карты. Работает на компьютере и в любом браузере телефона;
// если стоит приложение Яндекс Карт, телефон откроет его. (Раньше на Android была ссылка geo:, она открывалась не у всех.)
export function mapsLink(lat, lon) {
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`;
}

// «Поделиться» местом: текст для чата. Ссылка на сайт без личного ключа (#p=номер места), получатель входит своим ключом;
// адрес и ссылка на Яндекс Карты полезны и тем, у кого доступа к сайту нет.
const VERDICT_WORDS = ['не моё', 'хорошо, если окажусь рядом', 'стоит заехать', 'ехать специально'];
export const placeLink = (siteUrl, id) => `${siteUrl}#p=${id}`;
export function shareText(summary, siteUrl) {
  const p = summary.place;
  const fmt = (x) => x.toFixed(1).replace('.', ',');
  const verdict = summary.count < RATING.minReviews ? (summary.count ? 'пока одна оценка' : 'пока без оценок')
    : `${'★'.repeat(summary.stars)}${'☆'.repeat(3 - summary.stars)} ${VERDICT_WORDS[summary.stars]}, итог ${fmt(summary.score)}/10`;
  return [`${p.name} — ${verdict}`, p.address, `Карта: https://yandex.ru/maps/?pt=${p.lon},${p.lat}&z=17&l=map`, `G.A.S. Rating: ${placeLink(siteUrl, p.id)}`].join('\n');
}
// Ссылка на место из адреса: #p=номер (может стоять рядом с #k=...).
export const readPlace = (hash) => { const m = /(?:^#|&)p=(\d+)/.exec(hash || ''); return m ? Number(m[1]) : null; };

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

// ---- Ссылка на место из приложения карт → точка, название, адрес ----
// Разбирает то, что уже есть в самой ссылке (сайты карт мы не скачиваем). Короткие ссылки (yandex.ru/maps/-/…, go.2gis.com,
// maps.app.goo.gl, maps.apple/p/…) помечаются short: их раскрывает база (resolve_link), потом ссылка разбирается ещё раз.
const okLL = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const pair = (s) => { const m = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
const dec = (s) => { try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch { return String(s); } };
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const isCoords = (s) => /^\s*-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\s*$/.test(s || '');
export const MAP_APPS = 'Яндекс Карты, 2ГИС, Google Maps, Apple Maps, OpenStreetMap, Organic Maps';

export function parseMapLink(text) {
  const t = String(text || '').trim(); if (!t) return null;
  const found = /(https?:\/\/[^\s<>"']+|geo:[^\s<>"']+)/i.exec(t);
  if (!found) { const p = pair(t); return p && okLL(p[0], p[1]) ? { source: 'координаты', lat: r6(p[0]), lon: r6(p[1]), name: '', address: '', short: false, url: t } : null; }
  const before = t.slice(0, found.index).split(/\n/).map((x) => x.trim()).filter(Boolean).pop() || '';
  const lead = before && !/^https?:/i.test(before) && before.length <= 80 ? before.split(',')[0].replace(/[\s:—–-]+$/, '').trim() : '';
  const out = (source, lat, lon, name = '', extra = {}) => ({ source, lat: okLL(lat, lon) ? r6(lat) : null, lon: okLL(lat, lon) ? r6(lon) : null, name: String(name || lead || '').trim(), address: '', short: false, url: found ? found[1] : t, ...extra });
  let raw = found[1].replace(/[,.;!?]+$/, '');
  while (raw.endsWith(')') && (raw.match(/\)/g) || []).length > (raw.match(/\(/g) || []).length) raw = raw.slice(0, -1); // скобка из текста вокруг ссылки
  if (/^geo:/i.test(raw)) { // geo:59.9,30.3?q=59.9,30.3(Название)
    const p = pair(raw.slice(4)); const q = /[?&]q=([^&]+)/.exec(raw); const qv = q ? dec(q[1]) : '';
    const nm = /\(([^)]+)\)\s*$/.exec(qv); const qp = pair(qv);
    const ll = p && okLL(p[0], p[1]) ? p : qp;
    return out('ссылка geo', ll?.[0], ll?.[1], nm ? nm[1] : (qv && !qp ? qv : ''));
  }
  let u; try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const full = dec(u.href);
  const q = (k) => u.searchParams.get(k);
  const lonlat = (s) => { const p = pair(s); return p ? [p[1], p[0]] : null; }; // у Яндекса и 2ГИС порядок «долгота,широта»

  if (/(^|\.)yandex\.[a-z.]+$/.test(host) || host === 'ya.ru') {
    if (/\/maps\/-\//.test(u.pathname)) return out('Яндекс Карты', null, null, '', { short: true, url: raw });
    const pt = q('pt') ? q('pt').split('~')[0] : null;
    const ll = lonlat(q('poi[point]')) || lonlat(q('whatshere[point]')) || lonlat(pt) || lonlat(q('ll'));
    const text = q('text') && !isCoords(q('text')) ? q('text') : '';
    return out('Яндекс Карты', ll?.[0], ll?.[1], text);
  }
  if (host === 'maps.app.goo.gl' || host === 'goo.gl') return out('Google Maps', null, null, '', { short: true, url: raw });
  if (/(^|\.)google\.[a-z.]+$/.test(host) && (/^\/maps/.test(u.pathname) || host.startsWith('maps.'))) {
    const d = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(full); const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(full);
    const pq = pair(q('q')) || pair(q('query')) || pair(q('ll')) || pair(q('center')) || pair(q('destination'));
    const ll = d ? [Number(d[1]), Number(d[2])] : at ? [Number(at[1]), Number(at[2])] : pq;
    const place = /\/maps\/(?:place|search)\/([^/@]+)/.exec(u.pathname);
    const qText = [q('q'), q('query')].find((x) => x && !isCoords(x)) || '';
    return out('Google Maps', ll?.[0], ll?.[1], place ? dec(place[1]) : qText);
  }
  if (host === 'go.2gis.com') return out('2ГИС', null, null, '', { short: true, url: raw });
  if (/(^|\.)2gis\.[a-z.]+$/.test(host)) {
    const g = /\/geo\/\d+\/(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u.pathname);
    const ll = lonlat(q('m')) || (g ? [Number(g[2]), Number(g[1])] : null);
    return out('2ГИС', ll?.[0], ll?.[1]);
  }
  if (host === 'maps.apple' || /^maps\.apple\/p\//.test(host + u.pathname)) return out('Apple Maps', null, null, '', { short: true, url: raw });
  if (host === 'maps.apple.com') {
    const ll = pair(q('ll')) || pair(q('coordinate')) || pair(q('sll')) || pair(q('q'));
    const name = q('name') || (q('q') && !isCoords(q('q')) ? q('q') : '');
    return out('Apple Maps', ll?.[0], ll?.[1], name, { address: q('address') || '' });
  }
  if (host === 'openstreetmap.org' || host === 'osm.org') {
    const h = /map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/.exec(u.hash);
    const ll = q('mlat') && q('mlon') ? [Number(q('mlat')), Number(q('mlon'))] : h ? [Number(h[1]), Number(h[2])] : null;
    return out('OpenStreetMap', ll?.[0], ll?.[1]);
  }
  if (host === 'omaps.app' || host === 'ge0.me') { // координаты зашифрованы, берём только название из конца ссылки
    const seg = u.pathname.split('/').filter(Boolean)[1];
    return out('Organic Maps', null, null, seg ? dec(seg).replace(/_/g, ' ') : '');
  }
  return null;
}
