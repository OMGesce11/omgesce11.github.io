import * as THREE from 'three';
import { clamp, damp, lerp } from './util.js';

export const WEAPONS = {
  ar: {
    id: 'ar', name: 'M4A1 KARABİN', short: 'M4A1', damage: 25, headMult: 2.1, rpm: 720,
    mag: 30, reserve: 180, reload: 2.05, spreadHip: 0.031, spreadAds: 0.0055,
    recoilV: 0.010, recoilH: 0.0055, auto: true, range: 160, zoom: 1.32,
    sound: 'rifle', tracer: 0xffd27a, ammoIcon: '▮', score: 100, switchTime: 0.55,
  },
  smg: {
    id: 'smg', name: 'MP5A5 HAFİF MAKİNELİ', short: 'MP5', damage: 18, headMult: 1.9, rpm: 930,
    mag: 32, reserve: 192, reload: 1.8, spreadHip: 0.042, spreadAds: 0.013,
    recoilV: 0.007, recoilH: 0.007, auto: true, range: 95, zoom: 1.24,
    sound: 'smg', tracer: 0xffdca0, ammoIcon: '▮', score: 100, switchTime: 0.45,
  },
  dmr: {
    id: 'dmr', name: 'M110 KESKİN NİŞANCI', short: 'M110', damage: 68, headMult: 2.5, rpm: 260,
    mag: 12, reserve: 72, reload: 2.55, spreadHip: 0.055, spreadAds: 0.0016,
    recoilV: 0.026, recoilH: 0.009, auto: false, range: 260, zoom: 2.5,
    sound: 'dmr', tracer: 0xfff0c0, ammoIcon: '▮', score: 150, switchTime: 0.7,
  },
};
export const WEAPON_LIST = ['ar', 'smg', 'dmr'];

function materials(T, M0) {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0x596169, metalness: 0.82, roughness: 0.44 }),
    black: new THREE.MeshStandardMaterial({ color: 0x2b3034, metalness: 0.55, roughness: 0.55 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x494f47, metalness: 0.12, roughness: 0.82 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x8a7956, metalness: 0.25, roughness: 0.7 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c9298, metalness: 0.95, roughness: 0.28 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x16323a, metalness: 0.65, roughness: 0.1, emissive: 0x123038, emissiveIntensity: 0.35 }),
    glove: new THREE.MeshStandardMaterial({ color: 0x4b4a3f, roughness: 0.95 }),
    sleeve: new THREE.MeshStandardMaterial({ map: T.fabric.map, normalMap: T.fabric.normalMap, color: 0x3d4638, roughness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb0332b, metalness: 0.4, roughness: 0.5, emissive: 0x330503 }),
  };
}

function addBox(parent, w, h, d, x, y, z, mat, rz = 0, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.z = rz; m.rotation.y = ry;
  m.castShadow = false; m.receiveShadow = false;
  parent.add(m); return m;
}
function addCyl(parent, rt, rb, h, x, y, z, mat, rx = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z); m.rotation.x = rx; parent.add(m); return m;
}

