import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { buildWorldGun } from './weapons.js';
import { clamp, damp } from './util.js';

const _wp = new THREE.Vector3();

export const TEAM_COLORS = { blue: 0x3d8ee0, red: 0xe14b3b };

let ASSETS = null;
export function loadCharacterAssets(onProgress) {
  if (ASSETS) return ASSETS;
  ASSETS = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      './assets/models/soldier.glb',
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      (e) => onProgress && onProgress(e),
      reject,
    );
  });
  return ASSETS;
}

function nameplateTexture(name, team, hp) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  const col = team === 'blue' ? '#4fa3ff' : '#ff5a45';
  ctx.font = '700 46px Rajdhani, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(6,10,14,0.55)';
  const w = Math.min(500, ctx.measureText(name).width + 70);
  ctx.fillRect((512 - w) / 2, 4, w, 60);
  ctx.fillStyle = col;
  ctx.fillRect((512 - w) / 2, 4, 6, 60);
  ctx.fillStyle = '#f4f6f8';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
  ctx.fillText(name, 256, 50);
  ctx.shadowBlur = 0;
  // can çubuğu
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(156, 76, 200, 16);
  ctx.fillStyle = hp > 40 ? (team === 'blue' ? '#4fa3ff' : '#ff5a45') : '#ffb020';
  ctx.fillRect(158, 78, 196 * clamp(hp / 100, 0, 1), 12);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
  ctx.strokeRect(156, 76, 200, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function addGear(root, team, T) {
  const col = TEAM_COLORS[team];
  const dark = new THREE.MeshStandardMaterial({ color: 0x282c2a, roughness: 0.85, metalness: 0.15 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x494f3b, roughness: 0.95 });
  const accent = new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.2, emissive: col, emissiveIntensity: 0.22 });
  const glow = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.4, roughness: 0.3 });
  const gear = new THREE.Group();
  const B = (w, h, d, x, y, z, m, rx = 0) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; gear.add(b); return b;
  };
  // sırt çantası
  B(0.42, 0.52, 0.24, 0, 1.30, 0.29, cloth);
  B(0.30, 0.22, 0.06, 0, 1.42, 0.43, dark);
  B(0.44, 0.05, 0.27, 0, 1.55, 0.3, dark);
  B(0.07, 0.42, 0.06, -0.16, 1.30, 0.43, accent);
  B(0.07, 0.42, 0.06, 0.16, 1.30, 0.43, accent);
  // göğüs zırhı / mühimmat cepleri
  B(0.46, 0.30, 0.10, 0, 1.28, -0.24, dark);
  for (let i = -1; i <= 1; i++) B(0.11, 0.15, 0.07, i * 0.14, 1.24, -0.31, cloth);
  // omuz üniforma ışıkları
  for (const s of [-1, 1]) {
    B(0.14, 0.09, 0.16, s * 0.31, 1.51, -0.03, dark);
    const led = B(0.06, 0.025, 0.05, s * 0.31, 1.56, -0.06, glow);
    led.castShadow = false;
  }
  // kol bandı
  B(0.15, 0.09, 0.16, -0.30, 1.27, 0.01, accent);
  // kemer + kılıf
  B(0.44, 0.09, 0.28, 0, 0.96, 0, dark);
  B(0.10, 0.20, 0.10, 0.27, 0.83, 0.02, dark);
  // miğfer üstü kamera/ışık
  B(0.08, 0.05, 0.08, 0, 1.79, -0.14, dark);
  root.add(gear);
  return gear;
}

