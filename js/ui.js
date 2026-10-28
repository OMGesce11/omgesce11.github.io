import { escapeHtml, formatTime, clamp } from './util.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {};
    for (const id of [
      'menu', 'loading', 'hud', 'scoreboard', 'pause', 'settings', 'matchend',
      'loading-fill', 'loading-text', 'loading-tip', 'damage-flash', 'muzzle-vignette',
      'score-blue', 'score-red', 'match-time', 'score-limit', 'crosshair', 'hitmarker',
      'damage-numbers', 'damage-indicators', 'killfeed', 'kill-banner', 'minimap',
      'hp-fill', 'hp-ghost', 'hp-num', 'hud-name', 'hud-team', 'weapon-name', 'weapon-mode',
      'ammo-mag', 'ammo-reserve', 'reload-wrap', 'reload-fill', 'grenade-count',
      'net-status', 'net-text', 'ping-text', 'players-text', 'fps-counter',
      'chat-messages', 'chat-input', 'respawn', 'respawn-sec', 'respawn-by', 'respawn-fill',
      'scope-overlay', 'low-hp', 'sb-body', 'sb-blue', 'sb-red', 'sb-room',
      'end-title', 'end-sub', 'end-kills', 'end-deaths', 'end-acc', 'end-time',
    ]) this.el[id] = $(id);
    this.miniCtx = this.el['minimap'].getContext('2d');
    this.chatCallback = null;
    this.reloadT = 0; this.reloadMax = 1;
    this.hpGhost = 100;
    this.fpsAcc = 0; this.fpsFrames = 0; this.fps = 0;
    this.lastKillfeed = [];
    this.el['chat-input'].addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const v = this.el['chat-input'].value.trim();
        if (v && this.chatCallback) this.chatCallback(v);
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  // ---------- Ekranlar ----------
  screen(name) {
    for (const s of ['menu', 'loading', 'pause', 'settings', 'matchend']) {
      this.el[s].classList.toggle('hidden', s !== name);
    }
  }
  showMenu() { this.screen('menu'); this.showHud(false); this.el.scoreboard.classList.add('hidden'); }
  showLoading(text) { this.screen('loading'); this.setLoading(0.04, text || '3B motor başlatılıyor…'); }
  hideScreens() { this.screen(null); }
  showHud(v) { this.el.hud.classList.toggle('hidden', !v); }

  setLoading(p, text) {
    this.el['loading-fill'].style.width = clamp(p, 0, 1) * 100 + '%';
    if (text) this.el['loading-text'].textContent = text;
  }
  setTip(t) { this.el['loading-tip'].textContent = t; }

  // ---------- HUD ----------
  setIdentity(name, team, weapon) {
    this.el['hud-name'].textContent = name;
    this.el['hud-team'].textContent = team === 'blue' ? 'MAVİ TAKIM' : 'KIRMIZI TAKIM';
    this.el['hud-team'].style.color = team === 'blue' ? '#79b9ff' : '#ff8c78';
    if (weapon) this.setWeapon(WEAPONS[weapon]);
  }
  updateHealth(hp) {
    this.el['hp-fill'].style.width = clamp(hp, 0, 100) + '%';
    this.el['hp-fill'].classList.toggle('low', hp <= 35);
    this.el['hp-num'].textContent = Math.max(0, Math.round(hp));
    this.el['hp-ghost'].style.width = this.hpGhost + '%';
    if (hp < this.hpGhost) {
      clearTimeout(this._ghostT);
      this._ghostT = setTimeout(() => { this.hpGhost = hp; this.el['hp-ghost'].style.width = hp + '%'; }, 350);
    } else this.hpGhost = hp;
    this.el['low-hp'].style.opacity = hp < 30 ? '1' : '0';
    this.el['low-hp'].style.display = hp < 30 ? 'block' : 'none';
  }
  damageFlash(amount) {
    const e = this.el['damage-flash'];
    e.style.opacity = clamp(amount / 70, 0.15, 0.85);
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => e.style.opacity = 0, 90);
  }
  updateAmmo(mag, reserve) {
    this.el['ammo-mag'].textContent = mag;
    this.el['ammo-reserve'].textContent = reserve;
    this.el['ammo-mag'].classList.toggle('low', mag <= 6);
  }
  setWeapon(w) {
    this.el['weapon-name'].textContent = w.name;
    this.el['weapon-mode'].textContent = w.auto ? 'TAM OTOMATİK' : 'YARI OTOMATİK';
    document.querySelectorAll('.slot').forEach((s) => {
      s.classList.toggle('active', s.dataset.slot === ({ ar: '1', smg: '2', dmr: '3' })[w.id]);
    });
  }
  updateGrenades(n) { this.el['grenade-count'].textContent = n; }
  reloadStart(t) {
    this.reloadT = t; this.reloadMax = t;
    this.el['reload-wrap'].classList.remove('hidden');
  }
  updateReload(dt) {
    if (this.reloadT <= 0) return;
    this.reloadT -= dt;
    if (this.reloadT <= 0) { this.el['reload-wrap'].classList.add('hidden'); return; }
    this.el['reload-fill'].style.width = (1 - this.reloadT / this.reloadMax) * 100 + '%';
  }
  setCrosshairSpread(px) { this.el.crosshair.style.setProperty('--spread', px + 'px'); }
  setScope(v) { this.el['scope-overlay'].classList.toggle('hidden', !v); }
  hitMarker(head, kill) {
    const e = this.el.hitmarker;
    e.className = '';
    void e.offsetWidth;
    e.className = 'show' + (head ? ' head' : '') + (kill ? ' kill' : '');
  }
  damageNumber(n, head) {
    const d = document.createElement('div');
    d.className = 'dmg-num' + (head ? ' head' : '');
    d.textContent = Math.round(n);
    d.style.left = (Math.random() * 26 - 10) + 'px';
    d.style.top = (Math.random() * 16 - 8) + 'px';
    this.el['damage-numbers'].appendChild(d);
    setTimeout(() => d.remove(), 850);
  }
  damageFrom(fromPos, myPos, yaw) {
    const dx = fromPos.x - myPos.x, dz = fromPos.z - myPos.z;
    const ang = Math.atan2(dx, -dz) - yaw;
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${ang}rad)`;
    d.innerHTML = '<i></i>';
    this.el['damage-indicators'].appendChild(d);
    setTimeout(() => d.remove(), 1150);
  }
  killFeed(killer, victim, weapon, head, local) {
    const d = document.createElement('div');
    d.className = 'kf' + (local ? ' local' : '');
    d.innerHTML = `<span class="n1">${escapeHtml(killer)}</span><span class="w">${head ? '✷' : '➤'}</span><span class="n2">${escapeHtml(victim)}</span>`;
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 6500);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }
  killBanner(text) {
    const e = this.el['kill-banner'];
    e.textContent = text;
    e.className = '';
    void e.offsetWidth;
    e.className = 'show';
  }
  updateScores(blue, red, timeLeft, limit) {
    this.el['score-blue'].textContent = blue;
    this.el['score-red'].textContent = red;
    this.el['match-time'].textContent = formatTime(timeLeft);
    this.el['score-limit'].textContent = limit;
    this.el['sb-blue'].textContent = blue;
    this.el['sb-red'].textContent = red;
  }
  updateRespawn(sec) {
    this.el['respawn-sec'].textContent = Math.ceil(sec);
    this.el['respawn-fill'].style.width = clamp(sec / 3.2, 0, 1) * 100 + '%';
  }
  showRespawn(v, killer) {
    this.el.respawn.classList.toggle('hidden', !v);
    if (killer) this.el['respawn-by'].textContent = killer + ' tarafından öldürüldün';
  }
  setNetStatus(text, mode, ping, players) {
    this.el['net-text'].textContent = text;
    const dot = this.el['net-status'].querySelector('.net-dot');
    dot.className = 'net-dot ' + (mode === 'offline' ? 'offline' : mode === 'ws' || mode === 'mqtt' ? 'online' : '');
    if (ping !== undefined) this.el['ping-text'].textContent = ping ? `• ${ping} ms` : '';
    if (players !== undefined) this.el['players-text'].textContent = `• ${players} OYUNCU`;
  }
  fpsTick(dt) {
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.6) {
      this.fps = Math.round(this.fpsFrames / this.fpsAcc);
      this.el['fps-counter'].textContent = this.fps + ' FPS';
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
  }

  // ---------- Minimap ----------
  updateMinimap(player, fighters, world) {
    const c = this.miniCtx, S = 220, half = world.half, sc = S / (half * 2);
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(18,26,32,.72)'; c.fillRect(0, 0, S, S);
    // ızgara
    c.strokeStyle = 'rgba(140,180,200,.08)'; c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      const p = i * S / 8;
      c.beginPath(); c.moveTo(p, 0); c.lineTo(p, S); c.stroke();
      c.beginPath(); c.moveTo(0, p); c.lineTo(S, p); c.stroke();
    }
    const X = (x) => (x + half) * sc, Z = (z) => (z + half) * sc;
    // yapılar
    for (const col of world.colliders) {
      if (col.type !== 'building' && col.type !== 'tank' && col.max.y < 2.5) continue;
      const w = (col.max.x - col.min.x) * sc, h = (col.max.z - col.min.z) * sc;
      if (w > S * 0.5 || h > S * 0.5) continue;
      c.fillStyle = col.type === 'tank' ? 'rgba(190,205,140,.55)' : 'rgba(165,195,210,.45)';
      c.fillRect(X(col.min.x), Z(col.min.z), w, h);
      c.strokeStyle = 'rgba(215,235,245,.35)';
      c.strokeRect(X(col.min.x), Z(col.min.z), w, h);
    }
    // sınırlar
    c.strokeStyle = 'rgba(255,179,43,.45)'; c.lineWidth = 2;
    c.strokeRect(1, 1, S - 2, S - 2);
    // oyuncular
    for (const f of fighters.values()) {
      if (f.isLocal || f.dead) continue;
      const dist = f.pos.distanceTo(player.pos);
      if (f.team !== player.team && dist > 55) continue;
      c.beginPath();
      c.arc(X(f.pos.x), Z(f.pos.z), f.team === player.team ? 3.4 : 3.2, 0, Math.PI * 2);
      c.fillStyle = f.team === 'blue' ? '#5aa8ff' : '#ff5b45';
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1; c.stroke();
    }
    // yerel oyuncu + görüş konisi
    const px = X(player.pos.x), pz = Z(player.pos.z);
    c.save(); c.translate(px, pz); c.rotate(-player.yaw);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(-14, -30); c.lineTo(14, -30); c.closePath();
    c.fillStyle = 'rgba(255,190,70,.16)'; c.fill();
    c.beginPath(); c.moveTo(0, -8); c.lineTo(-5, 5); c.lineTo(5, 5); c.closePath();
    c.fillStyle = '#ffd45a'; c.fill();
    c.strokeStyle = '#000'; c.lineWidth = 1; c.stroke();
    c.restore();
  }

  // ---------- Skor tablosu ----------
  toggleScoreboard(v, player, fighters, room) {
    this.el.scoreboard.classList.toggle('hidden', !v);
    if (!v) return;
    this.el['sb-room'].textContent = room + ' ODA';
    const list = [player, ...fighters.values()].filter((f) => !f.isLocal || f === player);
    list.sort((a, b) => (b.kills - b.deaths * 0.4) - (a.kills - a.deaths * 0.4));
    this.el['sb-body'].innerHTML = list.map((f) => `
      <tr class="${f.team} ${f.isLocal ? 'local' : ''}">
        <td>${escapeHtml(f.name)}${f.isBot ? ' <small style="color:#889">[BOT]</small>' : ''}</td>
        <td>${f.kills}</td><td>${f.deaths}</td><td>${f.isLocal ? '—' : (f.ping || '—')}</td>
      </tr>`).join('');
  }

  // ---------- Sohbet ----------
  chat(name, msg, team, sys) {
    const d = document.createElement('div');
    d.className = 'chat-msg' + (sys ? ' sys' : '');
    d.innerHTML = sys ? escapeHtml(msg) : `<b style="color:${team === 'red' ? '#ff8c78' : '#79b9ff'}">${escapeHtml(name)}:</b>${escapeHtml(msg)}`;
    this.el['chat-messages'].appendChild(d);
    while (this.el['chat-messages'].children.length > 6) this.el['chat-messages'].firstChild.remove();
    setTimeout(() => d.remove(), 12000);
  }
  openChat() {
    this.el['chat-input'].classList.remove('hidden');
    this.el['chat-input'].focus();
  }
  closeChat() {
    const wasOpen = this.chatOpen();
    this.el['chat-input'].classList.add('hidden');
    this.el['chat-input'].value = '';
    this.el['chat-input'].blur();
    if (wasOpen && this.onChatClose) this.onChatClose();
  }
  chatOpen() { return !this.el['chat-input'].classList.contains('hidden'); }

  // ---------- Maç sonu ----------
  showMatchEnd(win, player, elapsed, room) {
    this.screen('matchend');
    const myTeamWin = win === player.team;
    this.el['end-title'].textContent = myTeamWin ? 'ZAFER' : 'YENİLGİ';
    this.el['end-title'].className = 'end-title' + (myTeamWin ? '' : ' lose');
    this.el['end-sub'].textContent = (win === 'blue' ? 'MAVİ TAKIM' : 'KIRMIZI TAKIM') + ' KAZANDI';
    this.el['end-kills'].textContent = player.kills;
    this.el['end-deaths'].textContent = player.deaths;
    this.el['end-acc'].textContent = (player.shotsFired ? Math.round(player.hitsLanded / player.shotsFired * 100) : 0) + '%';
    this.el['end-time'].textContent = formatTime(elapsed);
  }
}
