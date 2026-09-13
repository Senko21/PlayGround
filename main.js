// МиниКрафт — 2D песочница в стиле Minecraft (Canvas, без зависимостей).
"use strict";

const TILE = 32;
const WORLD_W = 160;
const WORLD_H = 64;
const GRAVITY = 0.55;
const MOVE_SPEED = 3.4;
const JUMP_VEL = -11.2;
const REACH = 6; // радиус взаимодействия в блоках

// id блоков: 0 — воздух
const BLOCKS = {
  1: { name: "Земля",      base: "#8a5a2b", dark: "#6e4520", light: "#a9743d", infinite: false },
  2: { name: "Дёрн",       base: "#6abe30", top: "#7dd63f", dirt: "#8a5a2b", infinite: false },
  3: { name: "Камень",     base: "#7a7a7a", dark: "#5f5f5f", light: "#909090", infinite: false },
  4: { name: "Дерево",     base: "#6b4a26", dark: "#4e3418", light: "#8a6238", infinite: false },
  5: { name: "Листва",     base: "#2f9e2f", dark: "#22701f", light: "#45c245", infinite: false },
  6: { name: "Песок",      base: "#e3d79b", dark: "#c9bd7f", light: "#f2e9bd", infinite: false },
  7: { name: "Доски",      base: "#b08a4f", dark: "#8a683a", light: "#cba56a", infinite: false },
};
const HOTBAR = [2, 1, 3, 4, 5, 6, 7];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const elFps = document.getElementById("fps");
const elPos = document.getElementById("pos");
const elHotbar = document.getElementById("hotbar");
const elHelp = document.getElementById("help");
const elToast = document.getElementById("toast");

let toastTimer = 0;
function toast(msg) {
  elToast.textContent = msg;
  elToast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove("show"), 2200);
}

function resize() {
  canvas.width = Math.floor(window.innerWidth);
  canvas.height = Math.floor(window.innerHeight);
}
window.addEventListener("resize", resize);
resize();

// ---------- Мир ----------
let world = new Uint8Array(WORLD_W * WORLD_H);
const at = (x, y) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 3 : world[y * WORLD_W + x]);
const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H) world[y * WORLD_W + x] = v; };
const isSolid = (x, y) => at(x, y) !== 0;

