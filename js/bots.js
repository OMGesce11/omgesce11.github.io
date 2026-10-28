import * as THREE from 'three';
import { Fighter } from './fighter.js';
import { WEAPONS } from './weapons.js';
import { clamp, damp, angleDelta, mulberry32 } from './util.js';

const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _t = new THREE.Vector3();
const NAMES = [
  'ŞAHİN', 'BOZKURT', 'KAPLAN', 'AYI', 'KURT', 'DOĞAN', 'ALP', 'CENGİZ', 'YILMAZ', 'ATMACA',
  'DEMİR', 'POLAT', 'KARTAL', 'ASLAN', 'BORA', 'OZAN', 'SERHAT', 'TİMUR', 'EFE', 'MERT',
];
const rnd = mulberry32(99173);

export class Bot extends Fighter {
  constructor(game, opts) {
    super(game, { ...opts, isBot: true });
    this.weapon = ['ar', 'smg', 'dmr'][Math.floor(rnd() * 3)];
    this.think = 0;
    this.fireTimer = 0.4 + rnd() * 0.8;
    this.burst = 0;
    this.strafe = rnd() > 0.5 ? 1 : -1;
    this.strafeTimer = 1 + rnd() * 2;
    this.goal = new THREE.Vector3();
    this.pickGoal(true);
    this.aimError = new THREE.Vector2();
    this.accuracy = 0.52 + game.botDifficulty * 0.32;
    this.reaction = 0.42 - game.botDifficulty * 0.24;
    this.pain = 0;
    this.deadTimer = 0;
  }

  static name() { return NAMES[Math.floor(rnd() * NAMES.length)] + '-' + (10 + Math.floor(rnd() * 89)); }

  pickGoal(far = false) {
    const h = this.game.world.half - 8;
    let x, z, tries = 0;
    do {
      x = (rnd() * 2 - 1) * h; z = (rnd() * 2 - 1) * h; tries++;
    } while (tries < 12 && this.game.world.raycast(new THREE.Vector3(x, 1.5, z), new THREE.Vector3(0, -1, 0), 3)?.type === 'building');
    this.goal.set(x, 0, z);
  }

  findTarget() {
    let best = null, bd = Infinity;
    for (const f of [this.game.player, ...this.game.fighters.values()]) {
      if (f === this || f.dead || f.team === this.team) continue;
      const d = this.pos.distanceTo(f.pos);
      if (d > 75) continue;
      _o.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
      _d.subVectors(f.pos, this.pos).normalize();
      const hit = this.game.world.raycast(_o, _d, d - 0.5);
      if (hit && hit.t < d - 0.8) continue;
      if (d < bd) { bd = d; best = f; }
    }
    return { target: best, dist: bd };
  }

  update(dt) {
    const g = this.game;
    if (this.dead) {
      this.deadTimer -= dt;
      this.syncVisual(dt);
      if (this.deadTimer <= 0 && g.running) g.respawnBot(this);
      return;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.28 + rnd() * 0.3;
      const { target, dist } = this.findTarget();
      this.target = target;
      this.targetDist = dist;
      if (!target && (this.pos.distanceTo(this.goal) < 4 || rnd() < 0.25)) this.pickGoal();
      this.aimError.set((rnd() - 0.5) * 0.13, (rnd() - 0.5) * 0.1);
    }
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafe *= -1; this.strafeTimer = 1.2 + rnd() * 2.4; }

