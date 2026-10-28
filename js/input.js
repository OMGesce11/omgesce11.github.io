import { clamp } from './util.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.lookDX = 0; this.lookDY = 0;
    this.scroll = 0;
    this.locked = false;
    this.sensitivity = 0.0022;
    this.enabled = false;
    this.touch = { active: false, moveX: 0, moveY: 0, lookX: 0, lookY: 0, fire: false, aim: false, jump: false, reload: false };
    this.onKey = null;
    this.onLockChange = null;
    this._bind();
  }
  _bind() {
    const kd = (e) => {
      if (!this.enabled) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const c = e.code;
      if (!this.keys.has(c) && this.onKey) this.onKey(c, e);
      this.keys.add(c);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(c)) e.preventDefault();
    };
    const ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('wheel', (e) => { if (this.enabled && this.locked) this.scroll += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    this._touchBind();
  }
  _touchBind() {
    const map = {
      't-move': 'move', 't-look': 'look', 't-fire': 'fire', 't-aim': 'aim',
      't-jump': 'jump', 't-reload': 'reload',
    };
    for (const [id, kind] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (!el) continue;
      let sid = null, sx = 0, sy = 0, cx = 0, cy = 0;
      const start = (e) => {
        const t = e.changedTouches ? e.changedTouches[0] : e;
        sid = t.identifier ?? 'm'; sx = cx = t.clientX; sy = cy = t.clientY;
        if (kind === 'fire') this.touch.fire = true;
        if (kind === 'aim') this.touch.aim = true;
        if (kind === 'jump') { this.touch.jump = true; setTimeout(() => this.touch.jump = false, 120); }
        if (kind === 'reload') { this.touch.reload = true; setTimeout(() => this.touch.reload = false, 120); }
        this.touch.active = true;
        e.preventDefault();
      };
      const move = (e) => {
        if (sid === null) return;
        let t = null;
        if (e.changedTouches) for (const x of e.changedTouches) if (x.identifier === sid) t = x;
        else t = e;
        if (!t) return;
        cx = t.clientX; cy = t.clientY;
        if (kind === 'move') {
          this.touch.moveX = clamp((cx - sx) / 55, -1, 1);
          this.touch.moveY = clamp((cy - sy) / 55, -1, 1);
        } else if (kind === 'look') {
          this.lookDX += (cx - sx) * 1.4; this.lookDY += (cy - sy) * 1.4;
          sx = cx; sy = cy;
        }
        e.preventDefault();
      };
      const end = (e) => {
        sid = null;
        if (kind === 'move') { this.touch.moveX = this.touch.moveY = 0; }
        if (kind === 'fire') this.touch.fire = false;
        if (kind === 'aim') this.touch.aim = false;
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchmove', move, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      el.addEventListener('mousedown', start);
      window.addEventListener('mousemove', (e) => { if (sid !== null) move(e); });
      window.addEventListener('mouseup', end);
    }
  }
  lock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  /** Her karede bir kez çağrılır; biriken fare hareketini döndürür */
  consumeLook() {
    const dx = this.lookDX * this.sensitivity, dy = this.lookDY * this.sensitivity;
    this.lookRawX = this.lookDX; this.lookRawY = this.lookDY;
    this.lookDX = 0; this.lookDY = 0;
    return [dx, dy];
  }
  down(code) { return this.keys.has(code); }
  reset() { this.keys.clear(); this.mouse.left = this.mouse.right = false; this.lookDX = this.lookDY = 0; }
}