// Мульти-октавный псевдошум для рельефа
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function smoothNoise(x) {
  const i = Math.floor(x), f = x - i;
  const a = hash(i), b = hash(i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}
function fbm(x) { return smoothNoise(x * 0.9) * 0.55 + smoothNoise(x * 0.23 + 40) * 0.3 + smoothNoise(x * 0.07 + 90) * 0.15; }

function genWorld(seed) {
  world = new Uint8Array(WORLD_W * WORLD_H);
  const off = seed % 1000;
  for (let x = 0; x < WORLD_W; x++) {
    const h = Math.floor(14 + fbm(x * 0.08 + off) * 14);
    for (let y = h; y < WORLD_H; y++) {
      const depth = y - h;
      let b = 1;
      if (depth === 0) b = 2;
      else if (depth < 4) b = 1;
      else b = 3;
      // песчаный пляж у низин
      if (h > 22 && depth < 4) b = depth === 0 ? 6 : 6;
      // пещеры
      const c = smoothNoise(x * 0.35 + y * 0.5 + off);
      if (depth > 4 && c > 0.72) b = 0;
      set(x, y, b);
    }
    // деревья
    if (x > 2 && x < WORLD_W - 2 && hash(x * 3.7 + seed) > 0.72) {
      const hTop = Math.floor(14 + fbm(x * 0.08 + off) * 14);
      if (at(x, hTop) === 2) {
        const th = 3 + Math.floor(hash(x + seed) * 2);
        for (let i = 1; i <= th; i++) set(x, hTop - i, 4);
        for (let dx = -2; dx <= 2; dx++)
          for (let dy = -2; dy <= 1; dy++) {
            if (Math.abs(dx) === 2 && dy === -2) continue;
            if (at(x + dx, hTop - th + dy) === 0 && hash(x * 13 + dx * 7 + dy * 3) > 0.25)
              set(x + dx, hTop - th + dy, 5);
          }
      }
    }
  }
}

function randomSeed() { return Math.floor(Math.random() * 1e9); }

// ---------- Игрок ----------
const player = { x: 10 * TILE, y: 5 * TILE, w: 22, h: 30, vx: 0, vy: 0, onGround: false, fly: false };
let selected = 0;
let inventory = { 1: 99, 2: 99, 3: 99, 4: 99, 5: 99, 6: 99, 7: 99 };

function spawnPlayer() {
  // Ищем колонку без деревьев рядом: 3 клетки воздуха над землёй
  // и свободно по бокам на высоте тела, иначе игрок застрянет в листве.
  const cx = Math.floor(WORLD_W / 2);
  for (let dx = 0; dx < 40; dx++) {
    for (const sx of [cx + dx, cx - dx]) {
      for (let y = 0; y < WORLD_H; y++) {
        if (isSolid(sx, y)) {
          if (!isSolid(sx, y - 1) && !isSolid(sx, y - 2) && !isSolid(sx, y - 3) &&
              !isSolid(sx - 1, y - 1) && !isSolid(sx - 1, y - 2) &&
              !isSolid(sx + 1, y - 1) && !isSolid(sx + 1, y - 2)) {
            player.x = sx * TILE + 5; player.y = (y - 2) * TILE; player.vx = player.vy = 0; return;
          }
          break; // колонка занята деревом — пробуем соседнюю
        }
      }
    }
  }
  // fallback: просто центр
  for (let y = 0; y < WORLD_H; y++) {
    if (isSolid(cx, y)) { player.x = cx * TILE; player.y = (y - 2) * TILE; player.vx = player.vy = 0; return; }
  }
  player.x = cx * TILE; player.y = 0;
}

// ---------- Сохранение ----------
const SAVE_KEY = "minicraft-save-v1";
function saveGame(silent) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      seed: currentSeed, world: Array.from(world),
      player: { x: player.x, y: player.y }, inv: inventory,
    }));
    if (!silent) toast("Мир сохранён 💾");
  } catch { if (!silent) toast("Не удалось сохранить мир"); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    currentSeed = d.seed | 0;
    world = Uint8Array.from(d.world);
    player.x = d.player.x; player.y = d.player.y;
    inventory = d.inv;
    return true;
  } catch { return false; }
}
let currentSeed = randomSeed();

// ---------- Ввод ----------
const keys = {};
window.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "7") selectSlot(Number(e.key) - 1);
  if (e.code === "KeyF") { player.fly = !player.fly; player.vy = 0; toast(player.fly ? "Режим полёта: ВКЛ" : "Режим полёта: ВЫКЛ"); }
  keys[e.code] = true;
  if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

let mouse = { x: 0, y: 0, left: false, right: false };
const camera = { x: 0, y: 0 };

function screenToTile(sx, sy) {
  return { tx: Math.floor((sx + camera.x) / TILE), ty: Math.floor((sy + camera.y) / TILE) };
}
function playerTile() {
  return { tx: Math.floor((player.x + player.w / 2) / TILE), ty: Math.floor((player.y + player.h / 2) / TILE) };
}

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) { mouse.left = true; doBreak(); }
  if (e.button === 2) { mouse.right = true; doPlace(); }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) mouse.left = false;
  if (e.button === 2) mouse.right = false;
});
canvas.addEventListener("wheel", (e) => {
  selectSlot((selected + (e.deltaY > 0 ? 1 : HOTBAR.length - 1)) % HOTBAR.length);
}, { passive: true });

// долгое зажатие кнопки — повторять действие
setInterval(() => { if (mouse.left) doBreak(); if (mouse.right) doPlace(); }, 220);

// touch: тап — сломать, тап двумя пальцами — поставить
let lastTouch = 0;
canvas.addEventListener("touchstart", (e) => {
  const t = e.touches[0];
  mouse.x = t.clientX; mouse.y = t.clientY;
  const now = performance.now();
  if (e.touches.length === 2) doPlace();
  else if (now - lastTouch < 350) doPlace();
  else doBreak();
  lastTouch = now;
  e.preventDefault();
}, { passive: false });

