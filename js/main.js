import { UI } from './ui.js';
import { Game } from './game.js';
import { roomCode } from './util.js';

const $ = (id) => document.getElementById(id);
const LS = 'savas-alani-ayarlar-v1';

const defaults = {
  name: '', quality: 'high', sensitivity: 1, volume: 0.6, fov: 78,
  relay: '', shake: true, team: 'auto', mode: 'online', botCount: 8, botDifficulty: 1,
  room: roomCode(),
};
function loadSettings() {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(LS) || '{}') }; }
  catch { return { ...defaults }; }
}
function saveSettings(s) { try { localStorage.setItem(LS, JSON.stringify(s)); } catch {} }

const S = loadSettings();
const url = new URLSearchParams(location.search);
if (url.has('room')) { S.room = url.get('room').toUpperCase().slice(0, 12); S.mode = 'private'; }
if (url.has('name')) S.name = url.get('name').slice(0, 16);
if (url.has('mode') && ['online', 'private', 'solo'].includes(url.get('mode'))) S.mode = url.get('mode');
if (url.has('relay')) S.relay = url.get('relay');
if (url.has('quality') && ['low', 'high', 'ultra'].includes(url.get('quality'))) S.quality = url.get('quality');

const ui = new UI();
let game = null;
let ready = false;
const playBtn = $('play-btn');
playBtn.disabled = true;
playBtn.style.opacity = '.6';
playBtn.style.pointerEvents = 'none';

