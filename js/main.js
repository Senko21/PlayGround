import * as THREE from 'three';

// ---------- Константы ----------
const WORLD_X = 32, WORLD_Z = 32, WORLD_Y = 24;
const REACH = 8;

const B = { GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, PLANKS: 6, SAND: 7 };
const BLOCK_INFO = {
  [B.GRASS]:  { name: 'Трава' },
  [B.DIRT]:   { name: 'Земля' },
  [B.STONE]:  { name: 'Камень' },
  [B.LOG]:    { name: 'Дерево' },
  [B.LEAVES]: { name: 'Листва' },
  [B.PLANKS]: { name: 'Доски' },
  [B.SAND]:   { name: 'Песок' },
};
const HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.LOG, B.LEAVES, B.PLANKS];
let selected = 0;

// ---------- Состояние мира ----------
const voxels = new Map(); // "x,y,z" -> blockId
const key = (x, y, z) => x + ',' + y + ',' + z;
const getBlock = (x, y, z) => voxels.get(key(x, y, z)) || 0;
const isSolid = (x, y, z) => voxels.has(key(Math.floor(x), Math.floor(y), Math.floor(z)));

function heightAt(x, z) {
  return 5 + Math.floor(
    2 * Math.sin(x * 0.35) * Math.cos(z * 0.35) +
    1.5 * Math.sin(x * 0.12 + 1.3) * Math.cos(z * 0.14 + 0.7)
  );
}

function generateWorld(seed = Math.floor(Math.random() * 1e9)) {
  voxels.clear();
  // простой детерминированный шум от seed
  const rnd = mulberry(seed);
  for (let x = 0; x < WORLD_X; x++) {
    for (let z = 0; z < WORLD_Z; z++) {
      const h = heightAt(x, z);
      for (let y = 0; y <= h; y++) {
        let t;
        if (y === 0) t = B.STONE; // несгораемое дно
        else if (y === h) t = B.GRASS;
        else if (y >= h - 2) t = B.DIRT;
        else t = B.STONE;
        voxels.set(key(x, y, z), t);
      }
      // песчаная полоса у низких уровней
      if (h <= 4) voxels.set(key(x, h, z), B.SAND);
    }
  }
  // деревья
  for (let i = 0; i < 14; i++) {
    const x = 3 + Math.floor(rnd() * (WORLD_X - 6));
    const z = 3 + Math.floor(rnd() * (WORLD_Z - 6));
    const h = heightAt(x, z);
    if (getBlock(x, h, z) !== B.GRASS) continue;
    const trunk = 3 + Math.floor(rnd() * 2);
    for (let y = 1; y <= trunk; y++) voxels.set(key(x, h + y, z), B.LOG);
    const top = h + trunk;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          if (dy === 1 && (Math.abs(dx) > 1 || Math.abs(dz) > 1)) continue;
          const p = key(x + dx, top + dy, z + dz);
          if (!voxels.has(p)) voxels.set(p, B.LEAVES);
        }
    voxels.set(key(x, top + 1, z), B.LEAVES);
  }
  saveWorld(seed);
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function saveWorld(seed) {
  try {
    localStorage.setItem('mini-mc', JSON.stringify({ seed, blocks: [...voxels] }));
  } catch {}
}
function loadWorld() {
  try {
    const raw = localStorage.getItem('mini-mc');
    if (!raw) return false;
    const data = JSON.parse(raw);
    voxels.clear();
    for (const [k, v] of data.blocks) voxels.set(k, v);
    return true;
  } catch { return false; }
}

// ---------- Three.js сцена ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 30, 90);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 300);

scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x6b8e4e, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 50, 20);
sun.castShadow = true;
sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