/** Birinci şahıs el/silah modeli (viewScene içinde, kameraya sabit) */
export function buildViewGun(id, T) {
  const g = new THREE.Group();
  const M = materials(T);
  const isDmr = id === 'dmr', isSmg = id === 'smg';
  const barrelLen = isDmr ? 0.58 : 0.36;
  const frontZ = -0.14 - (isDmr ? 0.40 : 0.30);

  // alt/üst gövde
  addBox(g, 0.088, 0.105, 0.30, 0, -0.015, -0.02, M.body);
  addBox(g, 0.094, 0.055, 0.31, 0, 0.058, -0.02, M.body);
  addBox(g, 0.10, 0.022, 0.32, 0, 0.092, -0.02, M.black); // üst ray
  for (let i = 0; i < 4; i++) addBox(g, 0.06, 0.005, 0.007, 0, 0.104, -0.10 + i * 0.065, M.steel);

  // El kundağı + ray
  addBox(g, 0.079, 0.088, isDmr ? 0.40 : 0.30, 0, 0.008, frontZ + (isDmr ? 0.02 : 0), M.polymer);
  for (let i = 0; i < (isDmr ? 11 : 8); i++) {
    addBox(g, 0.084, 0.012, 0.014, 0, 0.062, frontZ - (isDmr ? 0.19 : 0.14) + i * 0.036, M.steel);
  }
  // yan raylar
  for (const s of [-1, 1]) {
    addBox(g, 0.012, 0.035, isDmr ? 0.26 : 0.2, s * 0.045, 0.005, frontZ, M.black);
    for (let i = 0; i < 3; i++) addBox(g, 0.018, 0.007, 0.010, s * 0.048, 0.005, frontZ - 0.07 + i * 0.06, M.black);
  }

  // namlu + alev gizleyen / susturucu
  addCyl(g, 0.016, 0.016, barrelLen, 0, 0.018, frontZ - (isDmr ? 0.4 : 0.30) - barrelLen / 2 + 0.03, M.steel, Math.PI / 2);
  const muzzleZ = frontZ - (isDmr ? 0.4 : 0.30) - barrelLen + 0.02;
  if (isSmg) {
    addCyl(g, 0.026, 0.026, 0.09, 0, 0.018, muzzleZ - 0.02, M.black, Math.PI / 2);
  } else if (isDmr) {
    addCyl(g, 0.032, 0.029, 0.14, 0, 0.018, muzzleZ - 0.04, M.black, Math.PI / 2);
    for (let i = 0; i < 3; i++) addCyl(g, 0.033, 0.033, 0.006, 0, 0.018, muzzleZ - 0.11 + i * 0.04, M.steel, Math.PI / 2);
  } else {
    addCyl(g, 0.024, 0.024, 0.08, 0, 0.018, muzzleZ - 0.01, M.black, Math.PI / 2);
    for (let i = 0; i < 3; i++) addBox(g, 0.05, 0.005, 0.01, 0, 0.018, muzzleZ - 0.065 + i * 0.016, M.black);
  }
  // arpacık
  addBox(g, 0.014, 0.055, 0.018, 0, 0.088, frontZ - (isDmr ? 0.17 : 0.12), M.black);

  // Optik
  if (isDmr) {
    addCyl(g, 0.038, 0.038, 0.22, 0, 0.155, -0.06, M.black, Math.PI / 2, 16);
    addCyl(g, 0.045, 0.045, 0.025, 0, 0.155, -0.17, M.steel, Math.PI / 2, 16);
    addCyl(g, 0.036, 0.036, 0.004, 0, 0.155, -0.184, M.glass, Math.PI / 2, 16);
    addCyl(g, 0.034, 0.034, 0.02, 0, 0.155, 0.055, M.black, Math.PI / 2, 16);
    addBox(g, 0.05, 0.05, 0.05, 0, 0.12, -0.06, M.body);
    addCyl(g, 0.012, 0.012, 0.03, 0.036, 0.166, -0.02, M.steel, 0, 8);
  } else {
    addBox(g, 0.062, 0.062, 0.10, 0, 0.145, -0.055, M.body);
    addCyl(g, 0.026, 0.026, 0.012, 0, 0.145, -0.112, M.glass, Math.PI / 2, 16);
    addBox(g, 0.045, 0.03, 0.05, 0, 0.112, -0.055, M.black);
    addCyl(g, 0.008, 0.008, 0.02, 0.036, 0.152, -0.01, M.steel, 0, 8);
  }

  // Şarjör
  const mag = addBox(g, 0.068, 0.19, 0.085, 0, -0.15, -0.01, M.polymer, -0.13);
  addBox(g, 0.072, 0.02, 0.09, 0, -0.243, -0.028, M.black, -0.13);
  addBox(g, 0.072, 0.018, 0.088, 0, -0.056, 0.005, M.steel, -0.13);
  if (isSmg) { mag.scale.y = 0.8; }

  // Tetik, kabza, emniyet
  addBox(g, 0.06, 0.10, 0.03, 0, -0.085, 0.01, M.black);
  addBox(g, 0.066, 0.16, 0.08, 0, -0.13, 0.105, M.polymer, -0.28);
  addBox(g, 0.012, 0.045, 0.012, 0, -0.088, -0.01, M.steel);
  addBox(g, 0.012, 0.028, 0.035, 0.052, -0.015, 0.03, M.red);
  addBox(g, 0.006, 0.05, 0.012, 0.05, 0.03, 0.09, M.steel);

  // Dipçik
  addBox(g, 0.07, 0.085, 0.22, 0, 0.005, 0.245, M.polymer);
  addBox(g, 0.086, 0.13, 0.035, 0, 0.0, 0.36, M.black);
  for (let i = 0; i < 5; i++) addBox(g, 0.09, 0.008, 0.012, 0, 0.03, 0.17 + i * 0.035, M.black);

  // Eldivenli eller + kollar
  const right = new THREE.Group();
  addBox(right, 0.075, 0.085, 0.10, 0, 0, 0, M.glove);
  addBox(right, 0.078, 0.03, 0.038, 0, -0.02, -0.055, M.glove);
  for (let i = 0; i < 4; i++) addBox(right, 0.018, 0.03, 0.055, -0.033 + i * 0.022, -0.055, -0.035, M.glove);
  const rArm = addCyl(right, 0.038, 0.056, 0.26, 0.075, -0.17, 0.17, M.sleeve, 0.85);
  rArm.rotation.z = -0.45;
  right.position.set(0.01, -0.105, 0.09);
  right.rotation.x = -0.2;
  g.add(right);

  const left = new THREE.Group();
  addBox(left, 0.082, 0.082, 0.11, 0, 0, 0, M.glove);
  for (let i = 0; i < 4; i++) addBox(left, 0.02, 0.032, 0.06, -0.036 + i * 0.024, 0.03, -0.04, M.glove);
  const lArm = addCyl(left, 0.036, 0.054, 0.27, -0.05, -0.16, 0.19, M.sleeve, 0.9);
  lArm.rotation.z = 0.32;
  left.position.set(-0.055, -0.035, frontZ + 0.05);
  left.rotation.y = 0.15;
  g.add(left);

  // askı kayışı
  addBox(g, 0.006, 0.006, 0.3, -0.06, -0.02, 0.05, M.tan, 0, -0.2);

  g.userData.muzzle = new THREE.Vector3(0, 0.018, muzzleZ - (isDmr ? 0.12 : 0.07));
  g.userData.eject = new THREE.Vector3(0.07, 0.02, 0.02);
  g.userData.mag = mag;
  return g;
}