function inReach(tx, ty) {
  const p = playerTile();
  return Math.hypot(tx - p.tx, ty - p.ty) <= REACH;
}

function doBreak() {
  const { tx, ty } = screenToTile(mouse.x, mouse.y);
  if (!inReach(tx, ty)) return;
  const b = at(tx, ty);
  if (b === 0) return;
  if (tx === 0 || ty === 0 || tx === WORLD_W - 1 || ty === WORLD_H - 1) return;
  set(tx, ty, 0);
  inventory[b] = (inventory[b] || 0) + 1;
  renderHotbar();
}

function playerOverlaps(tx, ty) {
  const bx = tx * TILE, by = ty * TILE;
  return player.x < bx + TILE && player.x + player.w > bx && player.y < by + TILE && player.y + player.h > by;
}

function doPlace() {
  const { tx, ty } = screenToTile(mouse.x, mouse.y);
  if (!inReach(tx, ty)) return;
  if (at(tx, ty) !== 0) return;
  const id = HOTBAR[selected];
  if ((inventory[id] || 0) <= 0) { toast("Нет блоков: добудьте их киркой (ЛКМ)"); return; }
  if (!player.fly && playerOverlaps(tx, ty)) return; // нельзя ставить в себя
  set(tx, ty, id);
  inventory[id]--;
  renderHotbar();
}

// ---------- Хотбар ----------
function blockPreview(id, size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  drawBlock(c.getContext("2d"), id, 0, 0, size);
  return c;
}
function renderHotbar() {
  elHotbar.innerHTML = "";
  HOTBAR.forEach((id, i) => {
    const d = document.createElement("div");
    d.className = "slot" + (i === selected ? " selected" : "");
    d.title = BLOCKS[id].name;
    d.appendChild(blockPreview(id, 40));
    const k = document.createElement("span"); k.className = "key"; k.textContent = i + 1;
    const n = document.createElement("span"); n.className = "count"; n.textContent = inventory[id] ?? 0;
    d.appendChild(k); d.appendChild(n);
    d.onclick = () => selectSlot(i);
    elHotbar.appendChild(d);
  });
}
function selectSlot(i) { selected = i; renderHotbar(); }

// ---------- Рисование блоков (пиксель-арт) ----------
function px(g, x, y, w, h, color) { g.fillStyle = color; g.fillRect(x, y, w, h); }
function noiseShade(x, y, s) { return (hash(x * 12.9898 + y * 78.233 + s * 37.7) > 0.5); }

function drawBlock(g, id, dx, dy, s) {
  const b = BLOCKS[id];
  const u = s / 8; // 8x8 пикселей на блок
  if (id === 2) { // дёрн: трава сверху, земля снизу
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      let c;
      if (j < 2) c = (i + j) % 2 ? b.top : b.base;
      else c = noiseShade(dx + i, dy + j, 1) ? "#8a5a2b" : "#74491f";
      px(g, dx + i * u, dy + j * u, u + 0.5, u + 0.5, c);
    }
    return;
  }
  const base = b.base, dark = b.dark || b.base, light = b.light || b.base;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    let c = noiseShade(dx + i, dy + j, id) ? base : dark;
    if (id === 3 && (i + j) % 3 === 0) c = light;                    // камень — крапинки
    if (id === 4 && i % 3 === 1) c = dark;                           // дерево — вертикальные полосы
    if (id === 4 && i % 3 === 0) c = light;
    if (id === 5 && (i * j) % 3 === 0) c = light;                    // листва — дырочки
    if (id === 7 && j % 2 === 0 && i === 0) c = dark;                // доски — швы
    if (id === 7 && j === 3) c = dark;
    px(g, dx + i * u, dy + j * u, u + 0.5, u + 0.5, c);
  }
  // рамка для объёма
  g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(dx, dy, s, 2);
  g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(dx, dy + s - 2, s, 2);
}