// ---------- Процедурные пиксельные текстуры ----------
function pixelTexture(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(g, base, vary) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = (Math.random() - 0.5) * vary;
      g.fillStyle = shade(base, v);
      g.fillRect(x, y, 1, 1);
    }
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r|0},${g|0},${b|0})`;
}
const TEX = {
  grassTop: pixelTexture(g => noiseFill(g, '#5fae3f', 26)),
  grassSide: pixelTexture(g => {
    noiseFill(g, '#7a5230', 22);
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) { g.fillStyle = shade('#5fae3f', (Math.random() - .5) * 26); g.fillRect(x, y, 1, 1); }
  }),
  dirt: pixelTexture(g => noiseFill(g, '#7a5230', 24)),
  stone: pixelTexture(g => noiseFill(g, '#8a8a8a', 18)),
  logSide: pixelTexture(g => {
    noiseFill(g, '#5b3d22', 16);
    g.fillStyle = '#4a3119';
    for (const x of [2, 6, 10, 13]) g.fillRect(x, 0, 1, 16);
  }),
  logTop: pixelTexture(g => {
    noiseFill(g, '#a0824f', 14);
    g.strokeStyle = '#5b3d22'; g.lineWidth = 1;
    g.strokeRect(1.5, 1.5, 13, 13); g.strokeRect(4.5, 4.5, 7, 7);
  }),
  leaves: pixelTexture(g => {
    noiseFill(g, '#2f7d26', 34);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 24; i++) g.fillRect(Math.random() * 16 | 0, Math.random() * 16 | 0, 1, 1);
  }),
  planks: pixelTexture(g => {
    noiseFill(g, '#a67c3f', 14);
    g.fillStyle = '#7d5a28';
    for (let y = 3; y < 16; y += 4) g.fillRect(0, y, 16, 1);
  }),
  sand: pixelTexture(g => noiseFill(g, '#dcd29a', 16)),
};
function mat(tex, opts = {}) {
  return new THREE.MeshLambertMaterial({ map: tex, ...opts });
}
const MATERIALS = {
  [B.GRASS]: [mat(TEX.grassSide), mat(TEX.grassSide), mat(TEX.grassTop), mat(TEX.dirt), mat(TEX.grassSide), mat(TEX.grassSide)],
  [B.DIRT]: Array(6).fill(mat(TEX.dirt)),
  [B.STONE]: Array(6).fill(mat(TEX.stone)),
  [B.LOG]: [mat(TEX.logSide), mat(TEX.logSide), mat(TEX.logTop), mat(TEX.logTop), mat(TEX.logSide), mat(TEX.logSide)],
  [B.LEAVES]: Array(6).fill(mat(TEX.leaves, { transparent: true, opacity: 0.95, alphaTest: 0.3, side: THREE.DoubleSide })),
  [B.PLANKS]: Array(6).fill(mat(TEX.planks)),
  [B.SAND]: Array(6).fill(mat(TEX.sand)),
};

// ---------- Рендер вокселей через InstancedMesh ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
let chunkGroup = new THREE.Group();
scene.add(chunkGroup);
const dummy = new THREE.Object3D();

function hasNeighbor(x, y, z) { return voxels.has(key(x, y, z)); }

function rebuildChunks() {
  scene.remove(chunkGroup);
  chunkGroup.traverse(o => { if (o.isInstancedMesh) o.dispose(); });
  chunkGroup = new THREE.Group();
  scene.add(chunkGroup);

  const perType = new Map();
  for (const [k, t] of voxels) {
    const [x, y, z] = k.split(',').map(Number);
    if (hasNeighbor(x+1,y,z) && hasNeighbor(x-1,y,z) &&
        hasNeighbor(x,y+1,z) && hasNeighbor(x,y-1,z) &&
        hasNeighbor(x,y,z+1) && hasNeighbor(x,y,z-1)) continue; // скрыт полностью
    if (!perType.has(t)) perType.set(t, []);
    perType.get(t).push([x, y, z]);
  }
  for (const [t, list] of perType) {
    const mats = MATERIALS[t] || MATERIALS[B.STONE];
    const im = new THREE.InstancedMesh(boxGeo, mats, list.length);
    im.castShadow = true; im.receiveShadow = true;
    list.forEach(([x, y, z], i) => {
      dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    chunkGroup.add(im);
  }
  window.__sceneReady = true;
}

// подсветка выбранного блока
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })
);
highlight.visible = false;
scene.add(highlight);

// ---------- Игрок / управление ----------
const player = {
  pos: new THREE.Vector3(WORLD_X / 2 + 0.5, 12, WORLD_Z / 2 + 0.5),
  vel: new THREE.Vector3(),
  yaw: Math.PI * 0.25, pitch: -0.1,
  onGround: false, fly: false,
};
const P_HALF = 0.3, P_HEIGHT = 1.8, EYE = 1.62;

function spawn() {
  const cx = WORLD_X >> 1, cz = WORLD_Z >> 1;
  player.pos.set(cx + 0.5, heightAt(cx, cz) + 2.5, cz + 0.5);
  player.vel.set(0, 0, 0);
}

const keysDown = new Set();
addEventListener('keydown', e => {
  if (e.code === 'Digit1') selectSlot(0);
  if (e.code === 'Digit2') selectSlot(1);
  if (e.code === 'Digit3') selectSlot(2);
  if (e.code === 'Digit4') selectSlot(3);
  if (e.code === 'Digit5') selectSlot(4);
  if (e.code === 'Digit6') selectSlot(5);
  if (e.code === 'KeyF') { player.fly = !player.fly; player.vel.y = 0; toast(player.fly ? '✈️ Режим полёта включён' : '🚶 Обычный режим'); }
  if (e.code === 'KeyR' && !e.repeat) { generateWorld(); rebuildChunks(); spawn(); toast('🌍 Новый мир создан'); }
  keysDown.add(e.code);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keysDown.delete(e.code));

const menu = document.getElementById('menu');
document.getElementById('play').onclick = () => canvas.requestPointerLock();
document.addEventListener('pointerlockchange', () => {
  menu.classList.toggle('hidden', document.pointerLockElement === canvas);
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch -= e.movementY * 0.0025;
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});

function forwardVector() {
  return new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
}

// столкновение AABB игрока с вокселями
function collides(px, py, pz) {
  const minX = px - P_HALF, maxX = px + P_HALF;
  const minY = py, maxY = py + P_HEIGHT;
  const minZ = pz - P_HALF, maxZ = pz + P_HALF;
  for (let x = Math.floor(minX); x <= Math.floor(maxX); x++)
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++)
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++)
        if (voxels.has(key(x, y, z))) {
          // точная проверка пересечения боксов
          if (maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1)
            return true;
        }
  return false;
}

function movePlayer(dt) {
  const speed = player.fly ? 10 : (keysDown.has('ShiftLeft') ? 7 : 4.5);
  const fwd = forwardVector();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const wish = new THREE.Vector3();
  if (keysDown.has('KeyW')) wish.add(fwd);
  if (keysDown.has('KeyS')) wish.sub(fwd);
  if (keysDown.has('KeyD')) wish.add(right);
  if (keysDown.has('KeyA')) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

  if (player.fly) {
    if (keysDown.has('Space')) wish.y = speed;
    else if (keysDown.has('ShiftLeft')) wish.y = -speed;
    player.pos.x += wish.x * dt; if (collides(...player.pos.toArray())) player.pos.x -= wish.x * dt;
    player.pos.z += wish.z * dt; if (collides(...player.pos.toArray())) player.pos.z -= wish.z * dt;
    player.pos.y += wish.y * dt; if (collides(...player.pos.toArray())) player.pos.y -= wish.y * dt;
    player.pos.y = Math.max(1, Math.min(WORLD_Y + 10, player.pos.y));
  } else {
    // горизонтальное движение по осям раздельно
    player.pos.x += wish.x * dt;
    if (collides(player.pos.x, player.pos.y, player.pos.z)) {
      player.pos.x = (wish.x > 0 ? Math.floor(player.pos.x + P_HALF) - P_HALF - 0.001
                                 : Math.floor(player.pos.x - P_HALF) + 1 + P_HALF + 0.001);
    }
    player.pos.z += wish.z * dt;
    if (collides(player.pos.x, player.pos.y, player.pos.z)) {
      player.pos.z = (wish.z > 0 ? Math.floor(player.pos.z + P_HALF) - P_HALF - 0.001
                                 : Math.floor(player.pos.z - P_HALF) + 1 + P_HALF + 0.001);
    }
    // гравитация
    player.vel.y -= 26 * dt;
    if (player.vel.y < -18) player.vel.y = -18;
    if (keysDown.has('Space') && player.onGround) player.vel.y = 8.5;
    player.pos.y += player.vel.y * dt;
    player.onGround = false;
    if (collides(player.pos.x, player.pos.y, player.pos.z)) {
      if (player.vel.y <= 0) {
        player.pos.y = Math.floor(player.pos.y) + 1;
        player.onGround = true;
      } else {
        player.pos.y = Math.floor(player.pos.y + P_HEIGHT) - P_HEIGHT - 0.001;
      }
      player.vel.y = 0;
    }
    if (player.pos.y < -10) spawn(); // упал за мир
  }

  camera.position.set(player.pos.x, player.pos.y + EYE, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

// ---------- Raycast (DDA) по вокселям ----------
function raycastVoxel(origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  const fx = origin.x - x, fy = origin.y - y, fz = origin.z - z;
  let tMaxX = stepX !== 0 ? (stepX > 0 ? (1 - fx) : fx) * tDeltaX : Infinity;
  let tMaxY = stepY !== 0 ? (stepY > 0 ? (1 - fy) : fy) * tDeltaY : Infinity;
  let tMaxZ = stepZ !== 0 ? (stepZ > 0 ? (1 - fz) : fz) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0, t = 0;
  for (let i = 0; i < 256; i++) {
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
    if (t > maxDist) return null;
    const b = getBlock(x, y, z);
    if (b) return { x, y, z, nx, ny, nz, block: b };
  }
  return null;
}

function playerIntersectsBlock(x, y, z) {
  const minX = player.pos.x - P_HALF, maxX = player.pos.x + P_HALF;
  const minY = player.pos.y, maxY = player.pos.y + P_HEIGHT;
  const minZ = player.pos.z - P_HALF, maxZ = player.pos.z + P_HALF;
  return maxX > x && minX < x + 1 && maxY > y && minY < y + 1 && maxZ > z && minZ < z + 1;
}

canvas.addEventListener('mousedown', e => {
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const hit = raycastVoxel(camera.position, dir, REACH);
  if (!hit) return;
  if (e.button === 0) {
    if (hit.y === 0) { toast('⛏️ Коренная порода не разрушается'); return; } // дно неразрушаемо
    voxels.delete(key(hit.x, hit.y, hit.z));
    rebuildChunks(); saveWorld();
  } else if (e.button === 2) {
    const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
    if (py < 0 || py >= WORLD_Y + 8) return;
    if (getBlock(px, py, pz)) return;
    if (playerIntersectsBlock(px, py, pz)) return;
    voxels.set(key(px, py, pz), HOTBAR[selected]);
    rebuildChunks(); saveWorld();
  }
});
addEventListener('contextmenu', e => e.preventDefault());

// ---------- Хотбар ----------
const hotbarEl = document.getElementById('hotbar');
function blockPreview(id) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const src = { [B.GRASS]: TEX.grassSide, [B.DIRT]: TEX.dirt, [B.STONE]: TEX.stone, [B.LOG]: TEX.logSide, [B.LEAVES]: TEX.leaves, [B.PLANKS]: TEX.planks }[id];
  g.imageSmoothingEnabled = false;
  g.drawImage(src.image, 0, 0, 32, 32);
  return c;
}
HOTBAR.forEach((id, i) => {
  const d = document.createElement('div');
  d.className = 'slot' + (i === 0 ? ' active' : '');
  d.innerHTML = `<b>${i + 1}</b>`;
  d.appendChild(blockPreview(id));
  const label = document.createElement('span');
  label.textContent = BLOCK_INFO[id].name;
  d.appendChild(label);
  d.onclick = () => selectSlot(i);
  hotbarEl.appendChild(d);
});
function selectSlot(i) {
  selected = i;
  document.querySelectorAll('.slot').forEach((el, j) => el.classList.toggle('active', j === i));
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------- Главный цикл ----------
if (!loadWorld()) generateWorld();
rebuildChunks();
spawn();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  movePlayer(dt);
  // подсветка прицела
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const hit = raycastVoxel(camera.position, dir, REACH);
  if (hit) {
    highlight.visible = true;
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  } else highlight.visible = false;
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
