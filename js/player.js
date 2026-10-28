import * as THREE from 'three';
import { Fighter } from './fighter.js';
import { WEAPONS, WEAPON_LIST } from './weapons.js';
import { clamp, damp, angleLerp } from './util.js';

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
const _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3(), _zero = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const GRAVITY = 22;

const rndSpread = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.4;

export class LocalPlayer extends Fighter {
  constructor(game, opts) {
    super(game, { ...opts, isLocal: true });
    this.ammo = {};
    for (const id of WEAPON_LIST) this.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    this.reloading = false;
    this.reloadEnd = 0;
    this.switching = false;
    this.switchEnd = 0;
    this.nextFire = 0;
    this.nextGrenade = 0;
    this.grenades = 2;
    this.ads = false;
    this.grounded = true;
    this.recoilPitch = 0; this.recoilYaw = 0;
    this.bobPhase = 0; this.bobAmount = 0;
    this.landKick = 0;
    this.stepTimer = 0;
    this.damageFlash = 0;
    this.lastDamageFrom = null;
    this.hitFlash = 0;
    this.killFlash = 0;
    this.shotsFired = 0;
    this.hitsLanded = 0;
    this.respawnTimer = 0;
    this.viewKick = 0;
    this.sprintBlock = 0;
    this.camShakeX = 0;
  }

  respawn(pos, yaw) {
    super.respawn(pos, yaw);
    for (const id of WEAPON_LIST) this.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    this.reloading = false; this.switching = false;
    this.grenades = 2;
    this.ads = false;
    this.recoilPitch = this.recoilYaw = 0;
    this.respawnTimer = 0;
    this.damageFlash = 0;
    this.game.viewModel.setWeapon(this.weapon);
  }

  switchWeapon(id) {
    if (!WEAPONS[id] || this.dead || this.reloading || this.switching || id === this.weapon) return;
    this.weapon = id;
    this.switching = true;
    this.switchEnd = performance.now() / 1000 + WEAPONS[id].switchTime;
    this.game.viewModel.setWeapon(id);
    this.game.audio.play('ui');
    this.game.ui.setWeapon(WEAPONS[id]);
  }

  cycleWeapon(dir) {
    const i = WEAPON_LIST.indexOf(this.weapon);
    this.switchWeapon(WEAPON_LIST[(i + dir + WEAPON_LIST.length) % WEAPON_LIST.length]);
  }

  reload() {
    const w = WEAPONS[this.weapon], a = this.ammo[this.weapon];
    if (this.reloading || this.switching || this.dead || a.mag >= w.mag || a.reserve <= 0) return;
    this.reloading = true;
    this.reloadEnd = performance.now() / 1000 + w.reload;
    this.ads = false;
    this.game.viewModel.reloadStart(w.reload);
    this.game.audio.play('reload');
    this.game.ui.reloadStart(w.reload);
  }

  get canShoot() {
    const now = performance.now() / 1000;
    return !this.dead && !this.reloading && !this.switching && now >= this.nextFire && this.game.running;
  }

  fire() {
    const w = WEAPONS[this.weapon], a = this.ammo[this.weapon];
    if (a.mag <= 0) {
      this.game.audio.play('dry');
      this.nextFire = performance.now() / 1000 + 0.28;
      this.reload();
      return;
    }
    a.mag--;
    this.shotsFired++;
    this.nextFire = performance.now() / 1000 + 60 / w.rpm;
    this.sprintBlock = 0.35;

    const cam = this.game.camera;
    cam.getWorldDirection(_dir);
    _right.crossVectors(_dir, WORLD_UP).normalize();
    _up.crossVectors(_right, _dir).normalize();
    let spread = (this.ads ? w.spreadAds : w.spreadHip);
    spread *= 1 + this.speed * (this.ads ? 0.035 : 0.075) + (!this.grounded ? 1.1 : 0) - (this.crouch ? 0.2 : 0);
    spread = Math.max(0.0008, spread);
    const dir = _dir.clone()
      .addScaledVector(_right, rndSpread() * spread)
      .addScaledVector(_up, rndSpread() * spread)
      .normalize();

    // Namlu noktası: viewspace -> dünya
    this.game.viewModel.muzzleWorld(_tmp);
    const muzzle = _tmp.clone().applyMatrix4(cam.matrixWorld);
    this.game.viewModel.ejectWorld(_tmp2);
    const eject = _tmp2.clone().applyMatrix4(cam.matrixWorld);

    this.game.hitscan(this, muzzle, dir, w);
    this.game.effects.muzzleFlash(muzzle, dir, this.weapon === 'dmr' ? 1.4 : 1);
    this.game.effects.casing(eject, dir);
    this.game.effects.shake = Math.min(0.5, this.game.effects.shake + (this.weapon === 'dmr' ? 0.11 : 0.045));
    this.game.audio.play(w.sound, { volume: 0.85 });
    this.game.viewModel.fire();
    this.recoilPitch += w.recoilV * (this.ads ? 0.85 : 1.15);
    this.recoilYaw += (Math.random() - 0.5) * w.recoilH * 2;
    this.viewKick = 1;
    this.firing = true;
    this.game.ui.updateAmmo(a.mag, a.reserve);
  }

