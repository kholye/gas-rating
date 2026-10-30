// Генератор аватарок: из числа-«зерна» получается существо (форма, цвет, глаза, рот, детали).
// Одно и то же зерно всегда даёт одно и то же существо. Чистые функции, без DOM: удобно проверять тестами.

const PALETTE = ['#C8F25A', '#8F82FF', '#FFB86B', '#7FD6FF', '#FF8FB8', '#5EEAD4', '#FF7A6B', '#FFD84D', '#C4B5FD', '#9BE564'];
const INK = '#0E0E10';

export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, a, b) => a + (b - a) * r();
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const f = (n) => Math.round(n * 100) / 100;

const mix = (hex, to, t) => {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = n(hex); const b = n(to);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
};

// Описание существа по зерну (без рисования): удобно для тестов и для будущих правок вида.
export function avatarSpec(seed) {
  const r = rng(seed);
  const color = pick(r, PALETTE);
  const eyeStyle = pick(r, ['round', 'tall', 'wide', 'sleepy', 'tall', 'round']);
  const eyeBox = { round: [4, 5.5, 4, 5.5], tall: [3.2, 4.4, 7, 10], wide: [5, 6.5, 3.4, 4.6], sleepy: [4.5, 6, 4.5, 6] }[eyeStyle];
  return {
    color,
    n: pick(r, [2, 2.4, 3, 3.6, 4.2]),            // 2 — эллипс, больше — «скруглённый квадрат»
    rx: between(r, 38, 44), ry: between(r, 34, 43),
    eyeStyle,
    erx: between(r, eyeBox[0], eyeBox[1]), ery: between(r, eyeBox[2], eyeBox[3]),
    spacing: between(r, 10, 17), eyeY: between(r, -7, 5), tilt: pick(r, [0, 0, 0, -12, 12, -7, 7]),
    mouth: pick(r, ['none', 'none', 'smile', 'smile', 'o', 'flat']),
    blush: r() < 0.3,
    extra: pick(r, ['none', 'none', 'ears', 'antenna', 'tuft', 'ears']),
    glint: r() < 0.85,
    delay: f(between(r, 0, 4)),                    // сдвиг моргания, чтобы несколько аватарок не моргали хором
  };
}

function bodyPath(cx, cy, rx, ry, n) {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2; const c = Math.cos(t); const s = Math.sin(t);
    pts.push(`${f(cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n))} ${f(cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n))}`);
  }
  return `M${pts.join('L')}Z`;
}

// Возвращает строку SVG. size — сторона в px; animate — моргание и «взгляд по сторонам» (только для одной аватарки на экране).
export function avatarSvg(seed, { size = 48, animate = false, label = 'Аватар' } = {}) {
  const a = avatarSpec(seed);
  const id = `av${seed >>> 0}`;
  const cx = 50; const cy = 54; const dark = mix(a.color, '#000000', 0.28);
  const ey = cy + a.eyeY; const ex = a.spacing;
  const parts = [];
  parts.push(`<defs><radialGradient id="${id}" cx="36%" cy="28%" r="80%"><stop offset="0" stop-color="${mix(a.color, '#ffffff', 0.4)}"/><stop offset=".55" stop-color="${a.color}"/><stop offset="1" stop-color="${mix(a.color, '#000000', 0.16)}"/></radialGradient></defs>`);
  if (a.extra === 'ears') parts.push(`<circle cx="${f(cx - a.rx * 0.7)}" cy="${f(cy - a.ry * 0.78)}" r="8" fill="${dark}"/><circle cx="${f(cx + a.rx * 0.7)}" cy="${f(cy - a.ry * 0.78)}" r="8" fill="${dark}"/>`);
  if (a.extra === 'antenna') parts.push(`<path d="M50 ${f(cy - a.ry + 2)}V${f(cy - a.ry - 9)}" stroke="${dark}" stroke-width="2.4" stroke-linecap="round"/><circle cx="50" cy="${f(cy - a.ry - 11)}" r="4" fill="${a.color}" stroke="${dark}" stroke-width="2"/>`);
  if (a.extra === 'tuft') parts.push(`<path d="M44 ${f(cy - a.ry + 3)}l-2-9M50 ${f(cy - a.ry + 2)}v-11M56 ${f(cy - a.ry + 3)}l2-9" stroke="${dark}" stroke-width="2.6" stroke-linecap="round"/>`);
  parts.push(`<path d="${bodyPath(cx, cy, a.rx, a.ry, a.n)}" fill="url(#${id})"/>`);
  if (a.blush) parts.push(`<ellipse cx="${f(cx - ex - 6)}" cy="${f(ey + a.ery + 4)}" rx="4" ry="2.6" fill="#FF5C8A" opacity=".35"/><ellipse cx="${f(cx + ex + 6)}" cy="${f(ey + a.ery + 4)}" rx="4" ry="2.6" fill="#FF5C8A" opacity=".35"/>`);
  const eye = (sx, tilt) => {
    const x = cx + sx * ex;
    const shape = a.eyeStyle === 'sleepy'
      ? `<path d="M${f(x - a.erx)} ${f(ey)}A${f(a.erx)} ${f(a.ery)} 0 0 0 ${f(x + a.erx)} ${f(ey)}Z" fill="${INK}"/>`
      : `<ellipse cx="${f(x)}" cy="${f(ey)}" rx="${f(a.erx)}" ry="${f(a.ery)}" fill="${INK}"/>`;
    const glint = a.glint && a.eyeStyle !== 'sleepy' ? `<circle cx="${f(x + a.erx * 0.35)}" cy="${f(ey - a.ery * 0.38)}" r="${f(Math.max(1, a.erx * 0.28))}" fill="#fff" opacity=".9"/>` : '';
    return `<g transform="rotate(${tilt * sx} ${f(x)} ${f(ey)})">${shape}${glint}</g>`;
  };
  parts.push(`<g class="eyes"><g class="blink">${eye(-1, a.tilt)}${eye(1, a.tilt)}</g></g>`);
  const my = ey + a.ery + 9;
  if (a.mouth === 'smile') parts.push(`<path d="M${f(cx - 5)} ${f(my)}Q50 ${f(my + 6)} ${f(cx + 5)} ${f(my)}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`);
  if (a.mouth === 'o') parts.push(`<ellipse cx="50" cy="${f(my + 1)}" rx="2.6" ry="3.2" fill="${INK}"/>`);
  if (a.mouth === 'flat') parts.push(`<path d="M${f(cx - 4)} ${f(my + 1)}H${f(cx + 4)}" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`);
  return `<svg class="avatar-svg${animate ? ' av-anim' : ''}" style="--d:${a.delay}s" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${label}">${parts.join('')}</svg>`;
}

