import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createTextures } from './textures.js';
import { createWorld } from './world.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { loadCharacterAssets, Character } from './soldier.js';
import { ViewModel } from './weapons.js';
import { WEAPONS } from './weapons.js';
import { Fighter } from './fighter.js';
import { LocalPlayer } from './player.js';
import { Bot } from './bots.js';
import { Network } from './net.js';
import { Input } from './input.js';
import { clamp, damp, uid, formatTime } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Game {
  constructor(canvas, ui, settings) {
    this.canvas = canvas;
    this.ui = ui;
    this.settings = settings;
    this.state = 'boot';       // boot | attract | playing | paused | ended
    this.running = false;
    this.quality = settings.quality || 'high';
    this.baseFov = settings.fov || 78;
    this.botDifficulty = 0.5;
    this.shakeEnabled = true;
    this.fighters = new Map();
    this.player = null;
    this.net = null;
    this.grenades = [];
    this.deathsSeen = new Set();
    this.match = { blue: 0, red: 0, limit: 50, duration: 480, time: 0, elapsed: 0 };
    this.stateAcc = 0;
    this.miniAcc = 0;
    this.attractT = 0;
    this.lastFrame = performance.now();
    this.demoChars = [];
    this.assets = null;
    this.T = null;
    this.frameHandle = 0;
    this.localTeam = 'blue';
  }

  // ------------------------------------------------------------------
  //  KURULUM
  // ------------------------------------------------------------------
  async init(progress) {
    progress(0.05, 'WebGL motoru başlatılıyor…');
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: this.quality === 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer = r;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'ultra' ? 2 : this.quality === 'high' ? 1.6 : 1));
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.shadowMap.enabled = this.quality !== 'low';
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.baseFov, window.innerWidth / window.innerHeight, 0.06, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    await wait(16);

    progress(0.22, 'Dokular ve materyaller üretiliyor…');
    this.T = createTextures();
    await wait(16);

    progress(0.42, 'Savaş alanı inşa ediliyor…');
    this.world = createWorld(this.scene, this.T, this.quality);
    this._makeEnvironment();
    await wait(16);

    progress(0.6, 'Işık ve post-processing hazırlanıyor…');
    this._makePost();
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.01, 12);
    this.viewScene.add(new THREE.HemisphereLight(0xdfe9f5, 0x36302a, 2.0));
    const vl = new THREE.DirectionalLight(0xffd9a8, 3.0); vl.position.set(2, 3, 4); this.viewScene.add(vl);
    const vl2 = new THREE.DirectionalLight(0x88a9d0, 1.1); vl2.position.set(-3, 1, -2); this.viewScene.add(vl2);
    this.viewScene.environment = this.scene.environment;
    this.effects = new Effects(this.scene, this.T, this.camera);
    this.audio = new AudioEngine();
    this.audio.setVolume(this.settings.volume ?? 0.6);
    this.viewModel = new ViewModel(this.viewScene, this.T);
    this.viewModel.setWeapon('ar');
    this.input = new Input(this.canvas);
    this.input.sensitivity = 0.0022 * (this.settings.sensitivity ?? 1);
    this.input.onKey = (code) => this._onKey(code);
    this.input.onLockChange = (locked) => this._onLockChange(locked);
    await wait(16);

    progress(0.78, '3B asker modelleri yükleniyor…');
    try {
      this.assets = await loadCharacterAssets();
    } catch (e) {
      console.error('Karakter modeli yüklenemedi', e);
      this.assets = { scene: new THREE.Group(), animations: [] };
    }
    progress(0.92, 'Son rötuşlar…');
    this._makeDemoCharacters();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.state = 'attract';
    progress(1, 'Hazır!');
    this.loop();
  }

  _makeEnvironment() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#28456e'); g.addColorStop(0.36, '#7f9fbe');
    g.addColorStop(0.49, '#f0c891'); g.addColorStop(0.55, '#c99a68');
    g.addColorStop(0.75, '#6b563c'); g.addColorStop(1, '#392e22');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    // güneş lekesi
    const sx = 300, sy = 118;
    const sg = ctx.createRadialGradient(sx, sy, 2, sx, sy, 90);
    sg.addColorStop(0, 'rgba(255,250,225,1)'); sg.addColorStop(0.12, 'rgba(255,222,160,.9)');
    sg.addColorStop(0.4, 'rgba(255,180,100,.28)'); sg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 100, sy - 100, 200, 200);
    // bulut şeritleri
    ctx.globalAlpha = 0.14; ctx.fillStyle = '#fff';
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 512, y = 60 + Math.random() * 55;
      ctx.beginPath(); ctx.ellipse(x, y, 18 + Math.random() * 60, 2 + Math.random() * 6, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(this.renderer);
    pm.compileEquirectangularShader();
    this.envMap = pm.fromEquirectangular(tex).texture;
    this.scene.environment = this.envMap;
    pm.dispose(); tex.dispose();
  }

  _makePost() {
    if (this.quality === 'low') { this.composer = null; return; }
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.floor(w * pr), Math.floor(h * pr), {
      type: THREE.HalfFloatType,
      samples: this.quality === 'ultra' ? 4 : 2,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.24, 0.5, 1.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q) {
    this.quality = q;
    if (!this.renderer) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'ultra' ? 2 : q === 'high' ? 1.6 : 1));
    this.renderer.shadowMap.enabled = q !== 'low';
    if (this.world?.sun) { this.world.sun.castShadow = q !== 'low'; this.world.sun.shadow.mapSize.set(q === 'ultra' ? 2048 : 1024, q === 'ultra' ? 2048 : 1024); }
    if (this.bloom) this.bloom.enabled = q !== 'low';
    if (this.composer) this.composer.renderTarget1.samples = q === 'ultra' ? 4 : 2;
    this.resize();
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = w / h; this.viewCamera.updateProjectionMatrix();
    this.composer?.setSize(w, h);
  }

  _makeDemoCharacters() {
    const paths = [
      { cx: -6, cz: 6, rx: 12, rz: 8, sp: 0.22, ph: 0, team: 'blue' },
      { cx: 8, cz: -6, rx: 14, rz: 9, sp: -0.17, ph: 1.6, team: 'red' },
      { cx: -18, cz: -14, rx: 9, rz: 12, sp: 0.26, ph: 3.1, team: 'red' },
      { cx: 20, cz: 16, rx: 11, rz: 10, sp: -0.2, ph: 4.4, team: 'blue' },
    ];
    for (const p of paths) {
      try {
        const c = new Character(this.assets, { team: p.team, name: 'ASKER', T: this.T, weapon: 'ar' });
        c.root.scale.setScalar(1.05);
        this.scene.add(c.root);
        this.demoChars.push({ c, p });
      } catch (e) { console.warn('demo karakter', e); }
    }
  }

  // ------------------------------------------------------------------
  //  OYUN BAŞLAT / BİTİR
  // ------------------------------------------------------------------
  async start(opts) {
    this.options = opts;
    this.mode = opts.mode || 'online';
    this.botDifficulty = (opts.botDifficulty ?? 1) / 2;
    this.localTeam = opts.team === 'auto' ? (Math.random() < 0.5 ? 'blue' : 'red') : (opts.team || 'blue');
    this.baseFov = opts.fov || 78;
    this.camera.fov = this.baseFov; this.camera.updateProjectionMatrix();
    this.input.sensitivity = 0.0022 * (opts.sensitivity ?? 1);
    this.audio.setVolume(opts.volume ?? 0.6);
    this.audio.init();
    this.shakeEnabled = opts.shake !== false;
    this.setQuality(opts.quality || 'high');

    // Temizlik
    for (const f of this.fighters.values()) f.dispose();
    this.fighters.clear();
    for (const g of this.grenades) g.mesh.parent?.remove(g.mesh);
    this.grenades = [];
    this.deathsSeen.clear();
    this.demoChars.forEach((d) => d.c.root.visible = false);
    this.match = { blue: 0, red: 0, limit: 50, duration: 480, time: 480, elapsed: 0 };
    this.running = true;
    this.state = 'playing';

    // Yerel oyuncu
    this.id = 'p_' + uid(10);
    this.player = new LocalPlayer(this, { id: this.id, name: opts.name || 'ASKER', team: this.localTeam, weapon: 'ar' });
    const sp = this.pickSpawn(this.localTeam);
    this.player.respawn(sp.pos, sp.yaw);
    this.player.spawnPoint = sp;
    this.viewModel.setWeapon('ar');
    this.ui.setIdentity(this.player.name, this.localTeam, 'ar');
    this.ui.updateHealth(100);
    this.ui.updateAmmo(WEAPONS.ar.mag, WEAPONS.ar.reserve);
    this.ui.updateGrenades(2);
    this.ui.updateScores(0, 0, 480, 50);
    this.ui.showRespawn(false);
    this.ui.showHud(true);
    this.ui.hideScreens();
    this.ui.setScope(false);
    this.ui.chat('', 'Savaş alanına hoş geldin! İyi şanslar, ' + this.player.name + '.', '', true);

    // Ağ
    if (this.net) this.net.close();
    this.net = new Network({
      room: opts.room || 'GENEL',
      name: this.player.name,
      team: this.localTeam,
      relayUrl: opts.relayUrl || null,
      preferLocal: opts.mode !== 'solo',
      onMessage: (m) => this.onNetMessage(m),
      onPeers: (p) => this.onPeers(p),
      onStatus: (text, mode) => this.onNetStatus(text, mode),
      onIdChange: (id) => { this.id = id; if (this.player) this.player.id = id; },
    });
    this.id = this.net.id;
    this.player.id = this.id;
    if (opts.mode === 'solo') {
      this.net.mode = 'offline';
      this.onNetStatus('BOTLARA KARŞI — ÇEVRİMDIŞI', 'offline');
      this.fillBots(opts.botCount ?? 8);
    } else {
      this.net.connect().then(({ mode }) => {
        if (mode === 'offline') {
          this.ui.chat('', 'Ağa ulaşılamadı — botlarla devam ediliyor.', '', true);
          this.fillBots(6);
        }
      });
    }
    this.input.enabled = true;
    this.input.reset();
    this.input.lock();
    this.audio.play('start');
    this.ui.setNetStatus('BAĞLANIYOR…', '', 0, 1 + this.fighters.size);
    this.net.send(this.player.getState());
    clearTimeout(this.emptyHint);
    this.emptyHint = setTimeout(() => {
      if (this.running && this.net?.mode !== 'offline' && this.mode !== 'solo' &&
          ![...this.fighters.values()].some((f) => !f.isBot)) {
        this.ui.chat('', 'Oda şu an boş. Ayarlar → Özel Oda ile oda kodu oluşturup arkadaşlarına gönder!', '', true);
      }
    }, 7000);
  }

  fillBots(count) {
    const have = [...this.fighters.values()].filter((f) => f.isBot);
    if (have.length >= count) {
      for (let i = count; i < have.length; i++) { this.fighters.delete(have[i].id); have[i].dispose(); }
      return;
    }
    for (let i = have.length; i < count; i++) {
      const team = i % 3 === 0 ? this.localTeam : (this.localTeam === 'blue' ? 'red' : 'blue');
      const b = new Bot(this, { id: 'bot_' + uid(6), name: Bot.name(), team });
      const sp = this.pickSpawn(team);
      b.respawn(sp.pos, sp.yaw);
      b.weapon = ['ar', 'smg', 'dmr'][i % 3];
      try {
        b.character = new Character(this.assets, { team, name: b.name, T: this.T, weapon: b.weapon });
        this.scene.add(b.character.root);
      } catch (e) { console.warn(e); }
      b.syncVisual(0.016);
      this.fighters.set(b.id, b);
    }
    this.recomputeScores();
  }

  removeBots() {
    for (const [id, f] of this.fighters) if (f.isBot) { f.dispose(); this.fighters.delete(id); }
  }

  pickSpawn(team) {
    const list = this.world.spawns[team] || this.world.spawns.blue;
    let best = list[0], bestScore = -Infinity;
    const enemies = [this.player, ...this.fighters.values()].filter((f) => f && f.team !== team && !f.dead);
    for (const s of list) {
      let d = 60;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.pos.x - s[0], e.pos.z - s[1]));
      const score = d + Math.random() * 12;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return { pos: new THREE.Vector3(best[0], 0, best[1]), yaw: best[2] };
  }

  stop(backToMenu = true) {
    this.running = false;
    this.state = backToMenu ? 'attract' : 'paused';
    this.input.enabled = false;
    this.input.reset();
    this.input.unlock();
    if (this.net) { this.net.close(); this.net = null; }
    for (const f of this.fighters.values()) f.dispose();
    this.fighters.clear();
    for (const g of this.grenades) g.mesh.parent?.remove(g.mesh);
    this.grenades = [];
    this.demoChars.forEach((d) => d.c.root.visible = true);
    this.ui.showHud(false);
    this.ui.setScope(false);
    this.ui.el.scoreboard.classList.add('hidden');
    if (backToMenu) this.ui.showMenu();
  }

  endMatch() {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.running = false;
    this.input.enabled = false;
    this.input.unlock();
    this.ui.setScope(false);
    this.ui.el.scoreboard.classList.add('hidden');
    const win = this.match.blue === this.match.red ? 'draw' : this.match.blue > this.match.red ? 'blue' : 'red';
    this.ui.showMatchEnd(win, this.player, this.match.elapsed, this.options?.room || 'GENEL');
  }

  // ------------------------------------------------------------------
  //  AĞ
  // ------------------------------------------------------------------
  onNetStatus(text, mode) {
    this.netMode = mode;
    this.ui.setNetStatus(text, mode, this.net?.ping, this.fighters.size + 1);
    if (mode === 'offline' && this.running) {
      // yalnızca gerçek oyuncu yoksa botları doldur
      if (![...this.fighters.values()].some((f) => !f.isBot)) this.fillBots(this.options?.mode === 'solo' ? (this.options?.botCount ?? 8) : 6);
    } else if (mode === 'ws' || mode === 'mqtt') {
      if (this.options?.mode !== 'solo') this.removeBots();
    }
  }

  onPeers(list) {
    if (!this.running) return;
    if (this.options?.mode === 'solo') return;
    const ids = new Set(list.map((p) => p.id));
    for (const p of list) {
      if (p.id === this.id || this.fighters.has(p.id)) continue;
      let team = p.team;
      if (!team || team === 'auto') team = p.id.charCodeAt(p.id.length - 1) % 2 ? 'blue' : 'red';
      const f = new Fighter(this, { id: p.id, name: p.name || 'ASKER', team });
      const sp = this.pickSpawn(team);
      f.respawn(sp.pos, sp.yaw);
      try {
        f.character = new Character(this.assets, { team, name: f.name, T: this.T, weapon: 'ar' });
        this.scene.add(f.character.root);
      } catch (e) { console.warn(e); }
      f.syncVisual(0.016);
      this.fighters.set(p.id, f);
      this.ui.chat('', f.name + ' savaşa katıldı.', '', true);
    }
    for (const [id, f] of this.fighters) {
      if (f.isBot || ids.has(id)) continue;
      f.dispose(); this.fighters.delete(id);
      this.ui.chat('', f.name + ' ayrıldı.', '', true);
    }
    this.ui.setNetStatus(this.netMode === 'offline' ? 'ÇEVRİMDIŞI' : 'ÇEVRİMİÇİ', this.netMode, this.net?.ping, this.fighters.size + 1);
  }

  getFighter(id) {
    if (id === this.id) return this.player;
    return this.fighters.get(id);
  }

  onNetMessage(m) {
    if (!this.running) return;
    const info = m.info || {};
    const shooter = this.getFighter(m.from) || { id: m.from, name: info.name || 'ASKER', team: info.team || 'red', pos: this.player.pos, weapon: 'ar', isLocal: false };
    switch (m.t) {
      case 's': {
        let f = this.fighters.get(m.from);
        if (!f) {
          if (this.options?.mode === 'solo') return;
          const team = info.team && info.team !== 'auto' ? info.team : (m.from.charCodeAt(m.from.length - 1) % 2 ? 'blue' : 'red');
          f = new Fighter(this, { id: m.from, name: info.name || 'ASKER', team });
          const sp = this.pickSpawn(team); f.respawn(sp.pos, sp.yaw);
          try {
            f.character = new Character(this.assets, { team, name: f.name, T: this.T, weapon: m.w || 'ar' });
            this.scene.add(f.character.root);
          } catch (e) { console.warn(e); }
          this.fighters.set(m.from, f);
        }
        if (info.name && f.name !== info.name) f.name = info.name;
        f.applyState(m);
        break;
      }
      case 'f': { // uzak oyuncu ateş etti
        const o = new THREE.Vector3().fromArray(m.o), d = new THREE.Vector3().fromArray(m.d).normalize();
        const wh = this.world.raycast(o, d, WEAPONS[m.w]?.range || 160);
        const end = wh ? wh.point : o.clone().addScaledVector(d, 120);
        this.effects.tracer(o, end, (info.team || 'red') === this.localTeam ? 0x9fd0ff : 0xffb070, 0.9);
        this.effects.muzzleFlash(o, d, 0.85, (info.team || 'red') === this.localTeam ? 0xbfe0ff : 0xffc080);
        const f = this.fighters.get(m.from);
        if (f) { f.firing = true; setTimeout(() => { if (f) f.firing = false; }, 90); }
        this.audio.play(WEAPONS[m.w]?.sound || 'rifle', { dist: o.distanceTo(this.player.pos), volume: 0.8 });
        if (wh) this.effects.impact(end, wh.normal, wh.type === 'metal' || wh.type === 'tank' ? 'metal' : wh.type === 'ground' ? 'sand' : 'concrete');
        break;
      }
      case 'h': { // bir oyuncu vuruldu
        if (m.target === this.id && this.player && !this.player.dead) {
          this.player.takeDamage(m.dmg, shooter, m.part);
          if (m.point) this.effects.impact(new THREE.Vector3().fromArray(m.point), new THREE.Vector3(0, 1, 0), 'flesh', true);
        }
        break;
      }
      case 'x': { // ölüm bildirimi (kurban gönderir)
        this.registerDeath(m, false);
        break;
      }
      case 'k': { // öldürme bildirimi (öldüren gönderir, yetkili)
        const k = this.getFighter(m.killer);
        if (k && typeof m.k === 'number' && m.k > k.kills) k.kills = m.k;
        this.recomputeScores();
        break;
      }
      case 'g': { // el bombası (görsel)
        this.spawnGrenade(new THREE.Vector3().fromArray(m.o), new THREE.Vector3().fromArray(m.v), null, true);
        break;
      }
      case 'boom': {
        const p = new THREE.Vector3().fromArray(m.p);
        this.effects.explosion(p);
        this.audio.play('explosion', { dist: p.distanceTo(this.player.pos) });
        break;
      }
      case 'c':
        this.ui.chat(info.name || shooter.name, m.msg, info.team || shooter.team);
        break;
      case 'reconnected':
        this.net.send(this.player.getState());
        this.ui.chat('', 'Bağlantı yeniden kuruldu.', '', true);
        break;
    }
  }

  registerDeath(m, local) {
    const key = `${m.victim}:${m.d}`;
    if (this.deathsSeen.has(key)) return;
    this.deathsSeen.add(key);
    const victim = this.getFighter(m.victim);
    if (victim) {
      victim.dead = true;
      victim.deaths = m.d ?? victim.deaths;
      if (victim.character) victim.character.setDead(true);
    }
    const isLocalVictim = m.victim === this.id;
    this.ui.killFeed(m.killerName || '—', m.victimName || (victim?.name || 'ASKER'), m.w, m.head, m.killer === this.id || isLocalVictim);
    if (m.killer === this.id) {
      this.player.streak = (this.player.streak || 0) + 1;
      this.audio.play('kill');
      this.ui.hitMarker(m.head, true);
      this.ui.killBanner(m.head ? 'KAFA ATIŞI!' : (this.player.streak > 2 ? this.player.streak + ' SERİ ÖLDÜRME!' : 'ÖLDÜRDÜN!'));
    }
    if (isLocalVictim && this.player) {
      this.ui.showRespawn(true, m.killerName);
      this.audio.play('death');
      this.ui.damageFlash(100);
    }
    if (local && this.net) this.net.send(m);
  }

  /** Fighter.damage() tarafından çağrılır (yalnızca kurbanın istemcisinde) */
  onDeath(victim, source, part) {
    const m = {
      t: 'x', victim: victim.id, killer: source?.id || null,
      killerName: source?.name || '—', victimName: victim.name,
      head: part === 'head', w: source?.weapon || 'ar', d: victim.deaths,
    };
    this.registerDeath(m, true);
    // Öldüren yerel oyuncu veya bot ise öldürme sayısını hemen ver
    if (source && (source.isLocal || source.isBot) && source.team !== victim.team) this.grantKill(source, victim, part === 'head');
  }

  grantKill(killer, victim, head) {
    if (!killer || killer.team === victim.team) return;
    killer.kills = (killer.kills || 0) + 1;
    if (killer.isLocal && this.net) this.net.send({ t: 'k', killer: killer.id, k: killer.kills, victim: victim.id });
    this.recomputeScores();
  }

  recomputeScores() {
    let blue = 0, red = 0;
    const all = [this.player, ...this.fighters.values()];
    for (const f of all) {
      if (!f) continue;
      if (f.team === 'blue') blue += f.kills || 0; else red += f.kills || 0;
    }
    this.match.blue = blue; this.match.red = red;
    this.ui.updateScores(blue, red, this.match.time, this.match.limit);
    if (this.running && (blue >= this.match.limit || red >= this.match.limit)) this.endMatch();
  }

  // ------------------------------------------------------------------
  //  SAVAŞ
  // ------------------------------------------------------------------
  hitscan(shooter, origin, dir, w) {
    const range = w.range;
    const worldHit = this.world.raycast(origin, dir, range);
    let best = worldHit ? { t: worldHit.t, type: 'world', hit: worldHit } : null;
    let target = null, partHit = null;
    for (const f of [this.player, ...this.fighters.values()]) {
      if (!f || f === shooter || f.dead || f.team === shooter.team) continue;
      const h = f.raycast(origin, dir, range);
      if (h && (!best || h.t < best.t)) {
        best = { t: h.t, type: 'fighter' }; target = f; partHit = h;
      }
    }
    const end = origin.clone().addScaledVector(dir, best ? best.t : range);
    this.effects.tracer(this.player === shooter ? origin : origin, end, w.tracer, 1.1);
    if (best?.type === 'world') {
      const wh = best.hit;
      const kind = wh.type === 'ground' ? 'sand' : wh.type === 'tank' || wh.type === 'crate' ? 'metal' : 'concrete';
      this.effects.impact(wh.point, wh.normal, kind);
    }
    if (this.net && shooter.isLocal) {
      this.net.send({ t: 'f', o: origin.toArray().map((n) => +n.toFixed(2)), d: dir.toArray().map((n) => +n.toFixed(3)), w: w.id });
    }
    if (target && partHit) {
      const head = partHit.part === 'head';
      const dmg = w.damage * (head ? w.headMult : 1) * (partHit.mult || 1);
      const hpBefore = target.hp;
      this.hitFighter(target, dmg, shooter, partHit.part, end);
      if (shooter.isLocal) {
        this.player.hitsLanded++;
        this.ui.hitMarker(head, hpBefore <= dmg);
        this.ui.damageNumber(dmg, head);
        this.audio.play(head ? 'headshot' : 'hit');
        if (target.isLocal === false && !target.isBot && hpBefore <= dmg) {
          // Uzak oyuncu öldü: kendi istemcisi de ölüm bildirimi gönderecek,
          // registerDeath tekilleştirme anahtarıyla çift sayım önlenir.
          target.hp = 0; target.dead = true;
          if (target.character) target.character.setDead(true);
          this.grantKill(shooter, target, head);
        }
      }
    }
  }

  hitFighter(target, dmg, shooter, part, point) {
    if (!target || target.dead) return;
    this.effects.impact(point, _v.set(0, 1, 0), 'flesh', true);
    if (target.isLocal) {
      target.takeDamage(dmg, shooter, part);
    } else if (target.isBot) {
      target.damage(dmg, shooter, part);
    } else if (this.net) {
      this.net.send({
        t: 'h', target: target.id, dmg: +dmg.toFixed(1), part,
        point: point.toArray().map((n) => +n.toFixed(2)),
      });
    }
  }

  throwGrenade(origin, vel, owner, visualOnly = false) {
    this.spawnGrenade(origin, vel, owner, visualOnly);
    if (!visualOnly && this.net) {
      this.net.send({ t: 'g', o: origin.toArray().map((n) => +n.toFixed(2)), v: vel.toArray().map((n) => +n.toFixed(2)) });
    }
  }

  spawnGrenade(origin, vel, owner, visualOnly) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), new THREE.MeshStandardMaterial({ color: 0x3f4a33, roughness: 0.75, metalness: 0.35 }));
    body.castShadow = true; mesh.add(body);
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 10), new THREE.MeshStandardMaterial({ color: 0xb0b6a8, metalness: 0.9, roughness: 0.3 }));
    pin.position.y = 0.14; mesh.add(pin);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.grenades.push({ mesh, vel: vel.clone(), pos: origin.clone(), fuse: 2.5, owner, visualOnly, spin: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
  }

  updateGrenades(dt) {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 20 * dt;
      const next = g.pos.clone().addScaledVector(g.vel, dt);
      // zemin
      if (next.y < 0.13) {
        next.y = 0.13;
        g.vel.y *= -0.42; g.vel.x *= 0.72; g.vel.z *= 0.72;
      }
      // duvarlar
      const dir = next.clone().sub(g.pos); const len = dir.length();
      if (len > 0.0001) {
        dir.divideScalar(len);
        const hit = this.world.raycast(g.pos, dir, len + 0.12);
        if (hit && hit.type !== 'ground') {
          g.pos.copy(hit.point).addScaledVector(hit.normal, 0.13);
          const dot = g.vel.dot(hit.normal);
          if (dot < 0) g.vel.addScaledVector(hit.normal, -1.7 * dot);
          g.vel.multiplyScalar(0.62);
        } else g.pos.copy(next);
      } else g.pos.copy(next);
      g.pos.x = clamp(g.pos.x, -this.world.half, this.world.half);
      g.pos.z = clamp(g.pos.z, -this.world.half, this.world.half);
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += g.spin.x * dt; g.mesh.rotation.y += g.spin.y * dt;
      if (g.fuse <= 0) {
        this.explodeGrenade(g);
        g.mesh.parent?.remove(g.mesh);
        this.grenades.splice(i, 1);
      }
    }
  }

  explodeGrenade(g) {
    const p = g.pos.clone();
    if (g.visualOnly) return; // Atan istemcinin 'boom' mesajı efekti tetikleyecek
    this.effects.explosion(p, 7);
    this.audio.play('explosion', { dist: p.distanceTo(this.player.pos) });
    const d = p.distanceTo(this.player.pos);
    if (d < 16 && this.shakeEnabled) this.effects.shake += clamp((16 - d) / 16, 0, 1) * 0.7;
    if (!this.net) return;
    if (g.owner && g.owner.isLocal) this.net.send({ t: 'boom', p: p.toArray().map((n) => +n.toFixed(2)) });
    const R = 7.5;
    for (const f of [this.player, ...this.fighters.values()]) {
      if (!f || f.dead) continue;
      const dist = p.distanceTo(f.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      if (dist > R) continue;
      _v.subVectors(f.pos, p).normalize();
      const los = this.world.raycast(p.clone().add(new THREE.Vector3(0, 0.3, 0)), _v, dist);
      if (los && los.t < dist - 0.8) continue;
      const dmg = 140 * Math.pow(1 - dist / R, 1.35);
      if (dmg > 3) this.hitFighter(f, dmg, g.owner || this.player, 'body', f.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    }
  }

  respawnLocal() {
    const sp = this.pickSpawn(this.localTeam);
    this.player.respawn(sp.pos, sp.yaw);
    this.ui.showRespawn(false);
    this.ui.updateHealth(100);
    this.ui.updateAmmo(WEAPONS[this.player.weapon].mag, this.player.ammo[this.player.weapon].reserve);
    this.ui.updateGrenades(this.player.grenades);
    this.ui.setWeapon(WEAPONS[this.player.weapon]);
    this.net?.send(this.player.getState());
  }

  respawnBot(bot) {
    const sp = this.pickSpawn(bot.team);
    bot.respawn(sp.pos, sp.yaw);
    if (bot.character) { bot.character.setDead(false); bot.character.setHp(100); }
  }

  // ------------------------------------------------------------------
  //  GİRDİ
  // ------------------------------------------------------------------
  _onKey(code) {
    if (!this.running) return;
    const p = this.player, ui = this.ui;
    if (this.ui.chatOpen()) return;
    switch (code) {
      case 'KeyR': p.reload(); break;
      case 'KeyG': p.throwGrenade(); break;
      case 'Digit1': p.switchWeapon('ar'); break;
      case 'Digit2': p.switchWeapon('smg'); break;
      case 'Digit3': p.switchWeapon('dmr'); break;
      case 'KeyQ': p.cycleWeapon(1); break;
      case 'Tab': ui.toggleScoreboard(true, p, this.fighters, this.net?.room || 'GENEL'); break;
      case 'Enter':
        ui.openChat();
        this.input.unlock();
        break;
      case 'Escape':
        this.pause(true);
        this.input.unlock();
        break;
    }
    if (code === 'KeyF') this.ui.chat('', 'İpucu: 1/2/3 ile silah değiştir, G ile bomba at.', '', true);
  }

  _onKeyUp(code) {
    if (code === 'Tab') this.ui.toggleScoreboard(false);
  }

  _onLockChange(locked) {
    if (!this.running) return;
    if (!locked && !this.ui.chatOpen() && this.state === 'playing') this.pause(true);
  }

  pause(show = true) {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.reset();
    if (show) this.ui.screen('pause');
    this.ui.setScope(false);
    this.ui.el.scoreboard.classList.add('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.hideScreens();
    this.input.lock();
  }

  // ------------------------------------------------------------------
  //  DÖNGÜ
  // ------------------------------------------------------------------
  loop = () => {
    this.frameHandle = requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    if (!this.renderer || !this.world) return;

    this.world.update(dt);

    if (this.state === 'playing' && this.player) {
      this.player.update(dt);
      for (const f of this.fighters.values()) {
        if (f.isBot) f.update(dt);
        else { f.interpolate(dt); f.syncVisual(dt); }
      }
      this.updateGrenades(dt);
      this.effects.update(dt);
      this.ui.updateReload(dt);
      this.ui.fpsTick(dt);

      // Nişangah yayılması
      const w = WEAPONS[this.player.weapon];
      const spread = this.player.ads ? 5 : 10 + this.player.speed * 0.7;
      this.ui.setCrosshairSpread(spread);
      const scoped = w.id === 'dmr' && this.player.ads && !this.player.sprinting;
      this.ui.setScope(scoped);
      if (this.viewModel.current) this.viewModel.current.visible = !scoped;

      // Maç zamanı
      this.match.time -= dt; this.match.elapsed += dt;
      if (Math.floor(this.match.time) !== this.lastSec) {
        this.lastSec = Math.floor(this.match.time);
        this.ui.updateScores(this.match.blue, this.match.red, this.match.time, this.match.limit);
        if (this.match.time <= 0) this.endMatch();
      }
      // Durum yayını (15 Hz)
      this.stateAcc += dt;
      if (this.stateAcc >= 0.066) {
        this.stateAcc = 0;
        if (this.net) this.net.send(this.player.getState());
      }
      // Minimap (12 Hz)
      this.miniAcc += dt;
      if (this.miniAcc >= 0.08) {
        this.miniAcc = 0;
        this.ui.updateMinimap(this.player, this.fighters, this.world);
        if (!this.ui.el.scoreboard.classList.contains('hidden')) {
          this.ui.toggleScoreboard(true, this.player, this.fighters, this.net?.room || 'GENEL');
        }
      }
      // Uzak oyuncuların zaman aşımı
      const now = performance.now();
      for (const [id, f] of this.fighters) {
        if (!f.isBot && now - f.lastSeen > 20000) { f.dispose(); this.fighters.delete(id); }
      }
    } else if (this.state === 'attract') {
      // Attract modu: sinematik kamera + demon askerler
      this.attractT += dt;
      const a = this.attractT * 0.055;
      this.camera.position.set(Math.cos(a) * 62, 20 + Math.sin(a * 0.8) * 6, Math.sin(a) * 62);
      this.camera.lookAt(0, 5, 0);
      for (const d of this.demoChars) {
        const p = d.p;
        const t = this.attractT * p.sp + p.ph;
        const x = p.cx + Math.cos(t) * p.rx, z = p.cz + Math.sin(t) * p.rz;
        d.c.root.position.set(x, 0, z);
        d.c.root.rotation.y = -t + (p.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
        d.c.update(dt, { speed: 3.2, crouch: false, pitch: 0 }, this.camera);
      }
      this.effects.update(dt);
    } else {
      // Duraklatıldı / maç bitti: kamerayı dondur, sahneyi göstermeye devam et
      this.effects.update(dt * 0.25);
    }

    this.render();
  };

  render() {
    if (this.composer && this.quality !== 'low') this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    if (this.state === 'playing' && this.player && this.viewModel.current) {
      const old = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
      this.renderer.autoClear = old;
    }
  }
}