  throwGrenade() {
    const now = performance.now() / 1000;
    if (this.dead || this.grenades <= 0 || now < this.nextGrenade) return;
    this.grenades--; this.nextGrenade = now + 0.9;
    const cam = this.game.camera;
    cam.getWorldDirection(_dir);
    const origin = cam.position.clone().addScaledVector(_dir, 0.6).add(new THREE.Vector3(0.15, -0.1, 0));
    const vel = _dir.clone().multiplyScalar(19).add(new THREE.Vector3(0, 5.5, 0)).addScaledVector(this.vel, 0.35);
    this.game.throwGrenade(origin, vel, this);
    this.game.audio.play('grenade');
    this.game.ui.updateGrenades(this.grenades);
  }

  takeDamage(amount, source, part) {
    if (this.dead) return;
    super.damage(amount, source, part);
    this.damageFlash = Math.min(1, this.damageFlash + amount / 60);
    this.lastDamageFrom = source;
    this.hitFlash = 0;
    this.game.effects.shake = Math.min(0.7, this.game.effects.shake + amount / 220);
    this.game.audio.play('hurt', { volume: 0.7 });
    this.game.ui.damageFrom(source ? (source.pos || this.pos) : this.pos, this.pos, this.yaw);
    this.game.ui.damageFlash(amount);
    this.game.ui.updateHealth(this.hp);
    if (this.dead) this.respawnTimer = 3.2;
  }

  getState() {
    return {
      t: 's', id: this.id,
      p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
      r: +this.yaw.toFixed(3), pr: +this.pitch.toFixed(3),
      v: [+this.vel.x.toFixed(2), +this.vel.y.toFixed(2), +this.vel.z.toFixed(2)],
      w: this.weapon, hp: Math.round(this.hp), k: this.kills, d: this.deaths,
      c: this.crouch ? 1 : 0, sp: this.sprinting ? 1 : 0,
      f: this.firing ? 1 : 0, dead: this.dead ? 1 : 0,
    };
  }

