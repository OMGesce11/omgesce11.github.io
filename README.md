# SAVAŞ ALANI — 3D Multiplayer Savaş Oyunu

Tarayıcıda direkt çalışan, **gerçek zamanlı çok oyunculu** bir 3D takım ölüm maçı oyunu.
Üç boyutlu animasyonlu askerler, prosedürel PBR dokular, dinamik gölgeler, bloom,
parçacık efektleri, 3 farklı silah, el bombası, mini harita, skor tablosu ve sohbet içerir.
**Kurulum gerektirmez, derleme adımı yoktur, tüm dosyalar statiktir.**

## 🚀 Hızlı başlangıç

```bash
node server/server.js
# veya
npm start
```

Tarayıcıdan `http://localhost:3000` adresine git. Aynı adresi **ikinci bir sekmede** açtığında
iki oyuncu aynı savaş alanında karşılaşır (yerel WebSocket rölesi sayesinde).

> Sadece statik dosya sunucusu da yeterlidir: `python3 -m http.server 3000`.
> Bu durumda oyun otomatik olarak genel MQTT rölelerine bağlanmayı dener.

## 🌐 GitHub Pages (statik yayın)

Depo `omgesce11.github.io` olduğu için `index.html` doğrudan yayınlanır. Sunucu tarafı kod
çalıştırılamadığı için oyun şu sırayla bağlanır:

1. **Aynı origin `/ws` rölesi** — kendi `server/server.js` sunucunuz için (en hızlı).
2. **Genel MQTT-over-WebSocket brokerları** — hiç ayar gerektirmez, HTTPS ile uyumlu.
3. **Çevrimdışı mod** — hiçbirine ulaşılamazsa botlar devreye girer.

Ayarlar → *Özel röle sunucusu* alanına kendi `wss://...` adresinizi yazabilirsiniz.
Ayrıca `?room=KOD` parametresiyle özel oda bağlantısı paylaşılabilir:
`https://omgesce11.github.io/?room=ATLAS`.

## 🎮 Kontroller

| Tuş | İşlev | Tuş | İşlev |
|---|---|---|---|
| `W A S D` | Hareket | `Sol tık` | Ateş |
| `Shift` | Koş | `Sağ tık` | Nişan al (ADS) |
| `Ctrl / C` | Çömel | `R` | Şarjör değiştir |
| `Boşluk` | Zıpla | `G` | El bombası |
| `1 2 3` / `Q` / `Tekerlek` | Silah değiştir | `Tab` | Skor tablosu |
| `Enter` | Sohbet | `Esc` | Duraklat |

Mobil cihazlarda ekrandaki sanal joystick ve butonlar otomatik görünür.

## 🧱 Yapı

```
index.html            Menü, HUD, skor tablosu, ayarlar
css/style.css         Tüm arayüz (Rajdhani + Teko fontları)
js/main.js            Menü/ayarlar/yaşam döngüsü
js/game.js            3B motor, oyun mantığı, ağ eşitlemesi
js/world.js           Prosedürel şehir haritası, ışıklar, çarpışma kutuları
js/textures.js        PBR renk + normal harita üretimi (canvas)
js/soldier.js         GLTF asker, animasyon karışımı, teçhizat, isim etiketi
js/weapons.js         Silah tanımları, birinci şahıs silah modeli, animasyon
js/player.js          Yerel oyuncu fiziği, nişan alma, geri tepme
js/fighter.js         Ortak savaşçı durumu ve interpolasyon
js/bots.js            Yapay zekâ düşmanlar
js/effects.js         Parçacıklar, izli mermi, patlama, dekal, kovan
js/audio.js           WebAudio ile sentezlenen sesler
js/net.js             WebSocket + MQTT taşıma katmanları, oda/oyuncu keşfi
js/ui.js              HUD, mini harita, öldürme bildirimleri, sohbet
server/server.js      Bağımlılıksız statik sunucu + WebSocket röle
vendor/               Three.js r186, seçili addon'lar, MQTT.js (hepsi yerel)
assets/               Asker GLB modeli, fontlar
```

## ⚙️ Ağ protokolü (özet)

Tüm mesajlar JSON'dur ve oda başına tek bir kanala yayınlanır. `hello`/`bye` oyuncu keşfi,
`s` 15 Hz durum (konum, yön, can, silah), `f` atış, `h` isabet, `x` ölüm, `k` öldürme,
`g` bomba, `boom` patlama, `c` sohbet, `ping`/`pong` gecikme ölçümü.
İsabet/ölüm yetkisi vurulan oyuncunun istemcisindedir; öldürme sayısı öldürenin
istemcisinden gelir ve `victim:deaths` anahtarıyla çift sayım önlenir.

## 📜 Lisans ve krediler

Bkz. [CREDITS.md](CREDITS.md). Oyunun kendisi MIT lisanslıdır.