// ---------- Физика ----------
// EPS сжимает хитбокс при запросе тайлов, чтобы простое касание грани
// (стояние на земле, касание стены) не считалось пересечением.
const EPS = 0.01;
function collide(axis) {
  const x0 = Math.floor((player.x + EPS) / TILE), x1 = Math.floor((player.x + player.w - EPS) / TILE);
  const y0 = Math.floor((player.y + EPS) / TILE), y1 = Math.floor((player.y + player.h - EPS) / TILE);
  for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
    if (!isSolid(tx, ty)) continue;
    const bx = tx * TILE, by = ty * TILE;
    if (axis === "x") {
      if (player.vx > 0) player.x = bx - player.w; else if (player.vx < 0) player.x = bx + TILE;
      player.vx = 0;
    } else {
      if (player.vy > 0) { player.y = by - player.h; player.onGround = true; }
      else if (player.vy < 0) player.y = by + TILE;
      player.vy = 0;
    }
  }
}

function update() {
  const left = keys.KeyA || keys.ArrowLeft;
  const right = keys.KeyD || keys.ArrowRight;
  const up = keys.KeyW || keys.Space || keys.ArrowUp;
  const down = keys.KeyS || keys.ArrowDown;

  if (player.fly) {
    player.vx = (right ? MOVE_SPEED : 0) - (left ? MOVE_SPEED : 0);
    player.vy = (down ? MOVE_SPEED : 0) - (up ? MOVE_SPEED : 0);
    player.x += player.vx; collide("x");
    player.y += player.vy; collide("y");
    player.onGround = false;
  } else {
    player.vx = (right ? MOVE_SPEED : 0) - (left ? MOVE_SPEED : 0);
    player.x += player.vx; collide("x");
    player.vy += GRAVITY;
    if (player.vy > 14) player.vy = 14;
    player.onGround = false;
    if (up && player.onGroundPrev) player.vy = JUMP_VEL;
    player.y += player.vy; collide("y");
  }
  player.onGroundPrev = player.onGround;

  // границы мира
  player.x = Math.max(TILE, Math.min(WORLD_W * TILE - TILE - player.w, player.x));
  if (player.y > WORLD_H * TILE) { spawnPlayer(); toast("Вы упали! Возрождение…"); }

  // камера следует за игроком
  const tx = player.x + player.w / 2 - canvas.width / 2;
  const ty = player.y + player.h / 2 - canvas.height / 2;
  camera.x += (tx - camera.x) * 0.12;
  camera.y += (ty - camera.y) * 0.12;
  camera.x = Math.max(0, Math.min(WORLD_W * TILE - canvas.width, camera.x));
  camera.y = Math.max(0, Math.min(WORLD_H * TILE - canvas.height, camera.y));
}

