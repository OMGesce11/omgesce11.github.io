import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

/* ------------------------------------------------------------------
   Tamamen prosedürel PBR doku seti. Hiçbir dış dosya gerekmez.
   Renk haritaları + yükseklikten türetilmiş normal haritalar.
------------------------------------------------------------------ */

function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Döngüsel (seamless) value noise: doku kenarlarında ek yeri belli olmaz
function vnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = smoothstep(x - xi), yf = smoothstep(y - yi);
  const w = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const v00 = w(xi, yi), v10 = w(xi + 1, yi), v01 = w(xi, yi + 1), v11 = w(xi + 1, yi + 1);
  return lerp(lerp(v00, v10, xf), lerp(v01, v11, xf), yf);
}

function fbm(x, y, seed, octaves = 4, base = 4) {
  let sum = 0, amp = 0.5, norm = 0, p = base;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * p, y * p, p, seed + i * 17) * amp;
    norm += amp; amp *= 0.5; p *= 2;
  }
  return sum / norm;
}

function canvasTexture(size, painter, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const heights = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const c4 = painter(u, v, x, y);
      const i = (y * size + x) * 4;
      d[i] = clamp(c4[0], 0, 255);
      d[i + 1] = clamp(c4[1], 0, 255);
      d[i + 2] = clamp(c4[2], 0, 255);
      d[i + 3] = 255;
      heights[y * size + x] = c4[3] ?? 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = aniso;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { tex, heights };
}

