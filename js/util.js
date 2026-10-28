// Küçük matematik / yardımcı fonksiyonlar
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (t) => t * t * (3 - 2 * t);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const angleLerp = (a, b, t) => a + angleDelta(a, b) * t;

export function uid(len = 8) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const arr = new Uint8Array(len);
  (self.crypto || window.crypto).getRandomValues(arr);
  for (let i = 0; i < len; i++) s += c[arr[i] % c.length];
  return s;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function roomCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const a = new Uint8Array(5);
  (self.crypto || window.crypto).getRandomValues(a);
  for (let i = 0; i < 5; i++) s += c[a[i] % c.length];
  return s;
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}

// Yön vektörü: three.js kamera varsayılanı -Z'ye bakar
export function yawToDir(yaw, out) {
  out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  return out;
}

// Işın - AABB kesişimi (slab metodu). Çarpma yoksa null.
export function rayAABB(ox, oy, oz, dx, dy, dz, min, max, maxDist) {
  let tmin = 0, tmax = maxDist, nx = 0, ny = 0, nz = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const bmin = [min.x, min.y, min.z], bmax = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < bmin[i] || o[i] > bmax[i]) return null;
    } else {
      const inv = 1 / d[i];
      let t1 = (bmin[i] - o[i]) * inv;
      let t2 = (bmax[i] - o[i]) * inv;
      let sign = -1;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = i === 0 ? sign : 0; ny = i === 1 ? sign : 0; nz = i === 2 ? sign : 0;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return { t: tmin, nx, ny, nz };
}

// Işın - dikey kapsül (oyuncu vücut / kafa). t > 0 döner.
export function rayCapsule(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius, halfHeight) {
  // Silindir gövdesi (XZ dairesi) + küre uçları
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  let best = Infinity;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t <= 0) continue;
        const y = oy + dy * t;
        const yc = clamp(y, cy - halfHeight, cy + halfHeight);
        if (Math.abs(y - yc) < 1e-6) best = Math.min(best, t);
      }
    }
  }
  // Uç küreler
  for (const sy of [cy - halfHeight, cy + halfHeight]) {
    const ex = ox - cx, ey = oy - sy, ez = oz - cz;
    const b = 2 * (ex * dx + ey * dy + ez * dz);
    const c = ex * ex + ey * ey + ez * ez - radius * radius;
    const disc = b * b - 4 * a2(dx, dy, dz) * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a2(dx, dy, dz));
      if (t > 0) best = Math.min(best, t);
    }
  }
  return best === Infinity ? null : best;
}
const a2 = (x, y, z) => x * x + y * y + z * z;