// Новое случайное зерно аватарки (для профиля и кнопки «Перебросить кубик»).
export function randomSeed() {
  if (globalThis.crypto?.getRandomValues) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0]; }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

// Особый аватар админа: золотой король в короне. Один и тот же для всех админских рецензий.
export function kingSvg({ size = 48, animate = false, label = 'Аватар админа' } = {}) {
  const sp = (x, y, k, d) => `<g transform="translate(${x} ${y})"><path class="tw" style="animation-delay:${d}s" d="M0-${k}L${k * 0.3}-${k * 0.3} ${k} 0 ${k * 0.3} ${k * 0.3} 0 ${k}-${k * 0.3} ${k * 0.3}-${k} 0-${k * 0.3}-${k * 0.3}Z" fill="#FFF3B0"/></g>`;
  return `<svg class="avatar-svg${animate ? ' av-anim' : ''}" style="--d:1.4s" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${label}"><defs><radialGradient id="avKingH" cx="50%" cy="55%" r="50%"><stop offset=".6" stop-color="#FFD84D" stop-opacity=".35"/><stop offset="1" stop-color="#FFD84D" stop-opacity="0"/></radialGradient><radialGradient id="avKingB" cx="36%" cy="28%" r="80%"><stop offset="0" stop-color="#ffe894"/><stop offset=".55" stop-color="#FFD84D"/><stop offset="1" stop-color="#D6A82F"/></radialGradient></defs>`
    + `<circle cx="50" cy="54" r="48" fill="url(#avKingH)"/><rect x="12" y="32" width="76" height="60" rx="30" fill="url(#avKingB)"/>`
    + `<path d="M27 38L30 15L42 27L50 9L58 27L70 15L73 38Z" fill="#FFB020" stroke="#B87400" stroke-width="1.6" stroke-linejoin="round"/><rect x="27" y="33" width="46" height="8" rx="3" fill="#E58F00"/>`
    + `<circle cx="30" cy="14" r="2.8" fill="#8F82FF"/><circle cx="50" cy="8" r="3.2" fill="#C8F25A"/><circle cx="70" cy="14" r="2.8" fill="#8F82FF"/>`
    + `<ellipse cx="29" cy="71" rx="4" ry="2.6" fill="#FF5C8A" opacity=".35"/><ellipse cx="71" cy="71" rx="4" ry="2.6" fill="#FF5C8A" opacity=".35"/>`
    + `<g class="eyes"><g class="blink"><ellipse cx="37.5" cy="62" rx="4.6" ry="5.4" fill="#0E0E10"/><ellipse cx="62.5" cy="62" rx="4.6" ry="5.4" fill="#0E0E10"/><circle cx="39" cy="60" r="1.3" fill="#fff"/><circle cx="64" cy="60" r="1.3" fill="#fff"/></g></g>`
    + `<path d="M42 73Q50 80 58 73" fill="none" stroke="#0E0E10" stroke-width="2.2" stroke-linecap="round"/>${sp(12, 36, 6, 0)}${sp(89, 46, 5, 0.8)}${sp(86, 12, 4, 1.6)}</svg>`;
}

// Аватар по рецензии: админская (не анонимная) получает короля, остальные — существо по зерну.
export function reviewAvatar(r, opts = {}) {
  if (r.author_admin) return kingSvg(opts);
  return avatarSvg(r.avatar_seed ?? hash32(`r${r.id}`), opts);
}
