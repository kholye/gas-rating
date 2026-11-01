// Обложка места без фото: «постер из фигур» (вариант 2 с холста). Рисуется из номера и названия места,
// поэтому у каждого места своя и всегда одна и та же. Цвета — от кухни плюс лайм и фиолетовый «Графита».
import { hash32 } from './avatar.js';

// основной и второй цвет кухни
const KIND_COLORS = {
  'Кофейня': ['#C89B6B', '#F2E3CF'], 'Пекарня': ['#E8C27A', '#FFF1D0'], 'Бургеры и фастфуд': ['#FFB86B', '#FF5E5E'],
  'Шаурма': ['#FFD166', '#FF8A6B'], 'Шашлык и мясо': ['#FF8A4C', '#FF5E5E'], 'Рамен и японская': ['#FF8A6B', '#FFD3C4'],
  'Китайская': ['#FF5E5E', '#FFB86B'], 'Корейская': ['#FF7AB6', '#8F82FF'], 'Тайская': ['#7AE0C8', '#FFD166'],
  'Азиатская разная': ['#6BD3FF', '#FF7AB6'], 'Грузинская': ['#E06BA0', '#FFB86B'], 'Пицца и итальянская': ['#FF6B5E', '#7AE0A0'],
  'Европейская': ['#6BB7FF', '#F2F2F0'], 'Русская': ['#FF6B6B', '#F2E3CF'], 'Бар': ['#B98CFF', '#FFD166'],
};
const DEFAULT = ['#C8F25A', '#8F82FF'];

// генератор случайных чисел по зерну (mulberry32): одно зерно — одна и та же последовательность
const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) >>> 0; let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r1 = (x) => Math.round(x * 10) / 10;

export const kindColor = (kind) => (KIND_COLORS[kind] || DEFAULT)[0];

// SVG-строка: 4–6 фигур (круг, полукруг, четверть круга, полоса) на тёмном фоне. w×h — размер в px (рисунок тянется по рамке).
export function posterSvg(place, { w = 320, h = 260, label = '' } = {}) {
  const [a, b] = KIND_COLORS[place.kind] || DEFAULT;
  const r = rng(hash32(`${place.id}|${place.name}`));
  const pal = [a, b, '#C8F25A', '#8F82FF', '#F2F2F0'];
  const bg = r() > 0.5 ? '#121216' : '#1C1A22';
  const n = 4 + Math.floor(r() * 3); const shapes = [];
  for (let i = 0; i < n; i++) {
    const t = Math.floor(r() * 4); const s = (0.3 + r() * 0.45) * h; const c = pal[Math.floor(r() * pal.length)];
    const x = r1(r() * w); const y = r1(r() * h); const rot = Math.round((r() - 0.5) * 60);
    const tr = `transform="rotate(${rot} ${x} ${y})"`;
    if (t === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${r1(s / 2)}" fill="${c}"/>`);
    else if (t === 1) shapes.push(`<path d="M${r1(x - s / 2)} ${y}a${r1(s / 2)} ${r1(s / 2)} 0 0 1 ${r1(s)} 0z" fill="${c}" ${tr}/>`);
    else if (t === 2) shapes.push(`<path d="M${x} ${y}h${r1(s)}a${r1(s)} ${r1(s)} 0 0 1 ${r1(-s)} ${r1(s)}z" fill="${c}" ${tr}/>`);
    else shapes.push(`<rect x="${r1(x - s * 0.8)}" y="${r1(y - s * 0.09)}" width="${r1(s * 1.6)}" height="${r1(s * 0.18)}" rx="6" fill="${c}" ${tr}/>`);
  }
  return `<svg class="poster" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label ? label.replace(/[<>&"]/g, '') : 'Обложка места'}"><rect width="${w}" height="${h}" fill="${bg}"/>${shapes.join('')}</svg>`;
}
