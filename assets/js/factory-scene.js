/* factory-scene.js — 首頁 AI Agent 閉環智慧製造 3D 場景（Factory IO 風格）
 *
 * 維護說明
 *   · 場景是「捲動進度 p 的純函式」：update(p) 不讀時鐘、不累積狀態，倒捲畫面一致。
 *   · 每個構件一個具名函式（floorPlate / conveyor / inspectionGantry / chipVariants …），
 *     尺寸集中在各函式頂端的 D 常數；不要用臨時數字微調位置。
 *   · 材質按角色分槽（M），每個 mesh 具名，方便匯出後在其他軟體選取。
 *   · 文案在 assets/data/story-data.js，不在這裡。
 *
 * 目前包含：地板、直線輸送帶（帶面橫紋隨進度移動）、晶片（良品／裂痕／缺角）、檢測相機龍門架與環形補光、
 * 檢測後的 O／X 標示、紅框與信心分數（ticket 03）；機械手臂取出瑕疵品並裝箱（ticket 04，輸送帶在
 * p = P_FREEZE 停住）。後續各幕的設備在這個檔案往下加。
 *
 * 用法
 *   const THREE = await import('https://unpkg.com/three@0.184.0/build/three.module.js');
 *   const scene = buildScene(THREE, { detail:'high', shadows:true });
 *   root.add(scene.group); scene.update(p);   // p = 0..1
 *   scene.shots(mobile) → { wide, detect, pick }     // 鏡頭取景點（供時間軸關鍵影格）
 *   scene.bounds        → { center, radius, box, contentRadius }
 *   scene.dispose()
 *
 * 座標：公尺、y 軸向上；輸送帶沿 +x 前進，檢測相機在 x = CAM_X。
 */

/* ---------- 版面常數 ---------- */
export const DECK_Y = 0.62;            // 輸送帶中心高度
export const BELT_TOP = DECK_Y + 0.05; // 帶面高度（晶片擺放面）
export const BELT_X0 = -8;             // 帶尾（進料端）
export const CAM_X = 0;                // 檢測相機位置
export const PICK_X = 4.5;             // 機械手臂取件位置（相機下游）
export const PITCH = 1.3;              // 晶片間距
export const SLOTS = 14;               // 同時在帶上的晶片數
export const CYCLE = PITCH * SLOTS;    // 循環長度（= 可見帶長 18.2 m，帶尾 x = 10.2）
export const TRAVEL_PER_P = 50;        // 輸送帶每單位進度的位移（公尺）
export const P_FREEZE = 0.37;          // 過場結束後輸送帶停住（之後由 AGV 幕接手，見 ticket 05）

/* 手臂一次取放循環涵蓋的「帶面位移」（相對晶片抵達取件點的位置 Δ，公尺）；
   關鍵點之間用 smoothstep 插值。循環總長 3.7 m < 3 個晶片間距 3.9 m，所以兩顆瑕疵品不會同時占用手臂。 */
const T = { start: -0.8, hover: -0.4, grasp: -0.05, closed: 0.2, lift: 0.6, above: 1.3, down: 1.6, open: 1.85, up: 2.1, home: 2.9 };