/** Üçüncü şahıs askerlerin elindeki silah */
export function buildWorldGun(id, T) {
  const g = new THREE.Group();
  const M = materials(T);
  const isDmr = id === 'dmr';
  addBox(g, 0.11, 0.14, 0.42, 0, 0, 0, M.body);
  addBox(g, 0.09, 0.04, 0.44, 0, 0.08, 0, M.black);
  addBox(g, 0.085, 0.11, isDmr ? 0.42 : 0.32, 0, 0, -0.36, M.polymer);
  addCyl(g, 0.022, 0.022, isDmr ? 0.62 : 0.40, 0, 0.02, -0.78, M.steel, Math.PI / 2);
  addBox(g, 0.075, 0.24, 0.10, 0, -0.16, -0.02, M.polymer, -0.18);
  addBox(g, 0.07, 0.15, 0.09, 0, -0.13, 0.15, M.polymer, -0.28);
  addBox(g, 0.08, 0.11, 0.26, 0, 0.005, 0.32, M.polymer);
  addBox(g, 0.095, 0.15, 0.04, 0, 0, 0.46, M.black);
  if (isDmr) {
    addCyl(g, 0.045, 0.045, 0.26, 0, 0.15, -0.02, M.black, Math.PI / 2, 12);
    addCyl(g, 0.04, 0.04, 0.01, 0, 0.15, -0.16, M.glass, Math.PI / 2, 12);
  } else {
    addBox(g, 0.07, 0.075, 0.13, 0, 0.14, -0.03, M.body);
  }
  g.userData.muzzle = new THREE.Vector3(0, 0.02, isDmr ? -1.1 : -0.99);
  return g;
}

