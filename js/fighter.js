import * as THREE from 'three';
import { clamp, damp, angleLerp } from './util.js';
import { WEAPONS } from './weapons.js';

const _v = new THREE.Vector3();

export class Fighter {
  constructor(game, opts) {
    this.game = game;
    this.id = opts.id;
    this.name = opts.name || 'ASKER';
    this.team = opts.team || 'blue';
    this.isLocal = !!opts.isLocal;
    this.isBot = !!opts.isBot;
    this.character = null;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.prevPos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.hp = 100; this.maxHp = 100;
    this.kills = 0; this.deaths = 0; this.streak = 0;
    this.dead = false;
    this.respawnAt = 0;
    this.speed = 0;
    this.crouch = false;
    this.firing = false;
    this.sprinting = false;
    this.weapon = opts.weapon || 'ar';
    this.lastSeen = performance.now();
    this.ping = 0;
    this.snapNext = true;
  }

  eyeHeight() { return this.crouch ? 1.06 : 1.62; }

  /** Işın-vücut çarpışması (Character'dan bağımsız, yerel oyuncu için de çalışır) */
  raycast(origin, dir, maxDist = 200) {
    if (this.dead) return null;
    const py = this.pos.y - (this.crouch ? 0.32 : 0);
    const parts = [
      { part: 'head', cy: 1.64, r: 0.21, mult: 1 },
      { part: 'body', cy: 1.18, r: 0.36, mult: 1 },
      { part: 'legs', cy: 0.58, r: 0.31, mult: 0.82 },
    ];
    let best = null;
    for (const p of parts) {
      const ex = origin.x - this.pos.x, ey = origin.y - (py + p.cy), ez = origin.z - this.pos.z;
      const b = 2 * (ex * dir.x + ey * dir.y + ez * dir.z);
      const c = ex * ex + ey * ey + ez * ez - p.r * p.r;
      const disc = b * b - 4 * c; // |dir| = 1
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / 2;
      if (t > 0.02 && t < maxDist && (!best || t < best.t)) best = { t, part: p.part, mult: p.mult };
    }
    return best;
  }

  applyState(s) {
    this.lastSeen = performance.now();
    if (s.p) {
      this.targetPos.set(s.p[0], s.p[1], s.p[2]);
      if (this.snapNext) { this.pos.copy(this.targetPos); this.prevPos.copy(this.targetPos); this.snapNext = false; }
    }
    if (typeof s.r === 'number') this.targetYaw = s.r;
    if (typeof s.pr === 'number') this.pitch = s.pr;
    if (s.w) this.weapon = s.w;
    if (typeof s.hp === 'number') this.hp = s.hp;
    if (typeof s.k === 'number') this.kills = s.k;
    if (typeof s.d === 'number') this.deaths = s.d;
    this.speed = s.v ? Math.hypot(s.v[0], s.v[2]) : 0;
    this.crouch = !!s.c;
    this.sprinting = !!s.sp;
    this.firing = !!s.f;
    this.dead = !!s.dead;
    if (this.character) {
      this.character.setDead(this.dead);
      this.character.setHp(this.hp);
    }
  }

  /** Uzak oyuncular için yumuşak interpolasyon */
  interpolate(dt) {
    if (this.isLocal) return;
    if (!this.targetPos.equals(this.pos)) {
      const k = 1 - Math.exp(-14 * dt);
      this.pos.lerp(this.targetPos, k);
    }
    if (typeof this.targetYaw === 'number') this.yaw = angleLerp(this.yaw, this.targetYaw, 1 - Math.exp(-14 * dt));
  }

  syncVisual(dt) {
    if (!this.character) return;
    this.character.root.position.copy(this.pos);
    this.character.root.rotation.y = this.yaw;
    this.character.update(dt, {
      speed: this.speed, crouch: this.crouch, pitch: this.pitch,
      firing: this.firing,
    }, this.game.camera);
    this.character.setVisible(!this.isLocal);
  }

  damage(amount, source, part) {
    if (this.dead) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= amount;
    if (this.character) this.character.setHp(Math.max(0, this.hp));
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deaths++;
      this.streak = 0;
      if (this.character) this.character.setDead(true);
      this.game.onDeath(this, source, part);
    }
    return dealt;
  }

  respawn(pos, yaw) {
    this.pos.copy(pos); this.targetPos.copy(pos); this.prevPos.copy(pos);
    this.yaw = this.targetYaw = yaw;
    this.pitch = 0; this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.dead = false;
    this.speed = 0;
    this.crouch = false;
    if (this.character) { this.character.setDead(false); this.character.setHp(100); }
    this.snapNext = true;
  }

  dispose() {
    if (this.character) { this.character.dispose(); this.character = null; }
  }
}