/* ---------- 確定性瑕疵序列（不用 Math.random） ---------- */
export function hash01(n) {
  let h = (n * 374761393 + 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const CONF = [0.87, 0.89, 0.91, 0.93, 0.94, 0.96, 0.97, 0.98];
export function chipConfidenceIndex(n) { return Math.floor(hash01(n + 9001) * CONF.length); }

/* 晶片流水號 n（第 n 顆進料，可為負：捲動開始時已在帶上的晶片）。
   序號 < N_MIN 的晶片在 p=0 時已過了取件點（或取件循環已開始），一律視為良品，手臂才不會在第一格就「跳」在半空。 */
export const N_MIN = Math.ceil((BELT_X0 - PICK_X - T.start) / PITCH);

/* 種子 → 晶片種類函式。規則：原始機率抽到瑕疵，且前兩顆都不是瑕疵，才算瑕疵
   （瑕疵品至少相隔 3 顆，手臂才來得及取放）。改動 PITCH／TRAVEL／T 後要重挑種子。 */
export function makeKinds(seed) {
  const cache = new Map();
  const raw = n => {
    const r = hash01(n + seed);
    if (r >= 0.42) return 'ok';
    return hash01(n + seed + 5555) < 0.5 ? 'crack' : 'chip';
  };
  const kind = n => {
    if (n < N_MIN) return 'ok';
    if (cache.has(n)) return cache.get(n);
    const k = (raw(n) !== 'ok' && kind(n - 1) === 'ok' && kind(n - 2) === 'ok') ? raw(n) : 'ok';
    cache.set(n, k);
    return k;
  };
  return kind;
}
const KIND_SEED = 420;   // 種子搜尋條件：第 01 幕通過相機的晶片含裂痕與缺角；p≈0.224 與 0.302 各有一次完整取件；過場結束（凍結）時手臂不在半空
export const chipKind = makeKinds(KIND_SEED);

/* 輸送帶位移（進度 p → 公尺）：過場結束後停住 */
export function travelAt(p) { return TRAVEL_PER_P * Math.min(Math.max(p, 0), P_FREEZE); }
/* 晶片 n 的 x 位置 */
export const chipX = (n, p) => BELT_X0 + travelAt(p) - n * PITCH;
/* 第 i 個槽位在進度 p 時的晶片流水號與 x 位置 */
export function slotAt(i, p) {
  const t = travelAt(p), m = Math.floor(t / PITCH);
  const n = m - ((((m - i) % SLOTS) + SLOTS) % SLOTS);
  return { x: BELT_X0 + t - n * PITCH, id: n };
}

/* 全程的瑕疵品清單（依取件順序）：k = 進箱順序，供箱內位置與晶片外型使用 */
export function defectList(kindFn) {
  const out = [];
  const nMax = Math.floor(TRAVEL_PER_P * P_FREEZE / PITCH) + 1;
  for (let n = N_MIN; n <= nMax; n++) {
    const kd = kindFn(n);
    if (kd !== 'ok') out.push({ n, k: out.length, kind: kd });
  }
  return out;
}

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = x => x * x * (3 - 2 * x);

export function buildScene(THREE, opts = {}) {
  const low = opts.detail === 'low';
  const shadows = opts.shadows !== false && !low;
  const seg = (hi, lo) => (low ? lo : hi);
  const pad = n => String(n).padStart(2, '0');

  /* ---------- 材質槽（Factory IO 配色：藍框、橘標、綠通過、紅瑕疵） ---------- */
  const mk = (name, hex, rough, metal, extra) =>
    new THREE.MeshStandardMaterial(Object.assign({ name, color: hex, roughness: rough, metalness: metal }, extra || {}));
  const M = {
    floor:    mk('floor_plate',    0xdde1e5, 0.75, 0.05),
    kerb:     mk('floor_kerb',     0xf2b233, 0.60, 0.10),
    frame:    mk('frame_blue',     0x2f6fb2, 0.45, 0.30),
    steel:    mk('steel_silver',   0xb9c2ca, 0.35, 0.70),
    belt:     mk('belt_rubber',    0x30363d, 0.90, 0.00),
    beltMark: mk('belt_mark',      0x5b6673, 0.90, 0.00),
    dark:     mk('housing_dark',   0x27313b, 0.50, 0.25),
    lens:     mk('lens_glass',     0x8fd3ff, 0.10, 0.10, { emissive: new THREE.Color(0x2b6f9c), emissiveIntensity: 0.5 }),
    ring:     mk('ring_light',     0xdff3ff, 0.30, 0.10, { emissive: new THREE.Color(0xbfe6ff), emissiveIntensity: 1.1 }),
    chipBody: mk('chip_body',      0x20272e, 0.55, 0.20),
    chipPin:  mk('chip_pin',       0xd5dbe0, 0.30, 0.85),
    chipMark: mk('chip_marker',    0xf28c28, 0.50, 0.10),
    fracture: mk('chip_fracture',  0xeef1f3, 0.55, 0.05, { emissive: new THREE.Color(0xffffff), emissiveIntensity: 0.25 }),
    arm:      mk('arm_orange',     0xf28c28, 0.45, 0.25),
    frameBad: mk('defect_frame',   0xe5423b, 0.50, 0.10, { emissive: new THREE.Color(0xe5423b), emissiveIntensity: 0.6 }),
    beam:     new THREE.MeshBasicMaterial({ name: 'scan_beam', color: 0x66e0ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  };

  const geos = [], texs = [], mats = [];
  const keep = g => { geos.push(g); return g; };
  const mesh = (geo, m, name) => {
    const o = new THREE.Mesh(keep(geo), m);
    o.name = name;
    if (shadows) { o.castShadow = true; o.receiveShadow = true; }
    return o;
  };

  /* ---------- 幾何工具 ---------- */
  function roundedRect(w, h, r) {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
    r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001));
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /* 導角方盒：可見外殼一律用它，不留刀口邊 */
  function beveledBox(w, h, d, o) {
    o = o || {};
    if (low && !o.keepBevel) return new THREE.BoxGeometry(w, h, d);
    const f = Math.min(o.fillet == null ? 0.022 : o.fillet, w / 2.6, h / 2.6);
    const b = Math.min(o.bevel == null ? 0.014 : o.bevel, d / 2.6, f);
    const g = new THREE.ExtrudeGeometry(roundedRect(w, h, f), {
      depth: Math.max(0.001, d - 2 * b), bevelEnabled: true,
      bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: seg(3, 1), steps: 1
    });
    g.translate(0, 0, -(d - 2 * b) / 2);
    return g;
  }
  const bbox = (w, h, d, m, name, o) => mesh(beveledBox(w, h, d, o), m, name);

  const group = new THREE.Group();
  group.name = 'ai_manufacturing_scene';
  const anim = { marks: [], beam: null, ring: null, slots: [], arm: null, bin: [] };

  /* ---------- 廠房地板（預留後續各幕的空間） ---------- */
  function floorPlate() {
    const D = { w: 30, d: 16, cx: 1, thick: 0.14, kerb: 0.16 };
    const g = new THREE.Group(); g.name = 'floor';
    const plate = mesh(new THREE.BoxGeometry(D.w, D.thick, D.d), M.floor, 'floor_plate');
    plate.position.set(D.cx, D.thick / 2, 0); plate.castShadow = false; g.add(plate);
    for (const s of [-1, 1]) {
      const kx = bbox(D.w, D.kerb, 0.14, M.kerb, 'floor_kerb_' + (s > 0 ? 'front' : 'back'), { fillet: 0.03 });
      kx.position.set(D.cx, D.thick + D.kerb / 2 - 0.02, s * (D.d / 2 - 0.07)); g.add(kx);
      const kz = bbox(D.d, D.kerb, 0.14, M.kerb, 'floor_kerb_' + (s > 0 ? 'right' : 'left'), { fillet: 0.03 });
      kz.rotation.y = Math.PI / 2; kz.position.set(D.cx + s * (D.w / 2 - 0.07), kx.position.y, 0); g.add(kz);
    }
    return g;
  }

  /* ---------- 直線輸送帶 ---------- */
  function conveyor() {
    const D = { len: CYCLE, half: 0.4, railH: 0.16, railT: 0.07, markPitch: 0.55 };
    const g = new THREE.Group(); g.name = 'conveyor';
    const cx = BELT_X0 + D.len / 2;
    const slab = mesh(new THREE.BoxGeometry(D.len, 0.08, D.half * 2), M.belt, 'belt_surface');
    slab.position.set(cx, DECK_Y, 0); g.add(slab);
    for (const s of [-1, 1]) {
      const rail = bbox(D.len, D.railH, D.railT, M.frame, 'conveyor_rail_' + (s > 0 ? 'front' : 'back'), { fillet: 0.02 });
      rail.position.set(cx, DECK_Y + 0.02, s * (D.half + D.railT / 2 + 0.01)); g.add(rail);
    }
    /* 帶面橫紋：位置由 update(p) 依帶面位移決定，讓輸送帶「看得出在動」 */
    const nMark = Math.floor(D.len / D.markPitch);
    for (let i = 0; i < nMark; i++) {
      const m = mesh(new THREE.BoxGeometry(0.05, 0.004, D.half * 2 - 0.1), M.beltMark, 'belt_mark_' + pad(i + 1));
      m.castShadow = false; m.position.set(BELT_X0, DECK_Y + 0.042, 0); g.add(m); anim.marks.push(m);
    }
    /* 支撐腳 */
    const hLeg = DECK_Y - 0.14 - 0.04;
    for (let i = 0; i <= 11; i++) {
      for (const s of [-1, 1]) {
        const leg = bbox(0.1, hLeg, 0.1, M.frame, 'conveyor_leg_' + pad(i + 1) + (s > 0 ? 'f' : 'b'), { fillet: 0.014 });
        leg.position.set(BELT_X0 + 0.3 + i * (D.len - 0.6) / 11, 0.14 + hLeg / 2, s * (D.half + 0.06)); g.add(leg);
      }
    }
    return g;
  }

  /* ---------- 檢測相機龍門架 + 環形補光 + 掃描光束 ---------- */
  function inspectionGantry() {
    const D = { postH: 2.05, span: 0.9, camY: 1.78, ringY: 1.22 };
    const g = new THREE.Group(); g.name = 'inspection_gantry';
    g.position.set(CAM_X, 0, 0);
    for (const s of [-1, 1]) {
      const post = bbox(0.14, D.postH, 0.14, M.frame, 'gantry_post_' + (s > 0 ? 'front' : 'back'), { fillet: 0.018 });
      post.position.set(0, 0.14 + D.postH / 2, s * D.span); g.add(post);
    }
    const beam = bbox(0.2, 0.16, D.span * 2 + 0.14, M.frame, 'gantry_beam', { fillet: 0.02 });
    beam.position.set(0, 0.14 + D.postH, 0); g.add(beam);
    const mount = bbox(0.16, 0.34, 0.16, M.steel, 'camera_mount', { fillet: 0.02 });
    mount.position.set(0, D.camY + 0.36, 0); g.add(mount);
    const body = bbox(0.34, 0.34, 0.4, M.dark, 'camera_body', { fillet: 0.028 });
    body.position.set(0, D.camY, 0); g.add(body);
    const barrel = mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.3, seg(24, 10)), M.steel, 'camera_lens_barrel');
    barrel.position.set(0, D.camY - 0.3, 0); g.add(barrel);
    const glass = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, seg(24, 10)), M.lens, 'camera_lens_glass');
    glass.position.set(0, D.camY - 0.46, 0); g.add(glass);
    const ring = mesh(new THREE.TorusGeometry(0.34, 0.06, seg(14, 6), seg(44, 18)), M.ring, 'ring_light');
    ring.rotation.x = Math.PI / 2; ring.position.set(0, D.ringY, 0); g.add(ring);
    anim.ring = ring;
    if (!low) for (const s of [-1, 1]) {
      const brk = bbox(0.05, 0.42, 0.05, M.steel, 'ring_bracket_' + (s > 0 ? 'front' : 'back'), { fillet: 0.01 });
      brk.position.set(0, D.ringY + 0.21, s * 0.32); g.add(brk);
    }
    /* 掃描光束：錐形半透明，強度由 update(p) 依晶片位置決定 */
    const h = D.ringY - BELT_TOP;
    const beam2 = mesh(new THREE.CylinderGeometry(0.1, 0.34, h, seg(28, 12), 1, true), M.beam, 'scan_beam');
    beam2.castShadow = false; beam2.receiveShadow = false;
    beam2.position.set(0, BELT_TOP + h / 2, 0); g.add(beam2);
    anim.beam = beam2;
    return g;
  }

  /* ---------- 晶片：良品／裂痕（裂成兩半）／缺角 ---------- */
  const CHIP = { w: 0.56, h: 0.1, pinLen: 0.07, pinW: 0.045, pinH: 0.02, pinN: 5 };

  function chipPins(parent, filter, prefix) {
    const step = CHIP.w / (CHIP.pinN + 0.5);
    for (let i = 0; i < CHIP.pinN; i++) {
      const o = (i - (CHIP.pinN - 1) / 2) * step;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = sx ? sx * (CHIP.w / 2 + CHIP.pinLen / 2 - 0.012) : o;
        const z = sz ? sz * (CHIP.w / 2 + CHIP.pinLen / 2 - 0.012) : o;
        if (filter && !filter(x, z)) continue;
        const pin = mesh(new THREE.BoxGeometry(sx ? CHIP.pinLen : CHIP.pinW, CHIP.pinH, sx ? CHIP.pinW : CHIP.pinLen),
          M.chipPin, prefix + '_pin_' + (sx > 0 ? 'e' : sx < 0 ? 'w' : sz > 0 ? 's' : 'n') + (i + 1));
        pin.position.set(x, -0.005, z); parent.add(pin);
      }
    }
  }
  const chipMarker = (parent, name, x, z) => {
    const m = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, seg(14, 6)), M.chipMark, name);
    m.position.set(x, CHIP.h / 2 + 0.004, z); parent.add(m);
  };

  function chipOk() {
    const g = new THREE.Group(); g.name = 'chip_ok';
    g.add(bbox(CHIP.w, CHIP.h, CHIP.w, M.chipBody, 'chip_ok_body', { fillet: 0.02, bevel: 0.012 }));   // x×y 為斷面，沿 z 擠出 = 薄板
    chipPins(g, null, 'chip_ok');
    chipMarker(g, 'chip_ok_marker', -CHIP.w / 2 + 0.07, -CHIP.w / 2 + 0.07);
    return g;
  }

  /* 裂痕：本體沿 z 向中線裂成兩半，兩半錯位、略微旋轉，斷面淺色 */
  function chipCrack() {
    const g = new THREE.Group(); g.name = 'chip_crack';
    const half = 0.5 * CHIP.w - 0.03;
    for (const s of [-1, 1]) {
      const h = new THREE.Group(); h.name = 'chip_crack_half_' + (s < 0 ? 'a' : 'b');
      h.position.set(s * 0.08, s > 0 ? -0.012 : 0.004, s * (half / 2 + 0.1));   // 兩半明顯分開、錯位
      h.rotation.y = s * 0.2;
      h.add(bbox(CHIP.w, CHIP.h, half, M.chipBody, h.name + '_body', { fillet: 0.02, bevel: 0.01 }));
      const face = mesh(new THREE.BoxGeometry(CHIP.w - 0.02, CHIP.h - 0.012, 0.012), M.fracture, h.name + '_fracture');
      face.position.z = -s * (half / 2 - 0.004); h.add(face);
      /* 各半邊只帶自己那一側的接腳；接腳座標由整顆晶片座標換到半邊局部座標 */
      const before = h.children.length;
      chipPins(h, (x, z) => (s < 0 ? z < -0.02 : z > 0.02), h.name);
      for (let k = before; k < h.children.length; k++) {
        h.children[k].position.x -= h.position.x; h.children[k].position.z -= h.position.z;
      }
      g.add(h);
    }
    chipMarker(g.children[0], 'chip_crack_marker', -CHIP.w / 2 + 0.07, -0.03);
    return g;
  }

  /* 缺角：一個角被斜切掉，斷面淺色，旁邊掉一塊碎片 */
  function chipChipped() {
    const g = new THREE.Group(); g.name = 'chip_chipped';
    const a = CHIP.w / 2, c = 0.22;
    const shape = new THREE.Shape();
    shape.moveTo(-a, -a); shape.lineTo(a, -a); shape.lineTo(a, a - c); shape.lineTo(a - c, a); shape.lineTo(-a, a); shape.closePath();
    const geo = keep(new THREE.ExtrudeGeometry(shape, { depth: CHIP.h, bevelEnabled: false }));
    const body = new THREE.Mesh(geo, M.chipBody); body.name = 'chip_chipped_body';
    body.rotation.x = Math.PI / 2; body.position.y = CHIP.h / 2;      // 斷面 y→+z，擠出向下
    if (shadows) { body.castShadow = true; body.receiveShadow = true; }
    g.add(body);
    const cut = mesh(new THREE.BoxGeometry(c * Math.SQRT2, CHIP.h - 0.008, 0.012), M.fracture, 'chip_chipped_fracture');
    cut.position.set(a - c / 2, 0, a - c / 2); cut.rotation.y = Math.PI / 4; g.add(cut);
    chipPins(g, (x, z) => Math.min(x, a) + Math.min(z, a) <= 2 * a - c - 0.01, 'chip_chipped');   // 斷面線 x+z = 2a-c 之外的接腳一併缺失
    chipMarker(g, 'chip_chipped_marker', -a + 0.07, -a + 0.07);
    const shard = mesh(new THREE.BoxGeometry(0.11, 0.05, 0.11), M.chipBody, 'chip_chipped_shard');
    shard.position.set(a + 0.05, -CHIP.h / 2 + 0.025, a + 0.06); shard.rotation.y = 0.6; g.add(shard);
    return g;
  }

  /* ---------- 檢測結果標示：O／X + 信心分數（貼圖精靈）與紅框 ---------- */
  function labelTexture(kind, conf) {
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 200;
    const c = cv.getContext('2d');
    const good = kind === 'ok';
    c.fillStyle = good ? '#2fa85a' : '#e5423b';
    c.beginPath(); c.arc(80, 82, 66, 0, Math.PI * 2); c.fill();
    c.lineWidth = 6; c.strokeStyle = '#ffffff'; c.stroke();
    c.fillStyle = '#ffffff'; c.font = '700 84px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(good ? 'O' : 'X', 80, 86);
    if (!good) {
      c.fillStyle = 'rgba(29,45,61,.92)';
      c.beginPath(); c.roundRect ? c.roundRect(28, 156, 104, 36, 10) : c.rect(28, 156, 104, 36); c.fill();
      c.fillStyle = '#ffffff'; c.font = '600 26px system-ui, sans-serif';
      c.fillText(conf.toFixed(2), 80, 175);
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; texs.push(t);
    const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
    mats.push(m);
    return m;
  }
  const labelMats = { ok: null, bad: [] };
  const labelMat = (kind, id) => {
    if (kind === 'ok') return labelMats.ok || (labelMats.ok = labelTexture('ok'));
    const i = chipConfidenceIndex(id);
    return labelMats.bad[i] || (labelMats.bad[i] = labelTexture('bad', CONF[i]));
  };

  const frameGeoX = keep(new THREE.BoxGeometry(0.88, 0.03, 0.04));
  const frameGeoZ = keep(new THREE.BoxGeometry(0.04, 0.03, 0.88));
  function defectFrame(tag) {
    const g = new THREE.Group(); g.name = 'defect_frame_' + tag;
    for (const s of [-1, 1]) {
      const a = new THREE.Mesh(frameGeoX, M.frameBad); a.name = g.name + '_x' + (s > 0 ? 'p' : 'n'); a.position.z = s * 0.44; g.add(a);
      const b = new THREE.Mesh(frameGeoZ, M.frameBad); b.name = g.name + '_z' + (s > 0 ? 'p' : 'n'); b.position.x = s * 0.44; g.add(b);
    }
    return g;
  }

  /* ---------- 取件站：機械手臂 + 收納箱 ---------- */
  const ARM = { x: PICK_X, z: -1.7, baseY: 0.64, H0: 0.47, L1: 1.15, L2: 1.05, Lg: 0.25 };
  const BIN = { x: PICK_X + 1.7, z: -1.7, w: 1.6, d: 1.5, h: 0.42, floor: 0.06 };
  const CHIP_Y = BELT_TOP + CHIP.h / 2;   // 晶片在帶面上的中心高度

  function pickArm() {
    const g = new THREE.Group(); g.name = 'pick_arm';
    const ped = bbox(0.8, 0.5, 0.8, M.frame, 'arm_pedestal', { fillet: 0.03 });
    ped.position.set(ARM.x, 0.14 + 0.25, ARM.z); g.add(ped);
    const yawG = new THREE.Group(); yawG.name = 'arm_yaw'; yawG.position.set(ARM.x, ARM.baseY, ARM.z); g.add(yawG);
    const plate = mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.12, seg(24, 10)), M.dark, 'arm_turntable');
    plate.position.y = 0.06; yawG.add(plate);
    const col = bbox(0.3, ARM.H0 - 0.12, 0.3, M.arm, 'arm_column', { fillet: 0.03 });
    col.position.y = 0.12 + (ARM.H0 - 0.12) / 2; yawG.add(col);

    const joint = (parent, name, r, len) => {
      const j = mesh(new THREE.CylinderGeometry(r, r, len, seg(20, 8)), M.dark, name);
      j.rotation.z = Math.PI / 2; parent.add(j); return j;
    };
    const shoulder = new THREE.Group(); shoulder.name = 'arm_shoulder'; shoulder.position.y = ARM.H0; yawG.add(shoulder);
    joint(shoulder, 'arm_shoulder_joint', 0.17, 0.4);
    const l1 = bbox(0.2, ARM.L1, 0.24, M.arm, 'arm_link_1', { fillet: 0.03 }); l1.position.y = ARM.L1 / 2; shoulder.add(l1);
    const elbow = new THREE.Group(); elbow.name = 'arm_elbow'; elbow.position.y = ARM.L1; shoulder.add(elbow);
    joint(elbow, 'arm_elbow_joint', 0.15, 0.34);
    const l2 = bbox(0.17, ARM.L2, 0.2, M.arm, 'arm_link_2', { fillet: 0.03 }); l2.position.y = ARM.L2 / 2; elbow.add(l2);
    const wrist = new THREE.Group(); wrist.name = 'arm_wrist'; wrist.position.y = ARM.L2; elbow.add(wrist);
    joint(wrist, 'arm_wrist_joint', 0.11, 0.28);
    const gripYaw = new THREE.Group(); gripYaw.name = 'arm_gripper'; wrist.add(gripYaw);
    const palm = bbox(0.8, 0.07, 0.2, M.dark, 'gripper_palm', { fillet: 0.015 }); palm.position.y = -0.05; gripYaw.add(palm);
    const fingers = [];
    for (const sgn of [-1, 1]) {
      const f = bbox(0.05, 0.32, 0.16, M.steel, 'gripper_finger_' + (sgn > 0 ? 'r' : 'l'), { fillet: 0.01 });
      f.position.y = -0.2; f.userData.sign = sgn; gripYaw.add(f); fingers.push(f);
    }
    return { g, yawG, shoulder, elbow, wrist, gripYaw, fingers };
  }

  function binCrate() {
    const g = new THREE.Group(); g.name = 'reject_bin';
    const fl = bbox(BIN.w, BIN.floor, BIN.d, M.frame, 'bin_floor', { fillet: 0.01 });
    fl.position.set(BIN.x, 0.14 + BIN.floor / 2, BIN.z); g.add(fl);
    for (const sgn of [-1, 1]) {
      const wz = bbox(BIN.w, BIN.h, 0.06, M.frame, 'bin_wall_' + (sgn > 0 ? 'front' : 'back'), { fillet: 0.015 });
      wz.position.set(BIN.x, 0.14 + BIN.h / 2, BIN.z + sgn * (BIN.d / 2 - 0.03)); g.add(wz);
      const wx = bbox(0.06, BIN.h, BIN.d, M.frame, 'bin_wall_' + (sgn > 0 ? 'right' : 'left'), { fillet: 0.015 });
      wx.position.set(BIN.x + sgn * (BIN.w / 2 - 0.03), 0.14 + BIN.h / 2, BIN.z); g.add(wx);
    }
    const label = bbox(0.5, 0.16, 0.02, M.frameBad, 'bin_tag_x', { fillet: 0.01 });
    label.position.set(BIN.x, 0.14 + BIN.h * 0.62, BIN.z + BIN.d / 2 + 0.005); g.add(label);   // 紅色 X 收納箱標記
    return g;
  }
  /* 第 k 個進箱的瑕疵品在箱內的位置：2×2 一層，滿了疊第二層 */
  const BIN_CAP = 8, BIN_SCALE = 0.8;
  function binSlot(k) {
    const i = k % 4, layer = Math.floor(k / 4) % 2;
    return {
      x: BIN.x + (i % 2 ? 0.38 : -0.38),
      z: BIN.z + (i < 2 ? -0.36 : 0.36),
      y: 0.14 + BIN.floor + (CHIP.h * BIN_SCALE) / 2 + layer * 0.1,
      yaw: (hash01(k + 77) - 0.5) * 0.9
    };
  }

  /* 取放循環的取件點（帶面）、待命點與過渡高度 */
  const HOME = [PICK_X - 0.7, 1.55, -0.6];
  const HOVER_Y = CHIP_Y + 0.6, HIGH_Y = 1.35;
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ss = (a, b, x) => smooth(clamp01((x - a) / (b - a)));

  /* Δ = 晶片相對取件點的位置（= 帶面位移）→ 夾爪中心點與夾合度；全程只取決於 Δ 與進箱序號 k */
  function tipAt(d, k) {
    const bin = binSlot(k);
    const grasp = [PICK_X + T.closed, CHIP_Y, 0];
    const lifted = [PICK_X + T.closed + 0.15, HIGH_Y, -0.15];
    if (d <= T.start) return { pos: HOME, grip: 0 };
    if (d < T.hover) return { pos: lerp3(HOME, [PICK_X + T.hover, HOVER_Y, 0], ss(T.start, T.hover, d)), grip: 0 };
    if (d < T.grasp) return { pos: [PICK_X + d, HOVER_Y + (CHIP_Y - HOVER_Y) * ss(T.hover, T.grasp, d), 0], grip: 0 };
    if (d < T.closed) return { pos: [PICK_X + d, CHIP_Y, 0], grip: ss(T.grasp, T.closed, d) };
    if (d < T.lift) return { pos: lerp3(grasp, lifted, ss(T.closed, T.lift, d)), grip: 1 };
    if (d < T.above) return { pos: lerp3(lifted, [bin.x, HIGH_Y, bin.z], ss(T.lift, T.above, d)), grip: 1 };
    if (d < T.down) return { pos: lerp3([bin.x, HIGH_Y, bin.z], [bin.x, bin.y, bin.z], ss(T.above, T.down, d)), grip: 1 };
    if (d < T.open) return { pos: [bin.x, bin.y, bin.z], grip: 1 - ss(T.down, T.open, d) };
    if (d < T.up) return { pos: lerp3([bin.x, bin.y, bin.z], [bin.x, HIGH_Y, bin.z], ss(T.open, T.up, d)), grip: 0 };
    if (d < T.home) return { pos: lerp3([bin.x, HIGH_Y, bin.z], HOME, ss(T.up, T.home, d)), grip: 0 };
    return { pos: HOME, grip: 0 };
  }

  /* 二連桿解析解：夾爪中心點（世界座標）→ 底座迴轉、肩、肘角 */
  function solveArm(tip) {
    const dx = tip[0] - ARM.x, dz = tip[2] - ARM.z;
    const yaw = Math.atan2(dx, dz), r = Math.hypot(dx, dz);
    const ey = tip[1] + ARM.Lg - (ARM.baseY + ARM.H0);
    const D = Math.min(ARM.L1 + ARM.L2 - 0.02, Math.max(Math.abs(ARM.L1 - ARM.L2) + 0.05, Math.hypot(r, ey)));
    const c = Math.max(-1, Math.min(1, (D * D - ARM.L1 * ARM.L1 - ARM.L2 * ARM.L2) / (2 * ARM.L1 * ARM.L2)));
    const th2 = Math.acos(c);
    const th1 = Math.atan2(r, ey) - Math.atan2(ARM.L2 * Math.sin(th2), ARM.L1 + ARM.L2 * Math.cos(th2));
    return { yaw, th1, th2 };
  }

  const DEFECTS = defectList(chipKind);

  function binChips() {
    const g = new THREE.Group(); g.name = 'bin_chips';
    for (let k = 0; k < BIN_CAP; k++) {
      const holder = new THREE.Group(); holder.name = 'bin_chip_' + pad(k + 1);
      const v = { crack: chipCrack(), chip: chipChipped() };
      for (const key in v) { v[key].visible = false; holder.add(v[key]); }
      holder.visible = false; g.add(holder);
      anim.bin.push({ holder, v, kind: null });
    }
    return g;
  }

  /* 晶片池：每個槽位含三種外型、標示精靈與紅框，update(p) 只切換可見性 */
  function chipPool() {
    const g = new THREE.Group(); g.name = 'chips';
    for (let i = 0; i < SLOTS; i++) {
      const tag = pad(i + 1);
      const slot = new THREE.Group(); slot.name = 'chip_slot_' + tag;
      const variants = { ok: chipOk(), crack: chipCrack(), chip: chipChipped() };
      for (const k in variants) { variants[k].visible = false; slot.add(variants[k]); }
      const frame = defectFrame(tag); frame.position.y = -CHIP.h / 2 + 0.02; frame.visible = false; slot.add(frame);
      const sprite = new THREE.Sprite(labelMat('ok', 0)); sprite.name = 'chip_label_' + tag;
      sprite.position.y = 0.6; sprite.scale.set(0.44, 0.55, 1); sprite.visible = false; slot.add(sprite);
      g.add(slot);
      anim.slots.push({ slot, variants, frame, sprite, kind: null, id: null });   // 流水號可為負，哨兵值不能用 -1
    }
    return g;
  }

  anim.arm = pickArm();
  group.add(floorPlate(), conveyor(), inspectionGantry(), chipPool(), anim.arm.g, binCrate(), binChips());

  /* 取景用邊界（相機距離與光源範圍由此推導，不寫死數字） */
  const bb = new THREE.Box3().setFromObject(group);
  const sph = bb.getBoundingSphere(new THREE.Sphere());
  const bounds = {
    center: sph.center.clone(), radius: sph.radius, box: bb,
    contentRadius: 0.5 * Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.86
  };

  /* ---------- 動態：全部只取決於 p ---------- */
  function update(p) {
    p = clamp01(p);
    const travel = travelAt(p);
    const markPitch = CYCLE / anim.marks.length;
    anim.marks.forEach((m, i) => {
      const d = (i * markPitch + travel) % CYCLE;
      m.position.x = BELT_X0 + d;
      m.visible = d > 0.05 && d < CYCLE - 0.05;
    });
    let flash = 0;
    for (let i = 0; i < SLOTS; i++) {
      const s = anim.slots[i], { x, id } = slotAt(i, p);
      if (s.id !== id) {
        s.id = id;
        const kind = chipKind(id);
        s.kind = kind;
        s.variants.ok.visible = kind === 'ok';
        s.variants.crack.visible = kind === 'crack';
        s.variants.chip.visible = kind === 'chip';
        s.sprite.material = labelMat(kind === 'ok' ? 'ok' : 'bad', id);
      }
      /* 瑕疵品被夾爪夾起後，改由箱內晶片物件接手（同一位置、同一姿態） */
      const picked = s.kind !== 'ok' && x - PICK_X >= T.grasp;
      s.slot.visible = !picked;
      if (picked) continue;
      /* 進出帶尾的兩端縮放淡入淡出，避免循環瞬移被看見 */
      const edge = smooth(clamp01(Math.min(x - BELT_X0, BELT_X0 + CYCLE - x) / 0.5));
      s.slot.position.set(x, CHIP_Y, 0);
      s.slot.scale.setScalar(Math.max(0.001, edge));
      /* 過了相機才有檢測結果 */
      const dx = x - CAM_X;
      const res = smooth(clamp01(dx / 0.7));
      s.sprite.visible = res > 0.01;
      s.sprite.scale.set(0.44 * res, 0.55 * res, 1);
      s.frame.visible = s.kind !== 'ok' && res > 0.01;
      s.frame.scale.setScalar(0.85 + 0.15 * res);
      flash = Math.max(flash, 1 - clamp01(Math.abs(dx) / 0.4));
    }
    M.beam.opacity = 0.08 + 0.32 * flash;
    M.ring.emissiveIntensity = 0.9 + 0.7 * flash;

    /* 手臂：找出正在取放的那顆瑕疵品（間距保證同時最多一顆），否則回待命點 */
    let tip = { pos: HOME, grip: 0 };
    for (const df of DEFECTS) {
      const d = chipX(df.n, p) - PICK_X;
      if (d > T.start && d < T.home) { tip = tipAt(d, df.k); break; }
    }
    const A = anim.arm, ik = solveArm(tip.pos);
    A.yawG.rotation.y = ik.yaw;
    A.shoulder.rotation.x = ik.th1;
    A.elbow.rotation.x = ik.th2;
    A.wrist.rotation.x = -(ik.th1 + ik.th2);   // 抵消前兩節的傾角，夾爪始終朝下
    A.gripYaw.rotation.y = -ik.yaw;            // 抵消底座迴轉，夾爪與帶向對齊
    for (const f of A.fingers) f.position.x = f.userData.sign * (0.37 - 0.06 * tip.grip);

    /* 箱內晶片：夾起後跟著夾爪走，放下後留在箱中 */
    for (let k = 0; k < BIN_CAP; k++) {
      const o = anim.bin[k], df = DEFECTS[k];
      if (!df) { o.holder.visible = false; continue; }
      const d = chipX(df.n, p) - PICK_X;
      const on = d >= T.grasp;
      o.holder.visible = on;
      if (!on) continue;
      if (o.kind !== df.kind) { o.kind = df.kind; o.v.crack.visible = df.kind === 'crack'; o.v.chip.visible = df.kind === 'chip'; }
      const bin = binSlot(k);
      const pos = tipAt(Math.min(d, T.down), k).pos;
      const u = ss(T.closed, T.down, d);
      o.holder.position.set(pos[0], pos[1], pos[2]);
      o.holder.rotation.y = bin.yaw * u;
      o.holder.scale.setScalar(1 + (BIN_SCALE - 1) * u);
    }
  }
  update(0);

  /* 鏡頭取景點：desktop／mobile 各一組；後續各幕在此加入 */
  function shots(mobile) {
    const tgtWide = [1.2, 0.9, 0];
    return {
      wide: {
        pos: mobile ? [4.0, 8.2, 15.5] : [3.4, 6.4, 12.6],
        tgt: tgtWide
      },
      pick: {
        pos: mobile ? [PICK_X + 8.4, 4.9, 4.7] : [PICK_X + 3.6, 3.1, 4.8],
        tgt: mobile ? [PICK_X + 0.9, 0.8, -1.05] : [PICK_X + 0.9, 0.9, -0.7]
      },
      detect: {
        pos: mobile ? [CAM_X - 4.4, 2.2, 1.9] : [CAM_X + 3.2, 1.9, 3.7],
        tgt: mobile ? [CAM_X + 1.6, 0.8, -0.1] : [CAM_X + 1.3, 0.8, 0]
      }
    };
  }

  function dispose() {
    group.traverse(o => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    geos.forEach(g => g.dispose()); geos.length = 0;
    texs.forEach(t => t.dispose()); mats.forEach(m => m.dispose());
    Object.values(M).forEach(m => m.dispose());
  }

  /* 除錯用：目前每個槽位的狀態（預覽工具與測試使用） */
  const inspect = () => anim.slots.map(s => ({
    id: s.id, kind: s.kind, x: +s.slot.position.x.toFixed(3), slotVisible: s.slot.visible,
    variant: Object.keys(s.variants).filter(k => s.variants[k].visible).join('+'),
    labelIsOk: s.sprite.material === labelMats.ok, spriteVisible: s.sprite.visible, frameVisible: s.frame.visible
  }));

  return { group, bounds, materials: M, update, shots, inspect, dispose, detail: low ? 'low' : 'high' };
}