export class Character {
  constructor(assets, { team = 'blue', name = 'ASKER', T, weapon = 'ar', isLocal = false } = {}) {
    this.team = team;
    this.name = name;
    this.root = new THREE.Group();
    this.model = cloneSkinned(assets.scene);
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.material) {
          o.material = o.material.clone();
          const tint = team === 'blue' ? 0xc4d8ee : 0xffd2c0;
          o.material.color.multiply(new THREE.Color(tint));
          o.material.roughness = Math.min(1, (o.material.roughness ?? 0.8) * 0.95);
          o.material.metalness = o.material.metalness ?? 0.1;
          o.material.envMapIntensity = 0.85;
        }
      }
    });
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of assets.animations) {
      const n = clip.name.toLowerCase();
      const key = n.includes('idle') ? 'idle' : n.includes('walk') ? 'walk' : n.includes('run') ? 'run' : null;
      if (!key) continue;
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions[key] = a;
    }
    this.current = 'idle';
    if (this.actions.idle) { this.actions.idle.setEffectiveWeight(1).play(); }
    if (this.actions.walk) this.actions.walk.setEffectiveWeight(0).play();
    if (this.actions.run) this.actions.run.setEffectiveWeight(0).play();

    // El kemiği bulunur; silah her karede elin dünya konumuna oturtulur
    this.hand = null;
    this.model.traverse((o) => {
      const n = (o.name || '').toLowerCase();
      if (n.includes('righthand') || n.includes('right_hand')) this.hand = o;
    });

    this.gun = buildWorldGun(weapon, T);
    this.root.add(this.gun);
    this.gunMuzzle = new THREE.Vector3();
    this.gunLocal = this.gun.userData.muzzle.clone();

    this.gear = addGear(this.root, team, T);
    // Yumuşak temas gölgesi (ekran alanı AO yerine hafif bir gölge)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: T.soft, color: 0x0b0a08, transparent: true, opacity: 0.42,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.35), shadowMat);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.035;
    this.blob.renderOrder = 1;
    this.root.add(this.blob);
    this.plateSprite = null;
    this.plateHp = -1;
    if (!isLocal) {
      this.plateTex = nameplateTexture(name, team, 100);
      this.plateMat = new THREE.SpriteMaterial({ map: this.plateTex, transparent: true, depthTest: true, depthWrite: false });
      this.plateSprite = new THREE.Sprite(this.plateMat);
      this.plateSprite.scale.set(1.7, 0.43, 1);
      this.plateSprite.position.set(0, 2.12, 0);
      this.root.add(this.plateSprite);
    }
    this.dead = false;
    this.deathT = 0;
    this.speed = 0;
    this.crouch = 0;
    this.pitch = 0;
    this.visible = true;
  }

  setTeam(team) {
    this.team = team;
    if (this.plateSprite) {
      this.plateTex.dispose();
      this.plateTex = nameplateTexture(this.name, team, 100);
      this.plateMat.map = this.plateTex; this.plateMat.needsUpdate = true;
    }
  }

  setHp(hp) {
    if (!this.plateSprite || this.plateHp === hp) return;
    this.plateHp = hp;
    const old = this.plateTex;
    this.plateTex = nameplateTexture(this.name, this.team, hp);
    this.plateMat.map = this.plateTex; this.plateMat.needsUpdate = true;
    old.dispose();
  }

  setDead(v) {
    this.dead = v;
    this.deathT = 0;
    if (this.plateSprite) this.plateSprite.visible = !v;
  }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.visible = v;
  }

  update(dt, s, camera) {
    this.speed = damp(this.speed, s.speed || 0, 10, dt);
    this.crouch = damp(this.crouch, s.crouch ? 1 : 0, 11, dt);
    this.pitch = damp(this.pitch, s.pitch || 0, 14, dt);

    // Animasyon karışımı
    const runW = clamp((this.speed - 2.2) / 3.2, 0, 1);
    const walkW = clamp(this.speed / 2.2, 0, 1) * (1 - runW);
    const idleW = clamp(1 - Math.max(runW, walkW), 0, 1);
    const targets = { idle: idleW, walk: walkW, run: runW };
    for (const k in this.actions) {
      const a = this.actions[k];
      a.setEffectiveWeight(damp(a.getEffectiveWeight(), targets[k] ?? 0, 12, dt));
    }
    if (!this.dead) this.mixer.update(dt * clamp(0.7 + this.speed * 0.12, 0.7, 1.35));

    // Ölüm animasyonu: yana devrilip yere yığılma
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt * 2.6);
      const k = this.deathT;
      this.model.rotation.x = -k * 1.35;
      this.model.position.y = -k * 0.72;
      this.model.rotation.z = k * 0.35;
      this.gun.visible = false;
    } else {
      this.model.rotation.x = 0; this.model.rotation.z = 0;
      this.model.position.y = -this.crouch * 0.32;
      this.gun.visible = true;
    }

    // Silahı sağ elin dünya konumuna yerleştir (kemik eksenlerinden bağımsız)
    this.root.updateWorldMatrix(true, true);
    if (this.hand && !this.dead) {
      this.hand.getWorldPosition(_wp);
      this.root.worldToLocal(_wp);
      this.gun.position.set(
        _wp.x - 0.02,
        _wp.y + 0.015 - this.crouch * 0.06,
        _wp.z - 0.16,
      );
      this.gun.rotation.set(clamp(this.pitch, -0.9, 0.9) * 0.75, 0, 0);
    }
    this.gun.updateWorldMatrix(true, false);
    this.gunMuzzle.copy(this.gunLocal).applyMatrix4(this.gun.matrixWorld);

    if (this.plateSprite && camera) {
      const d = camera.position.distanceTo(this.root.position);
      this.plateSprite.visible = !this.dead && d < 55 && this.visible;
      this.plateMat.opacity = clamp((55 - d) / 18, 0, 1) * 0.95;
      const sc = clamp(d / 22, 1, 2.6);
      this.plateSprite.scale.set(1.7 * sc, 0.43 * sc, 1);
    }
  }

  /** Işın - vücut / kafa / bacak çarpışması. {t, part} veya null */
  raycast(origin, dir, maxDist) {
    const o = origin, d = dir;
    const parts = [
      { part: 'head', cx: 0, cy: 1.63, cz: 0, r: 0.205, mult: 1 },
      { part: 'body', cx: 0, cy: 1.15, cz: 0, r: 0.36, mult: 1 },
      { part: 'legs', cx: 0, cy: 0.55, cz: 0, r: 0.30, mult: 0.8 },
    ];
    let best = null;
    const px = this.root.position.x, pz = this.root.position.z, py = this.root.position.y - this.crouch * 0.32;
    for (const p of parts) {
      const ex = o.x - (px + p.cx), ey = o.y - (py + p.cy), ez = o.z - (pz + p.cz);
      const b = 2 * (ex * d.x + ey * d.y + ez * d.z);
      const c = ex * ex + ey * ey + ez * ez - p.r * p.r;
      const disc = b * b - 4 * c; // |d| = 1
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / 2;
      if (t > 0.02 && t < maxDist && (!best || t < best.t)) best = { t, part: p.part, mult: p.mult };
    }
    return best;
  }

  dispose() {
    this.mixer.stopAllAction();
    // GLTF geometrileri tüm karakterler arasında paylaşılır: sadece
    // bu örneğe ait teçhizatı temizle, ortak modeli bozma.
    for (const obj of [this.gear, this.gun, this.blob]) {
      obj?.traverse?.((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else o.material.dispose();
        }
      });
    }
    this.model.traverse((o) => {
      if (o.isMesh && o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    if (this.plateTex) this.plateTex.dispose();
    if (this.plateMat) this.plateMat.dispose();
    this.root.parent?.remove(this.root);
  }
}