  update(dt) {
    const g = this.game, input = g.input, world = g.world;
    const now = performance.now() / 1000;

    if (this.dead) {
      this.respawnTimer -= dt;
      g.ui.updateRespawn(Math.max(0, this.respawnTimer));
      if (this.respawnTimer <= 0 && g.running) g.respawnLocal();
      this._updateCamera(dt, true);
      return;
    }

    // ---------- Bakış ----------
    const [ldx, ldy] = input.consumeLook();
    if (input.locked || input.touch.active) {
      this.yaw -= ldx;
      this.pitch = clamp(this.pitch - ldy, -1.48, 1.48);
    }
    this.recoilPitch = damp(this.recoilPitch, 0, 7.5, dt);
    this.recoilYaw = damp(this.recoilYaw, 0, 8, dt);
    this.viewKick = Math.max(0, this.viewKick - dt * 6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.1);
    this.sprintBlock = Math.max(0, this.sprintBlock - dt);

    // ---------- Hareket ----------
    const k = input.keys;
    let fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    fwd += -input.touch.moveY; strafe += input.touch.moveX;
    fwd = clamp(fwd, -1, 1); strafe = clamp(strafe, -1, 1);
    const wish = new THREE.Vector3(strafe, 0, -fwd);
    if (wish.lengthSq() > 1) wish.normalize();
    wish.applyAxisAngle(WORLD_UP, this.yaw);

    this.ads = (input.mouse.right || input.touch.aim) && !this.switching && !this.reloading;
    const w = WEAPONS[this.weapon];
    const wantSprint = (k.has('ShiftLeft') || k.has('ShiftRight') || input.touch.moveY < -0.8) && fwd > 0.2 && !this.ads && !this.crouch && this.sprintBlock <= 0;
    this.sprinting = wantSprint;
    this.crouch = k.has('ControlLeft') || k.has('KeyC') || (!this.grounded && false);
    const maxSpeed = this.crouch ? 2.7 : this.ads ? 3.3 : this.sprinting ? 8.0 : 5.4;
    const accel = this.grounded ? 44 : 11;
    const targetVX = wish.x * maxSpeed, targetVZ = wish.z * maxSpeed;
    this.vel.x = damp(this.vel.x, targetVX, accel / 6, dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel / 6, dt);
    if (wish.lengthSq() < 0.01 && this.grounded) {
      const f = Math.exp(-11 * dt);
      this.vel.x *= f; this.vel.z *= f;
    }

    // Zıplama
    if ((k.has('Space') || input.touch.jump) && this.grounded && !this.crouch) {
      this.vel.y = 7.2; this.grounded = false;
      g.audio.play('jump');
    }
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;

    // Yatay çarpışma
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const r = 0.37, height = this.crouch ? 1.24 : 1.78;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of world.colliders) {
        if (c.max.y <= this.pos.y + 0.12 || c.min.y >= this.pos.y + height) continue;
        const cx = clamp(this.pos.x, c.min.x, c.max.x);
        const cz = clamp(this.pos.z, c.min.z, c.max.z);
        let dx = this.pos.x - cx, dz = this.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        // Alçak engellere basamak çıkma
        if (c.max.y - this.pos.y <= 0.62 && this.vel.y <= 0.5 && c.type !== 'building') {
          this.pos.y = c.max.y; this.vel.y = Math.max(0, this.vel.y); this.grounded = true;
          continue;
        }
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), push = r - d;
          this.pos.x += (dx / d) * push; this.pos.z += (dz / d) * push;
          const vn = this.vel.x * (dx / d) + this.vel.z * (dz / d);
          if (vn < 0) { this.vel.x -= vn * (dx / d); this.vel.z -= vn * (dz / d); }
        } else {
          // Merkez kutunun içinde: en yakın yüze it
          const px = Math.min(this.pos.x - c.min.x, c.max.x - this.pos.x);
          const pz = Math.min(this.pos.z - c.min.z, c.max.z - this.pos.z);
          if (px < pz) this.pos.x = this.pos.x < (c.min.x + c.max.x) / 2 ? c.min.x - r : c.max.x + r;
          else this.pos.z = this.pos.z < (c.min.z + c.max.z) / 2 ? c.min.z - r : c.max.z + r;
        }
      }
    }
    this.pos.x = clamp(this.pos.x, -world.half + 1.5, world.half - 1.5);
    this.pos.z = clamp(this.pos.z, -world.half + 1.5, world.half - 1.5);

    // Zemin / platform
    const floor = world.floorAt(this.pos.x, this.pos.z, this.pos.y, r, 0.62);
    if (this.pos.y <= floor + 0.001 && this.vel.y <= 0) {
      if (!this.grounded && this.vel.y < -6) {
        g.audio.play('land', { volume: clamp(-this.vel.y / 12, 0.2, 1) });
        this.landKick = Math.min(0.16, -this.vel.y * 0.014);
      }
      this.pos.y = floor; this.vel.y = 0; this.grounded = true;
    } else this.grounded = false;

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.targetPos.copy(this.pos);

    // Adım sesleri
    if (this.grounded && this.speed > 1.3) {
      this.stepTimer -= dt * (this.sprinting ? 2.5 : 1.9) * (this.speed / 5);
      if (this.stepTimer <= 0) {
        this.stepTimer = 1;
        g.audio.play('step', { volume: this.sprinting ? 0.9 : 0.6 });
      }
    }

    // ---------- Silah ----------
    if (this.reloading && now >= this.reloadEnd) {
      this.reloading = false;
      const a = this.ammo[this.weapon];
      const need = WEAPONS[this.weapon].mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      g.ui.updateAmmo(a.mag, a.reserve);
    }
    if (this.switching && now >= this.switchEnd) this.switching = false;
    const wantFire = ((input.mouse.left || input.touch.fire) && input.locked) || input.touch.fire;
    if (wantFire && this.canShoot && (w.auto || !this.lastTrigger)) this.fire();
    this.lastTrigger = wantFire;
    if (!wantFire) this.firing = false;

    if (input.touch.reload) { this.reload(); input.touch.reload = false; }
    if (input.scroll !== 0) { this.cycleWeapon(input.scroll > 0 ? 1 : -1); input.scroll = 0; }

    g.viewModel.update(dt, {
      ads: this.ads, moveSpeed: this.speed, sprinting: this.sprinting,
      crouch: this.crouch, lookDX: input.lookRawX || 0, lookDY: input.lookRawY || 0,
    });

    this._updateCamera(dt, false);
  }

  _updateCamera(dt, dead) {
    const g = this.game, cam = g.camera;
    const moving = clamp(this.speed / 5.4, 0, 1) * (this.grounded ? 1 : 0.2) * (1 - (this.ads ? 0.7 : 0));
    this.bobPhase += dt * (this.sprinting ? 13.5 : 9.5) * clamp(this.speed / 4, 0, 1.4);
    this.bobAmount = damp(this.bobAmount, moving, 8, dt);
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * 0.028 * this.bobAmount;
    this.landKick = damp(this.landKick, 0, 9, dt);
    const shake = g.effects.shake;
    const sx = (Math.random() - 0.5) * shake * 0.05;
    const sy = (Math.random() - 0.5) * shake * 0.05;

    const eye = this.eyeHeight() + bobY - this.landKick + (dead ? -0.9 : 0);
    cam.position.set(this.pos.x + bobX, this.pos.y + eye, this.pos.z);
    cam.rotation.order = 'YXZ';
    const strafeRoll = -clamp(this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw), -8, 8) * 0.0035;
    cam.rotation.set(
      clamp(this.pitch + this.recoilPitch + sy, -1.5, 1.5) + (dead ? -0.2 : 0),
      this.yaw + this.recoilYaw + sx,
      strafeRoll + Math.cos(this.bobPhase) * 0.006 * this.bobAmount + (dead ? 0.45 : 0),
    );
    const targetFov = g.baseFov / (this.ads ? WEAPONS[this.weapon].zoom : 1);
    cam.fov = damp(cam.fov, targetFov, 12, dt);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
}
