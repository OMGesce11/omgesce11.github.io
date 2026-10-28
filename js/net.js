import { uid } from './util.js';

/* ------------------------------------------------------------------
   İki taşıma katmanı:
   1) Aynı origin /ws  -> kendi Node röle sunucumuz (en hızlı, önerilen)
   2) Genel MQTT-over-WebSocket brokerları -> GitHub Pages gibi statik
      sunucularda hiç kurulum gerektirmeden çalışır
   İkisi de olmazsa oyun botlarla çevrimdışı devam eder.
------------------------------------------------------------------ */

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const TOPIC_PREFIX = 'arena-savas-v3';

class WSTransport {
  constructor(net, url) {
    this.net = net; this.url = url; this.ws = null; this.open = false;
  }
  connect() {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { this.ws?.close(); } catch {} reject(new Error('ws-timeout')); } }, 6000);
      try {
        this.ws = new WebSocket(this.url);
      } catch (e) { clearTimeout(timer); reject(e); return; }
      this.ws.onopen = () => { this.open = true; };
      this.ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (!done && m.t === 'welcome') {
          done = true; clearTimeout(timer);
          if (m.id && m.id !== this.net.id) {
            this.net.id = m.id;
            this.net.onIdChange?.(m.id);
          }
          for (const p of m.peers || []) this.net._peer(p.id, p, false);
          this.net._peersChanged();
          resolve();
          return;
        }
        this.net._receive(m);
      };
      this.ws.onerror = () => { if (!done) { done = true; clearTimeout(timer); reject(new Error('ws-error')); } };
      this.ws.onclose = () => {
        this.open = false;
        if (!done) { done = true; clearTimeout(timer); reject(new Error('ws-closed')); }
        else this.net._disconnected();
      };
    });
  }
  send(str) { if (this.open) this.ws.send(str); }
  close() { this.open = false; try { this.ws?.close(); } catch {} }
}

class MQTTTransport {
  constructor(net, url) {
    this.net = net; this.url = url; this.client = null; this.open = false;
  }
  async connect() {
    const mod = await import('../vendor/mqtt.esm.js');
    const mqtt = mod.default;
    if (!mqtt || typeof mqtt.connect !== 'function') throw new Error('mqtt-unavailable');
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; try { this.client?.end(true); } catch {} reject(new Error('mqtt-timeout')); } }, 8000);
      let client;
      try {
        client = mqtt.connect(this.url, {
          clientId: 'savas_' + this.net.id,
          keepalive: 20, clean: true, protocolVersion: 4,
          reconnectPeriod: 0, connectTimeout: 7000,
          resubscribe: false,
        });
      } catch (e) { clearTimeout(timer); reject(e); return; }
      this.client = client;
      client.on('connect', () => {
        client.subscribe(this.net.topic + '/m', { qos: 0 }, (err) => {
          if (err) { done = true; clearTimeout(timer); client.end(true); reject(err); return; }
          this.open = true;
          if (!done) { done = true; clearTimeout(timer); resolve(); }
        });
      });
      client.on('message', (topic, payload) => {
        let m; try { m = JSON.parse(payload.toString()); } catch { return; }
        this.net._receive(m);
      });
      client.on('error', (e) => {
        if (!done) { done = true; clearTimeout(timer); try { client.end(true); } catch {} reject(e); }
      });
      client.on('close', () => {
        this.open = false;
        if (!done) { done = true; clearTimeout(timer); reject(new Error('mqtt-closed')); }
        else this.net._disconnected();
      });
    });
  }
  send(str) {
    if (this.open && this.client && this.client.connected) {
      this.client.publish(this.net.topic + '/m', str, { qos: 0, retain: false });
    }
  }
  close() { this.open = false; try { this.client?.end(true); } catch {} }
}

