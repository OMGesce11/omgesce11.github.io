import * as THREE from 'three';
import { clamp, mulberry32 } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const particleVert = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(-mv.z, 0.001));
    gl_Position = projectionMatrix * mv;
  }
`;
const particleFrag = /* glsl */`
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    float a = t.a * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor * t.rgb, a);
  }
`;

class ParticlePool {
  constructor(scene, texture, max, blending) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: particleVert, fragmentShader: particleFrag,
      transparent: true, depthWrite: false, vertexColors: true,
      blending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.geo = g;
  }
  emit(p, v, color, size, life, opts = {}) {
    let i = this.count;
    if (i >= this.max) i = Math.floor(Math.random() * this.max);
    else this.count++;
    const i3 = i * 3;
    this.pos[i3] = p.x; this.pos[i3 + 1] = p.y; this.pos[i3 + 2] = p.z;
    this.vel[i3] = v.x; this.vel[i3 + 1] = v.y; this.vel[i3 + 2] = v.z;
    this.col[i3] = color.r; this.col[i3 + 1] = color.g; this.col[i3 + 2] = color.b;
    this.baseSize[i] = size; this.size[i] = size; this.alpha[i] = opts.alpha ?? 1;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = opts.gravity ?? -4;
    this.drag[i] = opts.drag ?? 1.6;
    this.grow[i] = opts.grow ?? 0;
  }
  update(dt) {
    const n = this.count;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = t * t * (3 - 2 * t);
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * (1 - t));
      alive++;
    }
    if (alive === 0 && n > 0) { this.count = 0; this.geo.setDrawRange(0, 0); return; }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'aSize', 'aAlpha']) this.geo.attributes[k].needsUpdate = true;
  }
  dispose() { this.points.parent?.remove(this.points); this.geo.dispose(); this.points.material.dispose(); }
}

export class Effects {
  constructor(scene, T, camera) {
    this.scene = scene; this.T = T; this.camera = camera;
    this.rnd = mulberry32(4711);
    this.sparks = new ParticlePool(scene, T.soft, 1400, THREE.AdditiveBlending);
    this.smoke = new ParticlePool(scene, T.soft, 800, THREE.NormalBlending);
    this.shake = 0;
    this.flashAmount = 0;

    // İzli mermi havuzu
    this.tracers = [];
    const tg = new THREE.CylinderGeometry(0.014, 0.008, 1, 5, 1, true);
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
        color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false; m.frustumCulled = false; scene.add(m);
      this.tracers.push({ mesh: m, life: 0, max: 0.1 });
    }
    // Dekal havuzu
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({
        map: T.decal, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      }));
      m.visible = false; scene.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }
    this.decalIdx = 0;
    // Namlu alevi sprite havuzu
    this.flashes = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.flash, color: 0xffddaa, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false; scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
    // Patlama ışıkları
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xff9c40, 0, 18, 2);
      scene.add(l); this.lights.push({ light: l, life: 0, power: 0 });
    }
    // Patlama küresi / şok dalgası
    this.blasts = [];
    for (let i = 0; i < 6; i++) {
      const core = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffcf70, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffddaa, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      core.visible = ring.visible = false;
      scene.add(core, ring);
      this.blasts.push({ core, ring, life: 0 });
    }
    // Kovan havuzu (basit instanced kutu)
    this.casings = [];
    const cg = new THREE.CylinderGeometry(0.017, 0.017, 0.075, 6);
    const cm = new THREE.MeshStandardMaterial({ color: 0xc9973f, metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 28; i++) {
      const m = new THREE.Mesh(cg, cm); m.visible = false; m.castShadow = false; scene.add(m);
      this.casings.push({ mesh: m, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
    this.casingIdx = 0;
  }

  _light(pos, color, power, life, dist = 18) {
    const l = this.lights.find((x) => x.life <= 0) || this.lights[0];
    l.light.position.copy(pos); l.light.color.set(color); l.light.distance = dist;
    l.power = power; l.life = life; l.max = life; l.light.intensity = power;
  }

  tracer(from, to, color = 0xffd27a, speed = 1) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    _v.subVectors(to, from);
    const len = _v.length();
    if (len < 0.01) return;
    t.mesh.position.copy(from).addScaledVector(_v, 0.5);
    _q.setFromUnitVectors(UP, _v2.copy(_v).normalize());
    t.mesh.quaternion.copy(_q);
    t.mesh.scale.set(1, len, 1);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 0.95;
    t.mesh.visible = true;
    t.life = t.max = 0.09 / speed;
  }

  muzzleFlash(pos, dir, scale = 1, color = 0xffddaa) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.sprite.position.copy(pos).addScaledVector(dir, 0.12);
    const s = (0.55 + Math.random() * 0.3) * scale;
    f.sprite.scale.set(s, s, s);
    f.sprite.material.color.set(color);
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.material.opacity = 1;
    f.sprite.visible = true;
    f.life = f.max = 0.055;
    this._light(pos, 0xffb95e, 2.2 * scale, 0.07, 9);
    // hafif namlu dumanı
    for (let i = 0; i < 3; i++) {
      this.smoke.emit(pos,
        new THREE.Vector3(dir.x * 1.2 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, dir.z * 1.2 + (Math.random() - 0.5)),
        new THREE.Color(0x9a8b74), 0.22 + Math.random() * 0.2, 0.5 + Math.random() * 0.4,
        { gravity: 0.6, drag: 2.2, grow: 2.5, alpha: 0.28 });
    }
  }

  casing(pos, dir) {
    const c = this.casings[this.casingIdx++ % this.casings.length];
    c.mesh.position.copy(pos);
    c.mesh.visible = true; c.life = 1.4;
    c.vel.set((Math.random() - 0.5) * 2 + dir.x * 0.4, 2 + Math.random() * 1.5, (Math.random() - 0.5) * 2 + dir.z * 0.4);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
  }

  impact(point, normal, kind = 'concrete', blood = false) {
    const col = kind === 'metal' ? new THREE.Color(0xffd58a) : kind === 'sand' || kind === 'ground' ? new THREE.Color(0xd8b98a) : new THREE.Color(0xffe0a0);
    if (blood) col.set(0xc4231b);
    const n = blood ? 10 : 12;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(
        normal.x * (1.2 + Math.random() * 3) + (Math.random() - 0.5) * 3.4,
        normal.y * (1.2 + Math.random() * 3) + (Math.random() - 0.5) * 3.4,
        normal.z * (1.2 + Math.random() * 3) + (Math.random() - 0.5) * 3.4,
      );
      this.sparks.emit(point, v, blood ? new THREE.Color(0xdd3325) : col, 0.055 + Math.random() * 0.06, 0.16 + Math.random() * 0.3, { gravity: -9, drag: 1.4 });
    }
    for (let i = 0; i < 5; i++) {
      this.smoke.emit(point,
        new THREE.Vector3(normal.x + (Math.random() - 0.5), normal.y + 0.7 + Math.random(), normal.z + (Math.random() - 0.5)),
        blood ? new THREE.Color(0x8a241c) : new THREE.Color(0xb9a588), 0.25 + Math.random() * 0.25, 0.5 + Math.random() * 0.5,
        { gravity: 0.5, drag: 2.4, grow: 2.6, alpha: blood ? 0.4 : 0.32 });
    }
    if (blood) return;
    const d = this.decals[this.decalIdx++ % this.decals.length];
    d.mesh.position.copy(point).addScaledVector(normal, 0.012);
    _v.copy(point).add(normal);
    d.mesh.lookAt(_v);
    const s = 0.12 + Math.random() * 0.12;
    d.mesh.scale.set(s, s, s);
    d.mesh.material.opacity = 0.85;
    d.mesh.visible = true;
    d.life = 15;
    this.shake = Math.min(1, this.shake + 0.012);
  }

  explosion(pos, radius = 6) {
    const b = this.blasts.find((x) => x.life <= 0) || this.blasts[0];
    b.core.position.copy(pos); b.core.scale.setScalar(0.4); b.core.material.opacity = 1; b.core.visible = true;
    b.ring.position.copy(pos); b.ring.position.y += 0.06; b.ring.scale.setScalar(0.3); b.ring.material.opacity = 0.9; b.ring.visible = true;
    b.life = b.max = 0.55; b.radius = radius;
    this._light(pos, 0xffa040, 16, 0.4, 28);
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.2) * 1.2;
      const sp = 4 + Math.random() * 15;
      const v = new THREE.Vector3(Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp);
      this.sparks.emit(pos, v, new THREE.Color(i % 3 ? 0xffb638 : 0xfff1b0), 0.14 + Math.random() * 0.22, 0.3 + Math.random() * 0.6, { gravity: -13, drag: 1.1 });
    }
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 4), 1 + Math.random() * 4, Math.sin(a) * (1 + Math.random() * 4));
      this.smoke.emit(pos, v, new THREE.Color(0x4a4238), 0.8 + Math.random() * 1.2, 1.6 + Math.random() * 1.8, { gravity: 0.7, drag: 1.3, grow: 2.8, alpha: 0.62 });
    }
    // yere çarpan moloz
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a) * (3 + Math.random() * 8), 3 + Math.random() * 7, Math.sin(a) * (3 + Math.random() * 8));
      this.sparks.emit(pos, v, new THREE.Color(0x8b816c), 0.1, 0.7 + Math.random() * 0.6, { gravity: -18, drag: 0.5 });
    }
    this.shake = Math.min(1.6, this.shake + 0.85);
    this.flashAmount = Math.min(1, this.flashAmount + 0.35);
  }

  hitMarker() { /* UI tarafında */ }

  update(dt) {
    this.sparks.update(dt);
    this.smoke.update(dt);
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.95 * (t.life / t.max);
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.sprite.visible = false; continue; }
      const k = f.life / f.max;
      f.sprite.material.opacity = k;
      f.sprite.scale.multiplyScalar(1 + dt * 3);
    }
    for (const d of this.decals) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      if (d.life < 2) d.mesh.material.opacity = 0.85 * (d.life / 2);
    }
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      l.light.intensity = l.power * Math.max(0, l.life / l.max);
    }
    for (const b of this.blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = 1 - b.life / b.max;
      if (b.life <= 0) { b.core.visible = b.ring.visible = false; continue; }
      b.core.scale.setScalar(0.4 + k * b.radius * 0.55);
      b.core.material.opacity = Math.max(0, 0.9 - k * 1.6);
      b.ring.scale.setScalar(0.3 + k * b.radius * 1.5);
      b.ring.material.opacity = Math.max(0, 0.8 - k);
    }
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (c.life <= 0) { c.mesh.visible = false; continue; }
      c.vel.y -= 18 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      if (c.mesh.position.y < 0.04) { c.mesh.position.y = 0.04; c.vel.y *= -0.35; c.vel.x *= 0.6; c.vel.z *= 0.6; }
    }
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.flashAmount = Math.max(0, this.flashAmount - dt * 2.2);
  }

  dispose() {
    this.sparks.dispose(); this.smoke.dispose();
    for (const t of this.tracers) { t.mesh.parent?.remove(t.mesh); t.mesh.material.dispose(); }
    for (const d of this.decals) { d.mesh.parent?.remove(d.mesh); d.mesh.material.dispose(); }
    for (const f of this.flashes) { f.sprite.parent?.remove(f.sprite); f.sprite.material.dispose(); }
    for (const b of this.blasts) { b.core.parent?.remove(b.core, b.ring); b.core.material.dispose(); b.ring.material.dispose(); }
    for (const c of this.casings) c.mesh.parent?.remove(c.mesh);
    for (const l of this.lights) l.light.parent?.remove(l.light);
  }
}
