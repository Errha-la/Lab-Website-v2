/* factory-scene.js — 首頁 AI Agent 閉環智慧製造 3D 場景（Factory IO 風格）
 *
 * 維護說明
 *   · 場景是「捲動進度 p 的純函式」：update(p) 不讀時鐘、不累積狀態，倒捲畫面一致。
 *   · 每個構件一個具名函式（floorPlate / conveyor / inspectionGantry / chipVariants …），
 *     尺寸集中在各函式頂端的 D 常數；不要用臨時數字微調位置。
 *   · 材質按角色分槽（M），每個 mesh 具名，方便匯出後在其他軟體選取。
 *   · 文案在 assets/data/story-data.js，不在這裡。
 *
 * 目前包含（ticket 03）：地板、直線輸送帶（帶面橫紋隨進度移動）、晶片（良品／裂痕／缺角）、檢測相機龍門架與環形補光、
 * 檢測後的 O／X 標示、紅框與信心分數。後續各幕的設備在這個檔案往下加。
 *
 * 用法
 *   const THREE = await import('https://unpkg.com/three@0.184.0/build/three.module.js');
 *   const scene = buildScene(THREE, { detail:'high', shadows:true });
 *   root.add(scene.group); scene.update(p);   // p = 0..1
 *   scene.shots(mobile) → { wide, detect }     // 鏡頭取景點（供時間軸關鍵影格）
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
export const PITCH = 1.3;              // 晶片間距
export const SLOTS = 11;               // 同時在帶上的晶片數
export const CYCLE = PITCH * SLOTS;    // 循環長度（= 可見帶長 14.3 m）
export const TRAVEL_PER_P = 50;        // 捲完整段時輸送帶總位移（公尺）

/* ---------- 確定性瑕疵序列（不用 Math.random） ---------- */
export function hash01(n) {
  let h = (n * 374761393 + 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/* 晶片編號 → 'ok' | 'crack'（裂成兩半）| 'chip'（缺角） */
/* 種子 16：使第 01 幕（p 0.07–0.25）通過相機的晶片為 ok×4、crack、ok、chip，過場中至少再出現一個缺角；改動 PITCH／TRAVEL 後要重挑 */
const KIND_SEED = 16;
export function chipKind(id) {
  const r = hash01(id + KIND_SEED);
  if (r < 0.58) return 'ok';
  return r < 0.79 ? 'crack' : 'chip';
}
const CONF = [0.87, 0.89, 0.91, 0.93, 0.94, 0.96, 0.97, 0.98];
export function chipConfidenceIndex(id) { return Math.floor(hash01(id + 9001) * CONF.length); }

/* 第 i 個槽位在進度 p 時的位置與晶片編號（循環時編號遞增） */
export function slotAt(i, p) {
  const d = i * PITCH + p * TRAVEL_PER_P;
  const wraps = Math.floor(d / CYCLE);
  return { x: BELT_X0 + (d - wraps * CYCLE), id: i + SLOTS * wraps };
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
  const anim = { marks: [], beam: null, ring: null, slots: [] };

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
      anim.slots.push({ slot, variants, frame, sprite, kind: null, id: -1 });
    }
    return g;
  }

  group.add(floorPlate(), conveyor(), inspectionGantry(), chipPool());

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
    const travel = p * TRAVEL_PER_P;
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
      /* 進出帶尾的兩端縮放淡入淡出，避免循環瞬移被看見 */
      const edge = smooth(clamp01(Math.min(x - BELT_X0, BELT_X0 + CYCLE - x) / 0.5));
      s.slot.position.set(x, BELT_TOP + CHIP.h / 2, 0);
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

  return { group, bounds, materials: M, update, shots, dispose, detail: low ? 'low' : 'high' };
}