// ---------- Рендер ----------
let time = 0;
function render() {
  time += 0.002;
  // небо с лёгкой сменой оттенка (день)
  const day = 0.5 + 0.5 * Math.sin(time);
  const skyTop = `rgb(${90 + day * 20},${160 + day * 30},${235})`;
  const skyBot = `rgb(${170 + day * 30},${215},${240})`;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, skyTop); grad.addColorStop(1, skyBot);
  ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // солнце
  ctx.fillStyle = "#ffef9e";
  ctx.beginPath();
  ctx.arc(canvas.width - 90, 80 + Math.sin(time) * 10, 30, 0, Math.PI * 2);
  ctx.fill();

  // облака
  ctx.fillStyle = "rgba(255,255,255,.85)";
  for (let i = 0; i < 6; i++) {
    const cx = ((i * 700 + time * 20000) % (WORLD_W * TILE)) - camera.x * 0.3;
    const cy = 40 + i * 32;
    ctx.fillRect(cx % (canvas.width + 200) - 100, cy, 90, 20);
    ctx.fillRect(cx % (canvas.width + 200) - 80, cy - 10, 50, 14);
  }

  const x0 = Math.max(0, Math.floor(camera.x / TILE) - 1);
  const y0 = Math.max(0, Math.floor(camera.y / TILE) - 1);
  const x1 = Math.min(WORLD_W - 1, Math.ceil((camera.x + canvas.width) / TILE) + 1);
  const y1 = Math.min(WORLD_H - 1, Math.ceil((camera.y + canvas.height) / TILE) + 1);

  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const b = at(tx, ty);
    if (!b) continue;
    drawBlock(ctx, b, Math.floor(tx * TILE - camera.x), Math.floor(ty * TILE - camera.y), TILE + 1);
  }

  // подсветка наведенного блока
  const hov = screenToTile(mouse.x, mouse.y);
  if (inReach(hov.tx, hov.ty) && at(hov.tx, hov.ty) !== 0) {
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.strokeRect(hov.tx * TILE - camera.x, hov.ty * TILE - camera.y, TILE, TILE);
  }
  // сетка-прицел для установки
  if (inReach(hov.tx, hov.ty) && at(hov.tx, hov.ty) === 0) {
    ctx.globalAlpha = 0.5;
    drawBlock(ctx, HOTBAR[selected], Math.floor(hov.tx * TILE - camera.x), Math.floor(hov.ty * TILE - camera.y), TILE);
    ctx.globalAlpha = 1;
  }

  // игрок (простой Стив)
  const pxx = Math.floor(player.x - camera.x), pyy = Math.floor(player.y - camera.y);
  ctx.fillStyle = "#00000055";
  ctx.beginPath(); ctx.ellipse(pxx + 11, pyy + 31, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3b6fd4"; ctx.fillRect(pxx + 1, pyy + 16, 20, 13);   // тело
  ctx.fillStyle = "#e8b98a"; ctx.fillRect(pxx + 3, pyy + 2, 16, 14);    // голова
  ctx.fillStyle = "#4a2f16"; ctx.fillRect(pxx + 3, pyy + 2, 16, 4);     // волосы
  ctx.fillStyle = "#222"; ctx.fillRect(pxx + 6, pyy + 8, 3, 3); ctx.fillRect(pxx + 13, pyy + 8, 3, 3);
  const legOff = Math.abs(Math.sin(performance.now() / 130)) * (Math.abs(player.vx) > 0.1 ? 3 : 0);
  ctx.fillStyle = "#2c3e90"; ctx.fillRect(pxx + 2, pyy + 27, 8, 4 + legOff); ctx.fillRect(pxx + 12, pyy + 27, 8, 4 - legOff + 2);

  elPos.textContent = `${Math.floor(player.x / TILE)}, ${Math.floor(player.y / TILE)}${player.fly ? " ✈" : ""}`;
}

// ---------- Цикл ----------
let lastFpsT = performance.now(), frames = 0;
function loop() {
  update();
  render();
  frames++;
  const now = performance.now();
  if (now - lastFpsT > 500) {
    elFps.textContent = Math.round(frames * 1000 / (now - lastFpsT)) + " FPS";
    frames = 0; lastFpsT = now;
  }
  requestAnimationFrame(loop);
}

// ---------- Кнопки ----------
document.getElementById("btn-help").onclick = () => elHelp.classList.remove("hidden");
document.getElementById("btn-close-help").onclick = () => elHelp.classList.add("hidden");
document.getElementById("btn-new").onclick = () => {
  if (!confirm("Создать новый мир? Текущий будет потерян.")) return;
  currentSeed = randomSeed();
  genWorld(currentSeed);
  spawnPlayer();
  inventory = { 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 7: 20 };
  renderHotbar();
  saveGame(true);
  toast("Новый мир создан 🌍");
};
document.getElementById("btn-save").onclick = () => saveGame(false);
setInterval(() => saveGame(true), 15000);

// ---------- Старт ----------
if (!loadGame()) {
  genWorld(currentSeed);
  spawnPlayer();
  inventory = { 1: 20, 2: 20, 3: 20, 4: 20, 5: 20, 6: 20, 7: 20 };
}
camera.x = player.x - canvas.width / 2;
camera.y = player.y - canvas.height / 2;
renderHotbar();
loop();
