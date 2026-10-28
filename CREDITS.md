# Krediler / Üçüncü taraf bileşenler

| Bileşen | Sürüm | Kaynak | Lisans |
|---|---|---|---|
| Three.js (core + `examples/jsm` addon'ları) | r186.1 | https://github.com/mrdoob/three.js | MIT — `vendor/three/LICENSE` |
| MQTT.js (browser ESM bundle) | 5.16.1 | https://github.com/mqttjs/MQTT.js | MIT (bundle içindeki lisans notları korunmuştur) |
| `Soldier.glb` animasyonlu asker modeli | — | three.js `examples/models/gltf/Soldier.glb` | three.js örnek varlığı (MIT deposu) |
| Rajdhani fontu | 5.3.0 | https://github.com/itfoundry/rajdhani | SIL Open Font License 1.1 — `assets/fonts/LICENSE-rajdhani.txt` |
| Teko fontu | 5.3.0 | https://github.com/itfoundry/teko | SIL Open Font License 1.1 — `assets/fonts/LICENSE-teko.txt` |

Tüm doku, ses, silah/araç/bina modelleri ve oyun kodu bu depo için prosedürel olarak
üretilmiştir; harici görsel/işitsel varlık kullanılmamıştır.

Genel MQTT röleleri (yalnızca yedek taşıma katmanı olarak) üçüncü taraf ücretsiz
servislerdir: `broker.emqx.io`, `broker.hivemq.com`, `test.mosquitto.org`.
Kendi sunucunuzu çalıştırmak için `node server/server.js` yeterlidir.