export class Network {
  constructor(opts) {
    this.room = (opts.room || 'GENEL').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20) || 'GENEL';
    this.name = opts.name || 'ASKER';
    this.team = opts.team || 'blue';
    this.id = 'p_' + uid(10);
    this.topic = `${TOPIC_PREFIX}/${this.room}`;
    this.onMessage = opts.onMessage || (() => {});
    this.onPeers = opts.onPeers || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onIdChange = opts.onIdChange || null;
    this.offlineRetries = 0;
    this.retryTimer = null;
    this.preferLocal = opts.preferLocal !== false;
    this.relayUrl = opts.relayUrl || null;
    this.mode = 'offline';
    this.peers = new Map();
    this.transport = null;
    this.closed = false;
    this.helloTimer = null;
    this.pingTimer = null;
    this.lastPing = 0;
    this.ping = 0;
    this.mqttHelloOnJoin = true;
  }

  _peer(id, info, notify = true) {
    if (!id || id === this.id) return;
    const p = this.peers.get(id) || { id, lastSeen: 0 };
    Object.assign(p, info, { lastSeen: performance.now() });
    this.peers.set(id, p);
    if (notify) this._peersChanged();
  }
  _removePeer(id) {
    if (this.peers.delete(id)) this._peersChanged();
  }
  _peersChanged() { this.onPeers([...this.peers.values()]); }

  _receive(m) {
    if (!m || m.from === this.id || (m.room && m.room !== this.room)) return;
    const info = m.info || { name: m.name || 'ASKER', team: m.team || 'blue' };
    switch (m.t) {
      case 'hello':
        this._peer(m.from, info);
        if (!m.reply) this._sendRaw({ t: 'hello', reply: true, info: this._selfInfo(), room: this.room });
        break;
      case 'bye': this._removePeer(m.from); break;
      case 'join': this._peer(m.p?.id || m.from, m.p || info); break;
      case 'left': this._removePeer(m.id || m.from); break;
      case 'pong':
        if (m.ts === this.lastPing) this.ping = Math.round(performance.now() - this.lastPingAt);
        break;
      case 'ping': this._sendRaw({ t: 'pong', ts: m.ts, room: this.room }); break;
      default:
        this._peer(m.from, info, false);
        this.onMessage(m);
    }
  }

  _selfInfo() { return { id: this.id, name: this.name, team: this.team }; }

  _sendRaw(obj) {
    if (!this.transport) return;
    obj.from = obj.from || this.id;
    obj.room = obj.room || this.room;
    obj.info = obj.info || this._selfInfo();
    try { this.transport.send(JSON.stringify(obj)); } catch (e) { /* sessiz */ }
  }
  send(obj) { this._sendRaw(obj); }

  _startHeartbeat() {
    clearInterval(this.helloTimer); clearInterval(this.pingTimer);
    this._sendRaw({ t: 'hello', info: this._selfInfo(), room: this.room });
    this.helloTimer = setInterval(() => {
      this._sendRaw({ t: 'hello', info: this._selfInfo(), room: this.room });
      // 12 saniyedir sesi çıkmayan oyuncuyu listeden düşür
      let changed = false;
      for (const [id, p] of this.peers) {
        if (performance.now() - p.lastSeen > 12000) { this.peers.delete(id); changed = true; }
      }
      if (changed) this._peersChanged();
    }, 3000);
    this.pingTimer = setInterval(() => {
      this.lastPing = performance.now(); this.lastPingAt = performance.now();
      this._sendRaw({ t: 'ping', ts: this.lastPing, room: this.room });
    }, 4000);
  }

  _stopHeartbeat() { clearInterval(this.helloTimer); clearInterval(this.pingTimer); }

  _disconnected() {
    if (this.closed) return;
    this._stopHeartbeat();
    this.onStatus('Bağlantı koptu — yeniden bağlanılıyor…', this.mode);
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect(true).catch(() => this.onStatus('Çevrimdışı — botlarla devam', 'offline'));
    }, 1500);
  }

  async connect(isReconnect = false) {
    const hosts = [];
    if (this.relayUrl) hosts.push({ type: 'ws', url: this.relayUrl });
    else if (this.preferLocal && !location.hostname.endsWith('github.io')) {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      hosts.push({ type: 'ws', url: `${proto}://${location.host}/ws?room=${encodeURIComponent(this.room)}&name=${encodeURIComponent(this.name)}&team=${this.team}&id=${encodeURIComponent(this.id)}` });
    }
    for (const b of BROKERS) hosts.push({ type: 'mqtt', url: b });

    for (const h of hosts) {
      if (this.closed) break;
      this.onStatus(h.type === 'ws' ? 'Yerel röleye bağlanılıyor…' : 'Genel ağa bağlanılıyor…', 'connecting');
      let t = null;
      try {
        t = h.type === 'ws' ? new WSTransport(this, h.url) : new MQTTTransport(this, h.url);
        await t.connect();
        this.transport = t;
        this.mode = h.type;
        this.onStatus(h.type === 'ws' ? 'Yerel röle bağlı' : 'Çevrimiçi oda bağlı', h.type);
        this._startHeartbeat();
        if (isReconnect) this.onMessage({ t: 'reconnected', from: 'system', room: this.room });
        return { mode: h.type };
      } catch (e) {
        try { t?.close(); } catch {}
        console.info('[ağ] bağlantı başarısız:', h.url, e?.message || e);
      }
    }
    this.mode = 'offline';
    this.transport = null;
    this.onStatus('Çevrimdışı mod — botlar devrede', 'offline');
    // Yavaş açılan yerel röleler için bir süre sonra tekrar dene
    if (!this.closed && this.offlineRetries < 2 && this.preferLocal && !location.hostname.endsWith('github.io')) {
      this.offlineRetries++;
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => {
        if (!this.closed && this.mode === 'offline') this.connect(true).catch(() => {});
      }, 7500);
    }
    return { mode: 'offline' };
  }

  close() {
    this.closed = true;
    this._stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.retryTimer);
    try { this._sendRaw({ t: 'bye', room: this.room }); } catch {}
    try { this.transport?.close(); } catch {}
    this.transport = null;
  }
}