/** Viewmodel animasyonu: nefes, yürüyüş sallanması, nişan, geri tepme */
export class ViewModel {
  constructor(viewScene, T) {
    this.scene = viewScene;
    this.T = T;
    this.guns = {};
    this.current = null;
    this.id = null;
    this.recoil = 0; this.recoilV = 0; this.kick = 0;
    this.bob = 0; this.sway = new THREE.Vector2();
    this.ads = 0;
    this.reloadT = 0; this.reloadMax = 1;
    this.switchT = 0;
    this.t = 0;
  }
  setWeapon(id) {
    if (this.id === id) return;
    if (this.current) this.current.visible = false;
    this.id = id;
    if (!this.guns[id]) {
      const g = buildViewGun(id, this.T);
      this.scene.add(g);
      this.guns[id] = g;
    }
    this.current = this.guns[id];
    this.current.visible = true;
    this.switchT = WEAPONS[id].switchTime;
  }
  fire() {
    const w = WEAPONS[this.id];
    this.recoilV += w.recoilV * 14;
    this.kick = 1;
  }
  reloadStart(time) { this.reloadT = time; this.reloadMax = time; }
  muzzleWorld(out) {
    if (!this.current) return out.set(0, 0, -0.5);
    this.current.updateMatrixWorld(true);
    return out.copy(this.current.userData.muzzle).applyMatrix4(this.current.matrixWorld);
  }
  ejectWorld(out) {
    if (!this.current) return out.set(0, 0, 0);
    this.current.updateMatrixWorld(true);
    return out.copy(this.current.userData.eject).applyMatrix4(this.current.matrixWorld);
  }
  update(dt, s) {
    this.t += dt;
    if (!this.current) return;
    const g = this.current;
    // geri tepme yayı
    this.recoilV += (-this.recoil * 90 - this.recoilV * 16) * dt;
    this.recoil += this.recoilV * dt;
    this.kick = Math.max(0, this.kick - dt * 9);
    this.ads = damp(this.ads, s.ads ? 1 : 0, 13, dt);
    this.bob += s.moveSpeed * dt * (s.sprinting ? 13 : 9);
    const moving = clamp(s.moveSpeed / 5, 0, 1) * (1 - this.ads * 0.85);
    this.sway.x = damp(this.sway.x, clamp(-s.lookDX * 0.0035, -0.035, 0.035), 9, dt);
    this.sway.y = damp(this.sway.y, clamp(-s.lookDY * 0.0035, -0.035, 0.035), 9, dt);

    const hip = new THREE.Vector3(0.275, -0.155, -0.86);
    const aim = new THREE.Vector3(0.0, -0.145, -0.80);
    const p = hip.clone().lerp(aim, this.ads);
    p.x += Math.sin(this.bob) * 0.018 * moving + this.sway.x;
    p.y += Math.abs(Math.cos(this.bob)) * 0.016 * moving + this.sway.y - this.kick * 0.012;
    p.z += this.recoil * 0.85 + this.kick * 0.025;

    // şarjör değiştirme animasyonu
    let reloadAngle = 0, reloadDrop = 0;
    if (this.reloadT > 0) {
      this.reloadT = Math.max(0, this.reloadT - dt);
      const k = 1 - this.reloadT / this.reloadMax;
      const curve = Math.sin(clamp(k, 0, 1) * Math.PI);
      reloadAngle = curve * 0.75;
      reloadDrop = curve * 0.16;
      g.userData.mag.position.y = -0.15 - curve * 0.22;
      g.userData.mag.visible = k < 0.12 || k > 0.82;
    } else if (g.userData.mag) {
      g.userData.mag.position.y = -0.15;
      g.userData.mag.visible = true;
    }
    // silah değiştirme
    let switchDrop = 0;
    if (this.switchT > 0) {
      this.switchT = Math.max(0, this.switchT - dt);
      switchDrop = Math.sin((this.switchT / WEAPONS[this.id].switchTime) * Math.PI) * 0.34;
    }
    // koşma eğimi
    const sprintTilt = s.sprinting && !s.ads ? 0.28 : 0;
    p.y -= reloadDrop + switchDrop + (s.crouch ? 0.02 : 0);
    g.position.copy(p);
    g.scale.setScalar(1.0 - this.ads * 0.12);
    g.rotation.set(
      -this.recoil * 3.2 + reloadAngle * 0.55 - this.kick * 0.05 + this.sway.y * 1.2 + sprintTilt * 0.35,
      -0.19 + this.sway.x * 1.4 + sprintTilt * 0.5 + Math.sin(this.bob) * 0.012 * moving,
      0.06 + reloadAngle * 0.35 + Math.sin(this.bob * 0.5) * 0.012 * moving + sprintTilt * 0.7,
    );
  }
  dispose() {
    for (const k in this.guns) {
      const g = this.guns[k];
      g.parent?.remove(g);
      g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
  }
}