function normalFromHeight(heights, size, strength = 2.2, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => heights[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function build(size, painter, strength = 2.2, repeat = [1, 1]) {
  const { tex, heights } = canvasTexture(size, painter, { repeat });
  const normalMap = normalFromHeight(heights, size, strength, repeat);
  return { map: tex, normalMap };
}

export function cloneTiled(pair, rx, ry) {
  const map = pair.map.clone(); map.repeat.set(rx, ry); map.needsUpdate = true;
  const normalMap = pair.normalMap.clone(); normalMap.repeat.set(rx, ry); normalMap.needsUpdate = true;
  return { map, normalMap };
}

const mix = (a, b, t) => lerp(a, b, t);

export function createTextures() {
  const T = {};

  // ---- Çöl zemini: kum, çakıl ve koyu lekeler ----
  T.ground = build(512, (u, v) => {
    const n = fbm(u, v, 3, 6, 4);
    const fine = fbm(u, v, 91, 3, 64);
    const patch = fbm(u, v, 17, 3, 8);
    let h = n * 0.7 + fine * 0.3;
    const shade = 0.90 + n * 0.30 + (fine - 0.5) * 0.12 - Math.max(0, patch - 0.63) * 0.38;
    let r = 222 * shade, g = 191 * shade, b = 141 * shade;
    const pebble = hash(Math.floor(u * 512), Math.floor(v * 512), 7);
    if (pebble > 0.9985) { r *= 0.62; g *= 0.64; b *= 0.66; h -= 0.3; }
    else if (pebble < 0.0015) { r *= 1.16; g *= 1.14; b *= 1.12; h += 0.3; }
    return [r, g, b, h];
  }, 1.25, [26, 26]);

  // ---- Beton ----
  T.concrete = build(512, (u, v) => {
    const n = fbm(u, v, 5, 5, 6), grain = fbm(u, v, 33, 2, 96);
    let s = 0.87 + n * 0.22 + (grain - 0.5) * 0.13;
    const stain = Math.max(0, fbm(u, v, 61, 3, 5) - 0.64) * 0.75;
    s -= stain;
    return [178 * s, 174 * s, 163 * s, n * 0.65 + grain * 0.35];
  }, 2.0);

  // ---- Bina cephesi (pencereler + sıva) ----
  T.facade = build(512, (u, v) => {
    const n = fbm(u, v, 9, 4, 8);
    let s = 0.84 + n * 0.28;
    const cellX = Math.floor(u * 4), cellY = Math.floor(v * 4);
    const fx = u * 4 - cellX, fy = v * 4 - cellY;
    let h = n;
    if (fx > 0.20 && fx < 0.80 && fy > 0.18 && fy < 0.74) {
      const lit = hash(cellX, cellY, 13);
      s = lit > 0.88 ? 0.78 : 0.34 + lit * 0.20;
      const frame = (fx < 0.225 || fx > 0.775 || fy < 0.20 || fy > 0.72);
      if (frame) s = 0.70;
      h = 0.15;
      return [118 * s + (lit > 0.88 ? 45 : 0), 134 * s + (lit > 0.88 ? 30 : 0), 146 * s + (lit > 0.88 ? 12 : 0), h];
    }
    const dirt = Math.max(0, fbm(u, v + 0.3, 27, 3, 4) - 0.55) * 1.3;
    s -= dirt;
    return [172 * s, 160 * s, 140 * s, h];
  }, 1.6);

  // ---- Tuğla ----
  T.brick = build(512, (u, v) => {
    const rows = 9, cols = 5;
    const ry = Math.floor(v * rows);
    const offset = (ry % 2) * 0.5;
    const bx = (u * cols + offset) % 1, by = (v * rows) % 1;
    const mortar = bx < 0.045 || by < 0.07;
    const n = fbm(u, v, 12, 4, 12);
    const tint = hash(Math.floor(u * cols + offset), ry, 44) * 0.35 + 0.72;
    if (mortar) return [148 + n * 30, 142 + n * 28, 130 + n * 26, 0.15];
    const s = tint + n * 0.3;
    return [155 * s, 78 * s, 60 * s, 0.7 + n * 0.3];
  }, 2.4);

  // ---- Paslı / boyalı metal (konteynerler) ----
  T.metal = build(512, (u, v) => {
    const rib = Math.abs(Math.sin(u * Math.PI * 12));
    const n = fbm(u, v, 21, 4, 8);
    const rust = Math.max(0, fbm(u, v, 71, 4, 6) - 0.58) * 2.6;
    const s = 0.82 + n * 0.30 + rib * 0.10 - rust * 0.22;
    const rk = clamp(rust, 0, 1);
    const r = mix(116, 158, rk), g = mix(132, 92, rk), b = mix(128, 56, rk);
    return [r * s, g * s, b * s, rib * 0.7 + n * 0.3];
  }, 2.2);

  // ---- Koyu metal (silahlar, araçlar) ----
  T.gunmetal = build(256, (u, v) => {
    const brush = fbm(u * 0.2, v * 3, 55, 3, 96);
    const n = fbm(u, v, 3, 3, 8);
    const s = 0.55 + n * 0.3 + brush * 0.18;
    return [72 * s, 76 * s, 80 * s, brush * 0.5 + n * 0.5];
  }, 1.1);

  // ---- Ahşap sandık ----
  T.crate = build(512, (u, v) => {
    const planks = 5, pi = Math.floor(v * planks), pv = (v * planks) % 1;
    const grain = fbm(u * 2, v * 10, 15, 4, 12);
    const gap = pv < 0.045 || pv > 0.955;
    const tint = 0.75 + hash(pi, 3, 8) * 0.35;
    let s = tint * (0.85 + grain * 0.35);
    if (gap) s *= 0.35;
    const knot = Math.max(0, 0.16 - Math.hypot((u - 0.5) * 1.5, (pv - 0.5) * 0.7)) * 2;
    s -= knot;
    return [150 * s, 112 * s, 68 * s, grain - (gap ? 0.6 : 0)];
  }, 2.0);

  // ---- Kum torbası ----
  T.sandbag = build(256, (u, v) => {
    const rows = 4, ry = Math.floor(v * rows), vy = (v * rows) % 1;
    const off = (ry % 2) * 0.5, ux = (u * 3 + off) % 1;
    const edge = Math.max(Math.abs(ux - 0.5) * 2, Math.abs(vy - 0.5) * 2);
    const n = fbm(u, v, 41, 4, 16);
    const s = (0.72 + n * 0.4) * (1.1 - edge * 0.28);
    return [126 * s, 122 * s, 88 * s, (1 - edge) * 0.8 + n * 0.2];
  }, 2.2);

  // ---- Asfalt / yol ----
  T.asphalt = build(256, (u, v) => {
    const n = fbm(u, v, 8, 5, 8), fine = fbm(u, v, 77, 2, 128);
    const s = 0.76 + n * 0.24 + (fine - 0.5) * 0.18;
    return [140 * s, 132 * s, 120 * s, n * 0.5 + fine * 0.5];
  }, 1.4);

  // ---- Kumaş / üniforma ----
  T.fabric = build(128, (u, v) => {
    const weave = (Math.sin(u * 512) * Math.sin(v * 512)) * 0.06;
    const n = fbm(u, v, 3, 3, 12);
    const s = 0.7 + n * 0.35 + weave;
    return [92 * s, 96 * s, 78 * s, n];
  }, 1.2);

  // ---- Duman / parçacık dokusu (yumuşak daire) ----
  {
    const size = 128, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    T.soft = new THREE.CanvasTexture(c);
    T.soft.colorSpace = THREE.SRGBColorSpace;
  }
  // ---- Mermi deliği dekalı ----
  {
    const size = 64, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(12,10,8,0.95)');
    g.addColorStop(0.28, 'rgba(30,25,20,0.65)');
    g.addColorStop(0.6, 'rgba(70,60,50,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    T.decal = new THREE.CanvasTexture(c);
    T.decal.colorSpace = THREE.SRGBColorSpace;
  }
  // ---- Namlu alevi ----
  {
    const size = 128, c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.translate(64, 64);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 58);
    g.addColorStop(0, 'rgba(255,255,245,1)');
    g.addColorStop(0.18, 'rgba(255,230,140,0.9)');
    g.addColorStop(0.5, 'rgba(255,140,40,0.45)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 58, 0, Math.PI * 2); ctx.fill();
    // yıldız kolları
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      ctx.rotate(Math.PI * 2 / 5);
      ctx.fillStyle = 'rgba(255,220,150,0.55)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -52); ctx.lineTo(7, -52); ctx.fill();
    }
    T.flash = new THREE.CanvasTexture(c);
    T.flash.colorSpace = THREE.SRGBColorSpace;
  }

  return T;
}

export function matFrom(pair, opts = {}) {
  return new THREE.MeshStandardMaterial({
    map: pair.map,
    normalMap: pair.normalMap,
    normalScale: new THREE.Vector2(opts.normalScale ?? 0.7, opts.normalScale ?? 0.7),
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? 0.92,
    metalness: opts.metalness ?? 0.03,
    side: opts.side ?? THREE.FrontSide,
  });
}
