import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { matFrom, cloneTiled } from './textures.js';
import { mulberry32, rayAABB, clamp } from './util.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

// UV'leri fiziksel boyuta göre ölçekler: tek materyal ile her yüzde doğru doku yoğunluğu
function tiledBox(w, h, d, unit = 3) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = dims[f];
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * (su / unit), uv.getY(k) * (sv / unit));
    }
  }
  uv.needsUpdate = true;
  return g;
}

export function createWorld(scene, T, quality = 'high') {
  const rnd = mulberry32(20261027);
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const animated = [];

  const M = {
    concrete: matFrom(T.concrete, { normalScale: 0.8 }),
    facade: matFrom(T.facade, { normalScale: 0.6 }),
    brick: matFrom(T.brick, { normalScale: 0.8 }),
    metal: matFrom(T.metal, { roughness: 0.72, metalness: 0.42 }),
    metalBlue: matFrom(T.metal, { color: 0xb6d3e6, roughness: 0.72, metalness: 0.35 }),
    metalRed: matFrom(T.metal, { color: 0xefb9a2, roughness: 0.72, metalness: 0.35 }),
    gunmetal: matFrom(T.gunmetal, { roughness: 0.42, metalness: 0.85, normalScale: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x25282a, roughness: 0.6, metalness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 }),
    crate: matFrom(T.crate, { normalScale: 0.7 }),
    sandbag: matFrom(T.sandbag, { normalScale: 0.8 }),
    asphalt: matFrom(T.asphalt, { normalScale: 0.5 }),
    fabric: matFrom(T.fabric, { normalScale: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c2a30, roughness: 0.18, metalness: 0.55 }),
    rust: new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.94 }),
    light: new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffcc66, emissiveIntensity: 2.2, roughness: 0.3 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x2d6fa8, roughness: 0.65, metalness: 0.15 }),
    red: new THREE.MeshStandardMaterial({ color: 0xa8362c, roughness: 0.65, metalness: 0.15 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4a5238, roughness: 0.9 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x9b8a63, roughness: 0.85 }),
  };

  const cache = new Map();
  function box(x, y, z, w, h, d, mat, opts = {}) {
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${w},${h},${d},${opts.ry || 0}`;
    const geo = tiledBox(w, h, d, opts.unit ?? 3);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    mesh.userData.key = key;
    group.add(mesh);
    if (opts.collide !== false) {
      let hw = w / 2, hd = d / 2;
      if (opts.ry) {
        // Döndürülmüş kutular için eksen hizalı sınır kutusu (dar sokaklar için yeterli)
        const c = Math.abs(Math.cos(opts.ry)), s = Math.abs(Math.sin(opts.ry));
        hw = (w / 2) * c + (d / 2) * s;
        hd = (w / 2) * s + (d / 2) * c;
      }
      colliders.push({
        min: V3(x - hw, y - h / 2, z - hd),
        max: V3(x + hw, y + h / 2, z + hd),
        mesh, type: opts.type || 'solid',
      });
    }
    return mesh;
  }

  function cyl(x, y, z, rt, rb, h, mat, seg = 12, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    mesh.position.set(x, y, z);
    if (opts.rx) mesh.rotation.x = opts.rx;
    if (opts.rz) mesh.rotation.z = opts.rz;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    if (opts.collide) colliders.push({ min: V3(x - rt, y - h / 2, z - rt), max: V3(x + rt, y + h / 2, z + rt), mesh, type: 'solid' });
    return mesh;
  }

  // ----------------------------- ZEMİN -----------------------------
  const groundMat = matFrom(cloneTiled(T.ground, 1, 1), { normalScale: 0.45, roughness: 1 });
  const ground = new THREE.Mesh(tiledBox(300, 2, 300, 2), groundMat);
  ground.position.y = -1;
  ground.receiveShadow = true; ground.castShadow = false;
  group.add(ground);

  // Ana yol (asfalt) + kaldırımlar
  const road = new THREE.Mesh(tiledBox(10, 0.08, 140, 4), M.asphalt);
  road.position.set(0, 0.045, 0); road.receiveShadow = true; group.add(road);
  const road2 = road.clone(); road2.rotation.y = Math.PI / 2; road2.position.set(0, 0.05, 0); group.add(road2);

  // Yol şeritleri
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8c79a, roughness: 1 });
  for (let z = -66; z < 66; z += 8) {
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 3.6), stripeMat);
    s1.rotation.x = -Math.PI / 2; s1.position.set(0, 0.095, z); group.add(s1);
    const s2 = s1.clone(); s2.rotation.z = Math.PI / 2; s2.position.set(z, 0.095, 0); group.add(s2);
  }

  // ----------------------------- GÖKYÜZÜ / IŞIK -----------------------------
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const sunElev = 9, sunAzim = 300;
  const phi = THREE.MathUtils.degToRad(90 - sunElev);
  const theta = THREE.MathUtils.degToRad(sunAzim);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms.turbidity.value = 6;
  sky.material.uniforms.rayleigh.value = 1.85;
  sky.material.uniforms.mieCoefficient.value = 0.0045;
  sky.material.uniforms.mieDirectionalG.value = 0.76;
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  scene.add(sky);

  scene.fog = new THREE.FogExp2(0xc9ae89, 0.0062);
  const hemi = new THREE.HemisphereLight(0xbcd3f2, 0x7a5b39, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdcae, 3.1);
  sun.position.copy(sunDir).multiplyScalar(90);
  sun.castShadow = quality !== 'low';
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  sun.shadow.camera.left = -85; sun.shadow.camera.right = 85;
  sun.shadow.camera.top = 85; sun.shadow.camera.bottom = -85;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 260;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x88a9d0, 0.42);
  fill.position.set(-60, 40, -40); scene.add(fill);

  // ----------------------------- ÇEVRE DUVARLARI -----------------------------
  const HALF = 72;
  box(0, 4.5, -HALF, HALF * 2 + 4, 9, 2.4, M.concrete, { unit: 8 });
  box(0, 4.5, HALF, HALF * 2 + 4, 9, 2.4, M.concrete, { unit: 8 });
  box(-HALF, 4.5, 0, 2.4, 9, HALF * 2 + 4, M.concrete, { unit: 8 });
  box(HALF, 4.5, 0, 2.4, 9, HALF * 2 + 4, M.concrete, { unit: 8 });
  // Duvar üstü teller / direkler
  for (let i = -HALF; i <= HALF; i += 12) {
    cyl(i, 10.2, -HALF, 0.07, 0.07, 2.4, M.dark, 6);
    cyl(i, 10.2, HALF, 0.07, 0.07, 2.4, M.dark, 6);
  }

  // ----------------------------- YAPILAR -----------------------------
  function building(x, z, w, d, h, opts = {}) {
    const mat = opts.mat || M.facade;
    box(x, h / 2, z, w, h, d, mat, { type: 'building', unit: opts.mat === M.brick ? 6 : 9 });
    // çatı
    box(x, h + 0.18, z, w + 0.5, 0.36, d + 0.5, M.concrete, { collide: false });
    // korkuluk
    if (opts.parapet !== false) {
      box(x, h + 0.65, z - d / 2, w, 0.9, 0.35, M.concrete, { collide: false });
      box(x, h + 0.65, z + d / 2, w, 0.9, 0.35, M.concrete, { collide: false });
      box(x - w / 2, h + 0.65, z, 0.35, 0.9, d, M.concrete, { collide: false });
      box(x + w / 2, h + 0.65, z, 0.35, 0.9, d, M.concrete, { collide: false });
    }
    // Kapı
    const door = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.8), M.dark);
    door.position.set(x + (opts.doorX || 0), 1.4, z + d / 2 + 0.012); group.add(door);
    const frame = box(x + (opts.doorX || 0), 2.85, z + d / 2 + 0.08, 2.6, 0.22, 0.3, M.concrete, { collide: false });
    // Klima / boru / anten detayları
    for (let i = 0; i < (opts.ac ?? 3); i++) {
      const ax = x - w / 2 + 1.6 + rnd() * (w - 3.2);
      const ay = 2.2 + Math.floor(rnd() * Math.max(1, h / 3)) * 2.6;
      box(ax, ay, z + d / 2 + 0.18, 0.95, 0.7, 0.45, M.metal, { collide: false });
    }
    if (h > 8) {
      cyl(x + w / 2 - 1.5, h + 2.1, z - d / 2 + 1.5, 0.045, 0.06, 3.6, M.dark, 6);
      const dish = new THREE.Mesh(new THREE.SphereGeometry(0.85, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.concrete);
      dish.position.set(x - w / 2 + 2, h + 0.7, z + 1.6);
      dish.rotation.x = Math.PI * 0.75; group.add(dish);
    }
    // cephede yıkık beton parçaları
    for (let i = 0; i < 4; i++) {
      const px = x + (rnd() - 0.5) * w * 0.9;
      box(px, 0.18 + rnd() * 0.25, z + d / 2 + 0.45 + rnd() * 0.8, 0.5 + rnd() * 1.4, 0.25 + rnd() * 0.5, 0.4 + rnd(), M.concrete, { collide: false, ry: rnd() });
    }
  }

  building(-34, -34, 22, 18, 12, { mat: M.facade });
  building(34, 34, 22, 18, 12, { mat: M.brick });
  building(34, -34, 20, 20, 9, { mat: M.facade });
  building(-34, 34, 20, 20, 9, { mat: M.brick });
  building(0, -48, 16, 12, 7.5, { mat: M.concrete });
  building(0, 48, 16, 12, 7.5, { mat: M.concrete });
  building(-48, 0, 12, 16, 8, { mat: M.brick });
  building(48, 0, 12, 16, 8, { mat: M.facade });
  // Merkezdeki L biçimli harabe binalar
  building(-16, -14, 14, 10, 10, { mat: M.concrete, parapet: false });
  building(16, 14, 14, 10, 10, { mat: M.concrete, parapet: false });

  // ----------------------------- MERKEZ: TANK -----------------------------
  function tank(x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, 0, z); g.rotation.y = ry;
    group.add(g);
    const add = (w, h, d, px, py, pz, mat, rx = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(px, py, pz); m.rotation.x = rx;
      m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    };
    // paletler
    for (const s of [-1, 1]) {
      add(1.1, 1.05, 7.2, s * 2.05, 0.6, 0, M.rubber);
      for (let i = -3; i <= 3; i++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 14), M.gunmetal);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(s * 2.05, 0.52, i * 1.0); wheel.castShadow = true; g.add(wheel);
      }
    }
    // gövde
    add(3.5, 1.15, 6.6, 0, 1.15, 0, M.olive);
    add(3.9, 0.5, 4.6, 0, 1.85, -0.3, M.olive);
    add(3.6, 0.3, 1.8, 0, 1.9, 2.4, M.tan, -0.16);
    // taret
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.05, 1.1, 8), M.olive);
    turret.position.set(0, 2.45, -0.3); turret.castShadow = true; g.add(turret);
    add(2.6, 0.5, 2.3, 0, 2.95, -0.9, M.olive);
    // namlu
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 5.2, 12), M.gunmetal);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 2.5, -4.3); barrel.castShadow = true; g.add(barrel);
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 12), M.dark);
    muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 2.5, -6.7); g.add(muzzle);
    // detaylar
    cyl(0.9, 3.2, 0.4, 0.28, 0.28, 0.7, M.gunmetal, 10);
    for (let i = 0; i < 4; i++) add(0.12, 0.12, 0.5, -1.2 + i * 0.8, 3.1, 0.4, M.dark);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 3.4, 5), M.dark);
    ant.position.set(1.2, 4.4, 1.1); g.add(ant);
    colliders.push({ min: V3(x - 3.4, 0, z - 4.6), max: V3(x + 3.4, 3.4, z + 4.6), mesh: g, type: 'tank' });
  }
  tank(-2.5, 2.5, 0.42);

  // ----------------------------- KONTEYNER / BARİYER / SANDIK -----------------------------
  function container(x, z, y, ry, mat) {
    const w = 6.1, h = 2.6, d = 2.44;
    box(x, y + h / 2, z, w, h, d, mat, { ry, unit: 2.2 });
    // köşe direkleri
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = x + (sx * w / 2) * Math.cos(ry) + (sz * d / 2) * Math.sin(ry);
      const pz = z - (sx * w / 2) * Math.sin(ry) + (sz * d / 2) * Math.cos(ry);
      box(px, y + h / 2, pz, 0.16, h, 0.16, M.gunmetal, { collide: false });
    }
  }
  container(-22, 6, 0, 0.12, M.metalBlue);
  container(-22, 6, 2.6, -0.06, M.metalRed);
  container(23, -6, 0, Math.PI / 2 + 0.1, M.metal);
  container(23, -9.2, 0, Math.PI / 2 - 0.08, M.metalBlue);
  container(-46, -20, 0, 0, M.metalRed);
  container(46, 20, 0, 0, M.metal);
  container(8, 40, 0, 0.3, M.metalRed);
  container(-8, -40, 0, -0.3, M.metalBlue);

  function barrier(x, z, ry, len = 2.4) {
    box(x, 0.55, z, len, 1.1, 0.62, M.concrete, { ry, unit: 1.6 });
    box(x, 1.14, z, len + 0.05, 0.1, 0.72, M.concrete, { ry, collide: false, unit: 1.6 });
  }
  for (let i = -4; i <= 4; i++) {
    if (Math.abs(i) < 1) continue;
    barrier(i * 2.55, -12, 0);
    barrier(i * 2.55, 12, 0);
    barrier(-12, i * 2.55, Math.PI / 2);
    barrier(12, i * 2.55, Math.PI / 2);
  }
  for (let i = 0; i < 6; i++) {
    barrier(-58 + i * 2.5, -50, 0.3);
    barrier(58 - i * 2.5, 50, -0.3);
  }

  function sandbags(x, z, ry, len = 4, rows = 2) {
    const n = Math.max(2, Math.floor(len / 0.85));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < n - (r % 2); i++) {
        const u = (i + (r % 2 ? 0.5 : 0)) * (len / n) - len / 2 + len / (2 * n);
        const px = x + u * Math.cos(ry), pz = z - u * Math.sin(ry);
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), M.sandbag);
        m.scale.set(1.2, 0.42, 0.62);
        m.position.set(px, 0.22 + r * 0.36, pz);
        m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true;
        group.add(m);
      }
    }
    colliders.push({
      min: V3(x - Math.abs(len / 2 * Math.cos(ry)) - 0.6, 0, z - Math.abs(len / 2 * Math.sin(ry)) - 0.6),
      max: V3(x + Math.abs(len / 2 * Math.cos(ry)) + 0.6, rows * 0.38, z + Math.abs(len / 2 * Math.sin(ry)) + 0.6),
      type: 'sandbag',
    });
  }
  sandbags(-30, 0, 0, 5, 2);
  sandbags(30, 0, 0, 5, 2);
  sandbags(0, -25, Math.PI / 2, 5, 2);
  sandbags(0, 25, Math.PI / 2, 5, 2);

  function crate(x, y, z, s = 1.2) {
    box(x, y + s / 2, z, s, s, s, M.crate, { unit: 1.3, type: 'crate' });
    const e = 0.07;
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      box(x, y + s / 2 + sy * (s / 2 - e), z + sz * (s / 2 - e), s, e, e, M.dark, { collide: false });
    }
  }
  const crateSpots = [
    [-10, -26], [-8.6, -26.2], [-9.3, -27.4], [11, 26], [12.3, 26.4], [11.4, 27.6],
    [-40, -8], [-38.7, -8.1], [40, 8], [41.3, 8.2], [-20, 30], [21, -30],
    [-55, -30], [55, 30], [-30, -52], [30, 52],
  ];
  for (const [x, z] of crateSpots) crate(x, 0, z, 1.2);
  crate(-10, 1.2, -26, 1.2);

  function barrel(x, z, color) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12), color || M.rust);
    m.position.set(x, 0.58, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
    for (const yy of [0.25, 0.9]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.035, 6, 14), M.gunmetal);
      ring.rotation.x = Math.PI / 2; ring.position.set(x, yy, z); group.add(ring);
    }
    colliders.push({ min: V3(x - 0.45, 0, z - 0.45), max: V3(x + 0.45, 1.15, z + 0.45), type: 'barrel' });
  }
  [[-6, -18], [-5, -18.6], [6, 18], [7, 18.7], [-44, 12], [44, -12], [26, -40], [-26, 40]].forEach(([x, z], i) => barrel(x, z, i % 3 === 0 ? M.metalBlue : M.rust));

  // ----------------------------- GÖZETLEME KULESİ -----------------------------
  function tower(x, z, ry) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      box(x + sx * 1.9, 3, z + sz * 1.9, 0.22, 6, 0.22, M.gunmetal, { collide: false });
    }
    box(x, 6.1, z, 5, 0.3, 5, M.crate, { collide: false, unit: 1.5 });
    for (const sx of [-1, 1]) {
      box(x + sx * 2.4, 6.75, z, 0.16, 1.1, 5, M.gunmetal, { collide: false });
      box(x, 6.75, z + sx * 2.4, 5, 1.1, 0.16, M.gunmetal, { collide: false });
    }
    box(x, 8.1, z, 5.4, 0.22, 5.4, M.metal, { collide: false });
    // merdiven basamakları (erişilebilir çatı)
    for (let i = 0; i < 12; i++) {
      box(x - 2.6, 0.3 + i * 0.5, z + 2.2 - i * 0.32, 0.9, 0.18, 0.35, M.gunmetal, { collide: false });
    }
    colliders.push({ min: V3(x - 2.5, 5.9, z - 2.5), max: V3(x + 2.5, 6.25, z + 2.5), type: 'platform' });
  }
  tower(-20, -48, 0);
  tower(20, 48, Math.PI);

  // ----------------------------- LAMBA DİREKLERİ -----------------------------
  function lamp(x, z) {
    cyl(x, 3.6, z, 0.09, 0.13, 7.2, M.gunmetal, 8);
    box(x, 7.2, z, 1.4, 0.12, 0.14, M.gunmetal, { collide: false });
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), M.light);
    l.position.set(x + 0.55, 7.08, z); group.add(l);
    const pl = new THREE.PointLight(0xffcc88, 0, 16);
    pl.position.set(x + 0.55, 7, z); group.add(pl);
  }
  [[-16, -58], [16, -58], [-16, 58], [16, 58], [-58, -16], [58, 16]].forEach(([x, z]) => lamp(x, z));

  // ----------------------------- ÜS BAYRAKLARI -----------------------------
  function flag(x, z, color) {
    cyl(x, 4.5, z, 0.09, 0.12, 9, M.gunmetal, 8);
    const geo = new THREE.PlaneGeometry(3.2, 1.9, 12, 6);
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
    cloth.position.set(x + 1.6, 7.9, z); cloth.castShadow = true;
    group.add(cloth);
    animated.push({ cloth, base: geo.attributes.position.array.slice(), phase: rnd() * 10 });
  }
  flag(-60, -60, 0x2f74c0);
  flag(60, 60, 0xc0392b);

  // ----------------------------- MOLoz / ENKAZ -----------------------------
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, r = 16 + rnd() * 50;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = 0.25 + rnd() * 0.9;
    box(x, s * 0.22, z, s, s * 0.44, s * (0.6 + rnd()), rnd() > 0.5 ? M.concrete : M.brick, { collide: false, ry: rnd() * 3 });
  }
  // Yıkılmış duvar parçaları
  for (let i = 0; i < 8; i++) {
    const x = (rnd() - 0.5) * 90, z = (rnd() - 0.5) * 90;
    box(x, 0.7, z, 2 + rnd() * 3, 1.4, 0.5, M.concrete, { ry: rnd() * 3 });
  }

  // ----------------------------- HAVADAKİ TOZ -----------------------------
  const dustCount = quality === 'low' ? 350 : 1100;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (rnd() - 0.5) * 150;
    dustPos[i * 3 + 1] = rnd() * 18;
    dustPos[i * 3 + 2] = (rnd() - 0.5) * 150;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffe0ae, size: 0.11, map: T.soft, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  group.add(dust);

  // ----------------------------- DOĞMA NOKTALARI -----------------------------
  const spawns = {
    blue: [
      [-60, -52, -2.29], [-54, -60, -2.42], [-46, -62, -2.53], [-62, -44, -2.15],
      [-50, -46, -2.33], [-40, -56, -2.61], [-58, -34, -2.02], [-34, -60, -2.63],
    ],
    red: [
      [60, 52, 0.85], [54, 60, 0.98], [46, 62, 1.09], [62, 44, 0.71],
      [50, 46, 0.89], [40, 56, 1.17], [58, 34, 0.58], [34, 60, 1.19],
    ],
  };

  let time = 0;
  function update(dt) {
    time += dt;
    for (const a of animated) {
      const p = a.cloth.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = a.base[i * 3], y = a.base[i * 3 + 1];
        p.setZ(i, Math.sin(x * 2.2 + time * 3.2 + a.phase) * 0.16 * (x + 1.6) / 3.2 + y * 0.02);
      }
      p.needsUpdate = true;
    }
    dust.rotation.y += dt * 0.006;
    const dp = dustGeo.attributes.position;
    for (let i = 0; i < dp.count; i += 3) {
      dp.array[i * 3] += dt * 0.32;
      if (dp.array[i * 3] > 75) dp.array[i * 3] = -75;
    }
    dp.needsUpdate = true;
  }

  function raycast(origin, dir, maxDist = 200, filter = null) {
    let best = null;
    for (const c of colliders) {
      if (filter && filter(c)) continue;
      const hit = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, c.min, c.max, maxDist);
      if (hit && hit.t > 0.0001 && (!best || hit.t < best.t)) {
        best = {
          t: hit.t, collider: c, type: c.type,
          point: origin.clone().addScaledVector(dir, hit.t),
          normal: V3(hit.nx, hit.ny, hit.nz),
        };
      }
    }
    // zemin
    if (dir.y < -1e-6) {
      const t = -origin.y / dir.y;
      if (t > 0 && t < maxDist && (!best || t < best.t)) {
        best = { t, collider: null, type: 'ground', point: origin.clone().addScaledVector(dir, t), normal: V3(0, 1, 0) };
      }
    }
    return best;
  }

  // Ayak altındaki en yüksek yüzey (merdiven / sandık üstüne çıkma)
  function floorAt(x, z, feetY, radius = 0.38, step = 0.62) {
    let h = 0;
    for (const c of colliders) {
      if (c.max.y <= h || c.max.y > feetY + step || c.max.y < feetY - 1.6) continue;
      if (x + radius < c.min.x || x - radius > c.max.x || z + radius < c.min.z || z - radius > c.max.z) continue;
      h = c.max.y;
    }
    return h;
  }

  return {
    group, colliders, spawns, update, raycast, floorAt, sun, sky, sunDir,
    half: HALF,
    dispose() {
      scene.remove(group, sky, hemi, sun, fill, sun.target);
      group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    },
  };
}