    const t = this.target;
    let wishX = 0, wishZ = 0;
    if (t && !t.dead) {
      _d.subVectors(t.pos, this.pos); _d.y = 0;
      const dist = _d.length() || 1;
      _d.divideScalar(dist);
      const ideal = this.weapon === 'dmr' ? 26 : 13;
      const approach = dist > ideal + 4 ? 1 : dist < ideal - 5 ? -0.8 : 0.1;
      wishX = _d.x * approach + -_d.z * this.strafe * 0.75;
      wishZ = _d.z * approach + _d.x * this.strafe * 0.75;
      this.yaw = Math.atan2(-_d.x, -_d.z) + this.aimError.x;
      this.pitch = clamp(this.aimError.y + (t.pos.y - this.pos.y) * 0.02, -0.5, 0.5);
      this.crouch = dist > 20 && rnd() < 0.006;
    } else {
      _d.subVectors(this.goal, this.pos); _d.y = 0;
      if (_d.length() < 2) this.pickGoal();
      _d.normalize();
      wishX = _d.x; wishZ = _d.z;
      this.yaw = Math.atan2(-_d.x, -_d.z);
      this.pitch = 0;
      this.crouch = false;
    }
    // Engelden kaçınma
    _o.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    _t.set(wishX, 0, wishZ).normalize();
    const ahead = g.world.raycast(_o, _t, 2.3);
    if (ahead && ahead.type !== 'ground') {
      const side = new THREE.Vector3(-_t.z, 0, _t.x).multiplyScalar(this.strafe);
      wishX += side.x * 1.6; wishZ += side.z * 1.6;
    }
    const len = Math.hypot(wishX, wishZ) || 1;
    const spd = 4.4 + g.botDifficulty * 1.6;
    const vx = (wishX / len) * spd, vz = (wishZ / len) * spd;
    this.vel.x = damp(this.vel.x, vx, 8, dt);
    this.vel.z = damp(this.vel.z, vz, 8, dt);
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // Basit duvar kaydırma
    const blockedX = g.world.colliders.some((c) => c.max.y > 0.8 && c.min.y < 1.7 && nx + 0.4 > c.min.x && nx - 0.4 < c.max.x && nz + 0.4 > c.min.z && nz - 0.4 < c.max.z);
    if (!blockedX) this.pos.x = nx; else { this.vel.x *= -0.3; this.strafe *= -1; }
    const blockedZ = g.world.colliders.some((c) => c.max.y > 0.8 && c.min.y < 1.7 && this.pos.x + 0.4 > c.min.x && this.pos.x - 0.4 < c.max.x && nz + 0.4 > c.min.z && nz - 0.4 < c.max.z);
    if (!blockedZ) this.pos.z = nz; else this.vel.z *= -0.3;
    this.pos.x = clamp(this.pos.x, -g.world.half + 2, g.world.half - 2);
    this.pos.z = clamp(this.pos.z, -g.world.half + 2, g.world.half - 2);
    this.pos.y = g.world.floorAt(this.pos.x, this.pos.z, this.pos.y, 0.4, 0.62);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // Ateş
    this.fireTimer -= dt;
    const w = WEAPONS[this.weapon];
    this.firing = false;
    if (t && !t.dead && this.targetDist < 70 && this.fireTimer <= 0 && this.reaction <= 0) {
      this.reaction = 0;
      _o.set(this.pos.x, this.pos.y + 1.45, this.pos.z);
      _d.subVectors(t.pos, _o).normalize();
      const los = g.world.raycast(_o, _d, this.targetDist + 2);
      if (!los || los.t >= this.targetDist - 0.4) {
        const hitChance = clamp(this.accuracy * (1 - this.targetDist / 110) * (t.sprinting ? 0.8 : 1), 0.08, 0.92);
        const hit = rnd() < hitChance;
        const head = hit && rnd() < 0.09 + g.botDifficulty * 0.08;
        const spread = hit ? 0.006 : 0.055;
        const dir = _d.clone().add(new THREE.Vector3((rnd() - 0.5) * spread, (rnd() - 0.5) * spread, (rnd() - 0.5) * spread)).normalize();
        const muzzle = this.character ? this.character.gunMuzzle.clone() : _o.clone();
        if (muzzle.lengthSq() < 0.001) muzzle.copy(_o);
        const end = muzzle.clone().addScaledVector(dir, hit ? this.targetDist : 45 + rnd() * 20);
        const wh = g.world.raycast(muzzle, dir, 120);
        if (wh && wh.t < muzzle.distanceTo(end)) end.copy(wh.point);
        g.effects.tracer(muzzle, end, 0xff9d5a, 0.9);
        g.effects.muzzleFlash(muzzle, dir, 0.85, 0xffbe74);
        g.audio.play(w.sound, { dist: this.pos.distanceTo(g.player.pos), volume: 0.7 });
        if (hit) {
          const dmg = w.damage * (head ? w.headMult : 1) * (0.6 + g.botDifficulty * 0.4) * (rnd() * 0.3 + 0.85);
          g.hitFighter(t, dmg, this, head ? 'head' : 'body', end);
        } else if (muzzle.distanceTo(g.player.pos) < 12) {
          g.audio.play('whiz', { volume: 0.5 });
        }
        this.firing = true;
        this.fireTimer = 60 / w.rpm * (w.auto ? (2 + Math.floor(rnd() * 4)) : 1) + (w.auto ? 0.25 + rnd() * 0.5 : 0.5 + rnd() * 0.6);
      } else {
        this.fireTimer = 0.35;
      }
    }
    this.reaction -= dt;
    this.syncVisual(dt);
  }

  damage(amount, source, part) {
    if (this.dead) return 0;
    const dealt = super.damage(amount, source, part);
    this.pain = 1;
    if (source) {
      this.target = source;
      this.think = 0.1;
    }
    if (this.dead) this.deadTimer = 3.0;
    return dealt;
  }
}