// ------------------------------------------------------------------ MENÜ DURUMU
function markActive(selector, attr, value) {
  document.querySelectorAll(selector).forEach((b) => b.classList.toggle('active', b.dataset[attr] === value));
}
function syncUI() {
  $('player-name').value = S.name || '';
  $('room-code').value = S.room || '';
  $('bot-count').value = S.botCount;
  $('bot-count-val').textContent = S.botCount;
  $('bot-diff').value = S.botDifficulty;
  $('bot-diff-val').textContent = ['ACEMİ', 'NORMAL', 'ZORLU'][S.botDifficulty] || 'NORMAL';
  $('set-sens').value = S.sensitivity; $('sens-val').textContent = Number(S.sensitivity).toFixed(2);
  $('set-vol').value = S.volume; $('vol-val').textContent = Math.round(S.volume * 100) + '%';
  $('set-fov').value = S.fov; $('fov-val').textContent = S.fov;
  $('set-quality').value = S.quality;
  $('set-relay').value = S.relay || '';
  $('set-shake').checked = S.shake !== false;
  markActive('.mode-tab', 'mode', S.mode);
  markActive('.team-tab', 'team', S.team);
  markActive('.q-tab', 'q', S.quality);
  $('room-row').classList.toggle('hidden', S.mode !== 'private');
  $('bot-row').classList.toggle('hidden', S.mode !== 'solo');
  updateRoomLink();
  $('play-hint').textContent = S.mode === 'solo' ? 'TEK OYUNCULU' : S.mode === 'private' ? 'ÖZEL ODA' : 'HEMEN BAŞLA';
}
function updateRoomLink() {
  const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(S.room)}`;
  $('room-link').textContent = link.replace(/^https?:\/\//, '').slice(0, 46) + '…';
  $('room-link').title = link;
  $('room-link').dataset.link = link;
}
syncUI();

document.querySelectorAll('.mode-tab').forEach((b) => b.addEventListener('click', () => {
  S.mode = b.dataset.mode; saveSettings(S); syncUI();
  $('menu-status').textContent = {
    online: 'Genel oda: dünyanın her yerinden oyuncularla aynı savaşa girersin.',
    private: 'Özel oda: aynı kodu (veya bağlantıyı) arkadaşlarına gönder.',
    solo: 'Çevrimdışı: yapay zekâ askerlerine karşı antrenman savaşı.',
  }[S.mode];
}));
document.querySelectorAll('.team-tab').forEach((b) => b.addEventListener('click', () => { S.team = b.dataset.team; saveSettings(S); syncUI(); }));
document.querySelectorAll('.q-tab').forEach((b) => b.addEventListener('click', () => { S.quality = b.dataset.q; saveSettings(S); syncUI(); game?.setQuality(S.quality); }));

$('player-name').addEventListener('input', (e) => { S.name = e.target.value; saveSettings(S); });
$('room-code').addEventListener('input', (e) => { S.room = e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12); e.target.value = S.room; saveSettings(S); updateRoomLink(); });
$('room-random').addEventListener('click', () => { S.room = roomCode(); saveSettings(S); syncUI(); });
$('copy-link').addEventListener('click', async () => {
  const link = $('room-link').dataset.link;
  try { await navigator.clipboard.writeText(link); $('copy-link').textContent = 'KOPYALANDI ✓'; }
  catch { $('copy-link').textContent = 'ELLE KOPYALA'; }
  setTimeout(() => $('copy-link').textContent = 'KOPYALA', 1800);
});
$('bot-count').addEventListener('input', (e) => { S.botCount = +e.target.value; $('bot-count-val').textContent = S.botCount; saveSettings(S); });
$('bot-diff').addEventListener('input', (e) => { S.botDifficulty = +e.target.value; $('bot-diff-val').textContent = ['ACEMİ', 'NORMAL', 'ZORLU'][S.botDifficulty]; saveSettings(S); });

// ------------------------------------------------------------------ AYARLAR
function applyLiveSettings() {
  if (!game) return;
  game.input.sensitivity = 0.0022 * S.sensitivity;
  game.audio.setVolume(S.volume);
  game.baseFov = S.fov;
  if (game.camera) { game.camera.fov = S.fov; game.camera.updateProjectionMatrix(); }
  game.shakeEnabled = S.shake !== false;
  game.setQuality(S.quality);
}
$('set-sens').addEventListener('input', (e) => { S.sensitivity = +e.target.value; $('sens-val').textContent = S.sensitivity.toFixed(2); saveSettings(S); applyLiveSettings(); });
$('set-vol').addEventListener('input', (e) => { S.volume = +e.target.value; $('vol-val').textContent = Math.round(S.volume * 100) + '%'; saveSettings(S); applyLiveSettings(); });
$('set-fov').addEventListener('input', (e) => { S.fov = +e.target.value; $('fov-val').textContent = S.fov; saveSettings(S); applyLiveSettings(); });
$('set-quality').addEventListener('change', (e) => { S.quality = e.target.value; markActive('.q-tab', 'q', S.quality); saveSettings(S); applyLiveSettings(); });
$('set-relay').addEventListener('change', (e) => { S.relay = e.target.value.trim(); saveSettings(S); });
$('set-shake').addEventListener('change', (e) => { S.shake = e.target.checked; saveSettings(S); applyLiveSettings(); });
$('settings-btn').addEventListener('click', () => ui.screen('settings'));
$('settings-close').addEventListener('click', () => {
  S.relay = $('set-relay').value.trim(); saveSettings(S);
  if (game?.state === 'paused') ui.screen('pause'); else ui.screen('menu');
});
$('pause-settings-btn').addEventListener('click', () => ui.screen('settings'));

// ------------------------------------------------------------------ OYUN KONTROLLERİ
playBtn.addEventListener('click', () => {
  if (!ready || !game) return;
  const name = ($('player-name').value || '').trim().slice(0, 16) || 'ASKER-' + Math.floor(Math.random() * 900 + 100);
  S.name = name; S.room = ($('room-code').value || S.room || 'GENEL').toUpperCase(); saveSettings(S);
  game.start({
    name, team: S.team, mode: S.mode,
    room: S.mode === 'private' ? S.room : 'GENEL',
    botCount: S.botCount, botDifficulty: S.botDifficulty,
    quality: S.quality, sensitivity: S.sensitivity, volume: S.volume,
    fov: S.fov, shake: S.shake, relayUrl: S.relay || null,
  });
});
$('resume-btn').addEventListener('click', () => game?.resume());
$('quit-btn').addEventListener('click', () => { game?.stop(true); ui.hideScreens(); ui.showMenu(); $('menu-status').textContent = 'Savaştan ayrıldın. Yeni bir operasyona hazır mısın?'; });
$('end-again').addEventListener('click', () => {
  ui.hideScreens();
  game?.start({
    name: S.name, team: S.team, mode: S.mode,
    room: S.mode === 'private' ? S.room : 'GENEL',
    botCount: S.botCount, botDifficulty: S.botDifficulty,
    quality: S.quality, sensitivity: S.sensitivity, volume: S.volume,
    fov: S.fov, shake: S.shake, relayUrl: S.relay || null,
  });
});
$('end-menu').addEventListener('click', () => { game?.stop(true); });

ui.chatCallback = (msg) => {
  if (!game?.player || !game.net) return;
  game.net.send({ t: 'c', msg });
  ui.chat(game.player.name, msg, game.localTeam);
};
ui.onChatClose = () => { if (game?.state === 'playing') game.input.lock(); };

window.addEventListener('keyup', (e) => { if (e.code === 'Tab') game?._onKeyUp('Tab'); });
document.addEventListener('visibilitychange', () => { if (document.hidden && game?.state === 'playing') game.pause(true); });
if (window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
  document.body.classList.add('touch');
}

// ------------------------------------------------------------------ BAŞLATMA
(async function boot() {
  ui.showLoading('WebGL motoru başlatılıyor…');
  ui.setTip('İpucu: Sağ tık ile nişan almak isabetini ciddi artırır.');
  try {
    game = new Game($('game-canvas'), ui, S);
    window.__game = game; window.__ui = ui; // hata ayıklama / otomasyon
    await game.init((p, text) => ui.setLoading(p, text));
    ready = true;
    playBtn.disabled = false;
    playBtn.style.opacity = '1';
    playBtn.style.pointerEvents = 'auto';
    if (!location.hostname.endsWith('github.io')) {
      $('menu-status').textContent = 'Yerel röle sunucusu aktif — aynı bağlantıyı ikinci bir sekmede açarak anında multiplayer test edebilirsin.';
    }
    await new Promise((r) => setTimeout(r, 250));
    ui.showMenu();
  } catch (err) {
    console.error(err);
    ui.setLoading(1, 'HATA: ' + (err?.message || 'WebGL başlatılamadı'));
    ui.setTip('Tarayıcınız WebGL desteklemiyor olabilir. Chrome / Edge / Firefox ile deneyin veya donanım hızlandırmayı açın.');
  }
})();
