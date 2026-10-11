/* ALONG 181 — 平板觸控繪圖 + 站點卡片
 *
 *   Model     strokes 以「0~1 相對座標」儲存，與螢幕尺寸無關。
 *             車窗長寬比固定（CSS --win-ratio），所以平板與投影的形狀一致。
 *   Renderer  render() 是純函式，平板與投影共用。
 *   Input     Pointer Events（手指、觸控筆、滑鼠通用）。
 *   Bridge    BroadcastChannel；之後可換成 WebSocket。
 *   Mode      網址加 ?mode=projection 即為投影頁（只收不畫）。
 */
(() => {
  'use strict';

  /* ---------- 47 個站點 ----------
   * 順序即卡片編號（01/47 ~ 47/47）；顏色依區間，改 REGIONS 即可調整。
   * 苑裡類 6 站（綠）/ 日南類 25 站（橘）/ 大甲類 16 站（紫） */
  const STATION_NAMES = [
    '苑裡站', '客庄', '蘢德家商(甜心二十四路)', '南房里',
    '福德港', '後壁寮', '船頭埔', '陳厝（順帆路)',
    '羅厝前', '西岐', '西岐里 9 鄰', '西岐里10 鄰',
    '南西岐', '苗圃', '長壽會館', '建興',
    '李厝前', '十甲', '梁厝', '育樂路',
    '頭張（臨江路)', '石頭厝', '鄭厝', '龍泉里',
    '南龍泉賴厝', '四塊寮', '樹仔腳（臨江路）', '孟春',
    '建興入口', '日南車站', '日南國中', '大安溪',
    '鐵砧山（中山路）', '頂店', '永信藥局頂店工廠', '大同醫院',
    '大甲郵局', '大甲車站（中山路）', '大甲', '南陽里(中山路)',
    '大甲高中(中山路)', '議和里', '順天國小', '光田醫院(大甲院區)',
    '大甲體育場', '李綜合醫院', '大甲區公所',
  ];
  const REGIONS = [
    { to: 6,  theme: 'green'  },
    { to: 31, theme: 'orange' },
    { to: 47, theme: 'purple' },
  ];
  const STATIONS = STATION_NAMES.map((name, i) => ({
    name,
    theme: REGIONS.find((r) => i + 1 <= r.to).theme,
  }));

  /* ---------- 設定 ---------- */
  const CONFIG = {
    // card 底色 / ink 繪圖時筆色 / accent 蜂巢與地區字 / text 一般文字 / num 編號
    themes: {
      purple: { card: '#43308e', ink: '#43308e', accent: '#e4601a', text: '#ffffff', num: '#ffffff', region: 'DAJIA'  },
      green:  { card: '#b5d86a', ink: '#b5d86a', accent: '#43308e', text: '#43308e', num: '#e4601a', region: 'YUANLI' },
      orange: { card: '#e4601a', ink: '#e4601a', accent: '#b5d86a', text: '#ffffff', num: '#43308e', region: 'RINAN'  },
    },
    glassGray: '#858585',
    baseWidth: 7,             // 細筆（CSS px）
    penWidthRange: [3, 12],   // 觸控筆依壓力變化
    minDistance: 1.2,
    simplify: 0.01,           // 窗口邊緣簡化程度（越大越像折線）
    windowZone: { x0: 0.04, y0: 0.20, x1: 0.96, y1: 0.855 },  // 卡片上窗口的安全區（避開文字）
    minArea: 0.04,            // 車窗至少佔畫面的比例，太小視為沒畫好
    passengerPrefix: 'No.',   // 卡片左下角，例如 MR. / MS.
    totalStations: STATIONS.length,
    stations: STATIONS,
    font: '"Arial Black","Helvetica Neue","Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
    channel: 'along181',

    // ---- 相機 / 影片 ----
    countdown: 3,                              // 拍照倒數秒數
    videos: {                                  // 背景影片（放在 video/ 資料夾），依站點色分別指定
      default: 'video/181.mp4',                // 找不到對應顏色時的備用影片（可留空）
      purple: 'video/dajia_1.mp4',               // 大甲
      green:  'video/yuanli_1.mp4',              // 苑裡
      orange: 'video/rinan_1.mp4',               // 日南
    },
    requireSegmentation: true,                 // true = 去背沒就緒時不讓拍照（避免拍出完整房間）；false = 沒去背就顯示完整相機畫面
    mediapipe: {                               // 去背模型來源：先試本機 mediapipe/ 資料夾，失敗再用網路
      sources: [
        { bundle: 'mediapipe/vision_bundle.mjs', wasm: 'mediapipe/wasm', model: 'mediapipe/selfie_segmenter.tflite' },
        {
          bundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
          wasm:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
          model:  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        },
      ],
    },
    illustrate: false,       // false = 直接顯示去背後的真人照片；true = 套用下方的插畫化濾鏡

    // 人物與背景影片的分隔效果
    separate: {
      base: 'card',          // 影片底下墊的顏色：'card' = 站點色，或填任何色碼（例如 '#000'）
      videoOpacity: 0.75,    // 影片透明度：1 = 原樣，越小越淡、越接近底色
      dim: 0.2,              // 再蓋一層黑色壓暗，0 ~ 0.6
      glow: 0,              // 人物外圍柔光的寬度（px），0 = 關閉
      glowColor: '#ffffff',  // 柔光顏色
    },

    // 插畫化：低多邊形色塊 + 色調對應，貼近角色插畫的平塗折面
    illus: {
      cell: 12,          // 折面大小（相機像素），越小越細
      jitter: 0.42,      // 折面頂點的隨機偏移
      levels: 5,         // 衣服、頭髮的明暗階數
      sat: 1.4,          // 飽和度加強
      contrast: 1.2,
      mix: 0.3,          // 衣服、頭髮：0 = 保留照片原色，1 = 完全套用下方色盤
      facetJitter: 0.05, // 每片折面隨機明暗，做出切面的立體感
      skinLevels: 4,     // 皮膚明暗階數
      // 皮膚統一成角色插畫的橘棕色（由暗到亮），不論使用者原本膚色
      skin: ['#7a3b2e', '#a85a34', '#c8733f', '#e0925a', '#f2b98a'],
      palettes: {        // 衣服、頭髮的色調（由暗到亮）
        purple: ['#1d1448', '#43308e', '#e4601a', '#f3a56b', '#fbe4c8'],
        green:  ['#2a1d63', '#43308e', '#c8764a', '#b5d86a', '#f6f0cf'],
        orange: ['#2a1d63', '#7a2f5c', '#e4601a', '#f6a76a', '#fde8cf'],
      },
    },
  };

  /* ---------- 狀態 ---------- */
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') === 'projection' ? 'projection' : 'draw';
  document.body.dataset.mode = mode;

  const state = {
    strokes: [],
    current: null,
    activeId: null,
    done: false,
    theme: 'purple',
    station: 0,
    dest: 1,
  };

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const btnClear = $('btnClear');
  const btnDone = $('btnDone');
  const btnAgain = $('btnAgain');
  const hint = $('hint');

  let W = 0, H = 0, DPR = 1;

  /* ---------- Bridge（投影預留） ---------- */
  const Bridge = (() => {
    let ch = null;
    try { ch = new BroadcastChannel(CONFIG.channel); } catch (e) { /* ignore */ }
    return {
      send(type, payload) { if (ch) ch.postMessage({ type, payload }); },
      on(fn) { if (ch) ch.onmessage = (e) => fn(e.data); },
    };
  })();

  /* ---------- 幾何：把手繪輪廓簡化成折線窗口 ---------- */
  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    let dmax = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = len < 1e-6
        ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
        : Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / len;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax <= eps) return [a, b];
    return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  }

  function polyArea(p) {
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      s += p[i].x * q.y - q.x * p[i].y;
    }
    return Math.abs(s) / 2;
  }

  // 回傳像素座標的多邊形陣列
  // 形狀一律以「畫圖時的長寬比」換算成像素：卡片填滿整個螢幕、比例不同時，形狀也不會被拉伸
  const WIN_RATIO = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--win-ratio')) || 1.75;
  function windowPolygons(strokes, w, h) {
    const vw = WIN_RATIO * h;
    return strokes
      .map((s) => rdp(s.pts.map((q) => ({ x: q.x * vw, y: q.y * h })), CONFIG.simplify * h))
      .filter((p) => p.length >= 3);
  }

  /* ---------- 撕紙邊緣 ---------- */
  function rng(seed) {
    let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  // 產生帶參差邊緣的 clip-path（百分比，與尺寸無關）
  function tornClip(seed, amp, step) {
    const r = rng(seed), pts = [];
    const edge = (x0, y0, x1, y1) => {
      const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let i = 0; i < n; i++) {
        const t = i / n, j = r() * amp;
        let x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        if (y0 === y1) y += y0 === 0 ? j : -j; else x += x0 === 0 ? j : -j;
        pts.push(x.toFixed(2) + '% ' + y.toFixed(2) + '%');
      }
    };
    edge(0, 0, 100, 0); edge(100, 0, 100, 100); edge(100, 100, 0, 100); edge(0, 100, 0, 0);
    return 'polygon(' + pts.join(',') + ')';
  }
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--torn-main', tornClip(11, 1.5, 4.5));
  rootStyle.setProperty('--torn-a', tornClip(23, 2.4, 6));
  rootStyle.setProperty('--torn-b', tornClip(37, 2.8, 7));

  // 窗口邊緣加一點撕紙的抖動（種子取自原始形狀，重畫時不會變）
  function roughen(poly, amp, seg, seed) {
    const r = rng(seed), out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const k = Math.max(1, Math.round(len / seg));
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      for (let n = 0; n < k; n++) {
        const t = n / k, off = n ? (r() - 0.5) * 2 * amp : 0;
        out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
      }
    }
    return out;
  }

  // 把使用者畫的形狀「等比例」放進安全區並置中：形狀不變，但不會壓到文字
  function fittedPolygons(strokes, w, h) {
    const polys = windowPolygons(strokes, w, h);
    if (!polys.length) return polys;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polys.forEach((p) => p.forEach((q) => {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }));
    const z = CONFIG.windowZone;
    const zx = z.x0 * w, zy = z.y0 * h, zw = (z.x1 - z.x0) * w, zh = (z.y1 - z.y0) * h;
    const bw = Math.max(x1 - x0, 1), bh = Math.max(y1 - y0, 1);
    const s = Math.min(zw / bw, zh / bh) * 0.98;
    const ox = zx + (zw - bw * s) / 2, oy = zy + (zh - bh * s) / 2;
    return polys.map((p, i) => {
      const fit = p.map((q) => ({ x: ox + (q.x - x0) * s, y: oy + (q.y - y0) * s }));
      return roughen(fit, 0.0045 * h, 0.04 * h, (p[0].x / w) * 9973 + (p[0].y / h) * 7919 + i);
    });
  }

  /* ---------- Renderer：繪圖中 ---------- */
  function strokePath(c, pts, w, h) {
    const p = pts.map((q) => ({ x: q.x * w, y: q.y * h }));
    c.beginPath();
    c.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length - 1; i++) {
      c.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    }
    c.lineTo(p[p.length - 1].x, p[p.length - 1].y);
  }

  function drawStroke(c, s, w, h, ink) {
    const width = s.pts.reduce((a, q) => a + q.w, 0) / s.pts.length;
    const pass = (color, lw) => {
      c.strokeStyle = color; c.fillStyle = color;
      c.lineCap = 'round'; c.lineJoin = 'round';
      if (s.pts.length === 1) {
        c.beginPath(); c.arc(s.pts[0].x * w, s.pts[0].y * h, lw / 2, 0, Math.PI * 2); c.fill();
      } else {
        c.lineWidth = lw; strokePath(c, s.pts, w, h); c.stroke();
      }
    };
    pass('rgba(255,255,255,0.6)', width + 5);   // 白色描邊，讓三種顏色在灰底都看得清
    pass(ink, width);
  }

  function renderDrawing(c, strokes, w, h, t) {
    strokes.forEach((s) => {                    // 自動填入：輪廓內淡淡填色
      if (s.pts.length < 3) return;
      c.save();
      c.globalAlpha = 0.2;
      c.fillStyle = t.ink;
      c.beginPath();
      s.pts.forEach((q, i) => (i ? c.lineTo(q.x * w, q.y * h) : c.moveTo(q.x * w, q.y * h)));
      c.closePath();
      c.fill();
      c.restore();
    });
    strokes.forEach((s) => drawStroke(c, s, w, h, t.ink));
  }

  /* ---------- Renderer：完成後的站點卡片 ---------- */
  const CARD_ZONES = [                    // 卡片上蜂巢出現的區域（相對座標）
    [-0.02, 0.22, 0.12, 0.50],
    [-0.02, 0.56, 0.19, 0.80],
    [0.86, 0.58, 1.02, 0.80],
  ];
  const BACKDROP_ZONES = [                // 開場底板上的蜂巢
    [-0.02, 0.06, 0.15, 0.44],
    [-0.02, 0.54, 0.11, 0.94],
    [0.89, 0.08, 1.02, 0.46],
    [0.85, 0.58, 1.02, 0.94],
  ];
  function drawHexes(c, w, h, color, zones = CARD_ZONES, rel = 0.034) {
    const r = rel * h, dx = Math.sqrt(3) * r, dy = 1.5 * r;
    c.strokeStyle = color;
    c.lineWidth = 0.0075 * h;
    c.lineJoin = 'round';
    for (let row = -1, y = 0; y < h + dy; row++, y += dy) {
      for (let col = -1, x = (row % 2 ? dx / 2 : 0); x < w + dx; col++, x += dx) {
        const fx = x / w, fy = y / h;
        const inZone = zones.some((z) => fx >= z[0] && fx <= z[2] && fy >= z[1] && fy <= z[3]);
        if (!inZone) continue;
        const rnd = Math.abs(Math.sin(row * 12.9898 + col * 78.233) * 43758.5453) % 1;
        if (rnd < 0.14) continue;         // 邊緣參差，像手工排列
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          const px = x + (r * 0.86) * Math.cos(a), py = y + (r * 0.86) * Math.sin(a);
          k ? c.lineTo(px, py) : c.moveTo(px, py);
        }
        c.closePath();
        c.stroke();
      }
    }
  }

  function fitText(c, txt, size, maxW) {
    c.font = `900 ${size}px ${CONFIG.font}`;
    const wd = c.measureText(txt).width;
    if (maxW && wd > maxW) { size *= maxW / wd; c.font = `900 ${size}px ${CONFIG.font}`; }
    return size;
  }

  // 文字外圍描一圈卡片色，疊在白色窗口上也看得清楚
  function label(c, txt, x, y, size, fill, bg, o = {}) {
    c.save();
    c.textAlign = o.align || 'left';
    c.textBaseline = 'alphabetic';
    const s = fitText(c, txt, size, o.maxW);
    if (o.rot) { c.translate(x, y); c.rotate(o.rot); x = 0; y = 0; }
    c.lineJoin = 'round';
    c.lineWidth = s * 0.16;
    c.strokeStyle = bg;
    c.strokeText(txt, x, y);
    c.fillStyle = fill;
    c.fillText(txt, x, y);
    c.restore();
  }

  function renderCard(c, strokes, w, h, theme) {
    const t = CONFIG.themes[theme];
    const st = CONFIG.stations[state.station];
    const dst = CONFIG.stations[state.dest];
    const no = String(state.station + 1).padStart(2, '0');

    c.fillStyle = t.card;
    c.fillRect(0, 0, w, h);
    drawHexes(c, w, h, t.accent);

    // 窗口：使用者畫的形狀（窗內之後放鏡頭與背景影片）
    c.fillStyle = '#ffffff';
    c.beginPath();
    fittedPolygons(strokes, w, h).forEach((poly) => {
      poly.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.closePath();
    });
    c.fill('nonzero');

    // 左上：標誌與標語
    c.save();
    c.font = `900 ${0.075 * h}px ${CONFIG.font}`;
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';
    c.lineWidth = 0.014 * h;
    c.strokeStyle = '#111111';
    c.strokeText('ALONG 181', 0.03 * w, 0.105 * h);
    c.fillStyle = '#ffffff';
    c.fillText('ALONG 181', 0.03 * w, 0.105 * h);
    c.restore();
    label(c, 'ONE ROUTE · 47 PEOPLE · 47 STORIES', 0.032 * w, 0.15 * h, 0.026 * h, t.text, t.card, { rot: -0.02 });

    // 右上：地區與編號
    label(c, t.region, 0.97 * w, 0.115 * h, 0.13 * h, t.accent, t.card, { align: 'right', maxW: 0.4 * w });
    label(c, no + '/' + CONFIG.totalStations, 0.97 * w, 0.19 * h, 0.06 * h, t.num, t.card, { align: 'right' });

    // 底部：乘客編號 / 起訖站 / NO.181
    label(c, CONFIG.passengerPrefix + ' ' + Number(no), 0.03 * w, 0.945 * h, 0.1 * h, t.text, t.card, { maxW: 0.26 * w });
    label(c, st.name, 0.31 * w, 0.915 * h, 0.05 * h, t.text, t.card, { maxW: 0.2 * w });
    label(c, dst.name, 0.74 * w, 0.915 * h, 0.05 * h, t.text, t.card, { align: 'right', maxW: 0.2 * w });
    c.save();                                                    // 箭頭線
    c.strokeStyle = t.text; c.fillStyle = t.text;
    c.lineWidth = 0.004 * h;
    c.beginPath(); c.moveTo(0.31 * w, 0.945 * h); c.lineTo(0.75 * w, 0.945 * h); c.stroke();
    c.beginPath(); c.moveTo(0.755 * w, 0.945 * h); c.lineTo(0.738 * w, 0.935 * h); c.lineTo(0.738 * w, 0.955 * h); c.closePath(); c.fill();
    c.restore();
    label(c, 'NO.181', 0.97 * w, 0.945 * h, 0.085 * h, t.text, t.card, { align: 'right', maxW: 0.2 * w });
  }

  function render(c, strokes, w, h, theme, done) {
    c.clearRect(0, 0, w, h);
    if (done) renderCard(c, strokes, w, h, theme);
    else renderDrawing(c, strokes, w, h, CONFIG.themes[theme]);
  }

  function redraw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    render(ctx, state.strokes.concat(state.current ? [state.current] : []), W, H, state.theme, state.done);
  }

  /* ---------- 開場底板（站點色 + 蜂巢） ---------- */
  const bd = $('backdrop');
  const bctx = bd.getContext('2d');
  function renderBackdrop() {
    const r = bd.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const d = Math.min(window.devicePixelRatio || 1, 3);
    bd.width = Math.round(r.width * d);
    bd.height = Math.round(r.height * d);
    bctx.setTransform(d, 0, 0, d, 0, 0);
    bctx.clearRect(0, 0, r.width, r.height);
    const w = r.width, h = r.height;
    drawHexes(bctx, w, h, CONFIG.themes[state.theme].accent, BACKDROP_ZONES, 0.036);
  }
  new ResizeObserver(renderBackdrop).observe(bd);

  /* ---------- 尺寸 ---------- */
  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 3);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    live.width = canvas.width; live.height = canvas.height;
    if (state.done) computeGeom();
    redraw();
  }
  new ResizeObserver(resize).observe(canvas);

  /* ---------- 輸入 ---------- */
  function toPoint(e) {
    const r = canvas.getBoundingClientRect();
    let wdt = CONFIG.baseWidth;
    if (e.pointerType === 'pen' && e.pressure > 0) {
      const [a, b] = CONFIG.penWidthRange;
      wdt = a + (b - a) * e.pressure;
    }
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: wdt };
  }

  function addPoint(e) {
    const p = toPoint(e);
    const last = state.current.pts[state.current.pts.length - 1];
    if (last) {
      const dx = (p.x - last.x) * W, dy = (p.y - last.y) * H;
      if (dx * dx + dy * dy < CONFIG.minDistance ** 2) return;
    }
    state.current.pts.push(p);
  }

  function onDown(e) {
    if (state.done || state.activeId !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    state.activeId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    state.current = { pts: [] };
    addPoint(e);
    document.body.classList.add('has-ink');
    scheduleRedraw();
  }

  function onMove(e) {
    if (e.pointerId !== state.activeId || !state.current) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (events.length ? events : [e]).forEach(addPoint);
    scheduleRedraw();
  }

  function onUp(e) {
    if (e.pointerId !== state.activeId) return;
    if (state.current && state.current.pts.length) {
      state.strokes.push(state.current);
      Bridge.send('stroke', state.current);
    }
    state.current = null;
    state.activeId = null;
    updateButtons();
    redraw();
  }

  let raf = 0;
  function scheduleRedraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; redraw(); });
  }

  /* ---------- 隨機分配站點 ----------
   * 洗牌後逐張抽，47 個抽完才重新洗牌 → 一輪內不會重複。 */
  const DECK_KEY = 'along181-deck-v2';
  function drawStationIndex() {
    let deck = null;
    try { deck = JSON.parse(localStorage.getItem(DECK_KEY)); } catch (e) { /* ignore */ }
    if (!Array.isArray(deck) || !deck.length) {
      deck = CONFIG.stations.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) {
        const k = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[k]] = [deck[k], deck[i]];
      }
    }
    const idx = deck.pop();
    try { localStorage.setItem(DECK_KEY, JSON.stringify(deck)); } catch (e) { /* ignore */ }
    return idx;
  }

  // 下車站：181 由苑裡往大甲，優先抽編號較大的站；最後一站則抽前面的站
  function pickDestination(idx) {
    const n = CONFIG.stations.length;
    const pool = [];
    if (idx < n - 1) for (let i = idx + 1; i < n; i++) pool.push(i);
    else for (let i = 0; i < idx; i++) pool.push(i);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function setTheme(name) {
    if (!CONFIG.themes[name]) return;
    state.theme = name;
    document.body.dataset.theme = name;
    renderBackdrop();
    redraw();
    Bridge.send('theme', { theme: name });
  }

  function assignStation() {
    state.station = drawStationIndex();
    state.dest = pickDestination(state.station);
    setTheme(CONFIG.stations[state.station].theme);
  }

  /* ---------- 按鈕與狀態 ---------- */
  function updateButtons() {
    btnDone.disabled = state.strokes.length === 0;
  }

  let hintTimer = 0;
  function showHint(msg) {
    hint.textContent = msg;
    hint.classList.add('is-show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('is-show'), 2200);
  }

  function clearAll() {
    state.strokes = [];
    state.current = null;
    state.activeId = null;
    document.body.classList.remove('has-ink');
    updateButtons();
    redraw();
    Bridge.send('clear');
  }

  function finish() {
    if (!state.strokes.length) return;
    const area = windowPolygons(state.strokes, W, H).reduce((a, p) => a + polyArea(p), 0);
    if (area < CONFIG.minArea * W * H) {
      showHint('車窗再畫大一點，並把線繞一圈');
      return;
    }
    state.done = true;
    document.body.dataset.state = 'done';
    btnDone.hidden = true;
    btnAgain.hidden = false;
    redraw();
    Bridge.send('done', { strokes: state.strokes, theme: state.theme, station: state.station, dest: state.dest });
    enterCameraStage();
  }

  function restart() {
    leaveCameraStage();
    state.done = false;
    document.body.dataset.state = 'drawing';
    btnAgain.hidden = true;
    btnDone.hidden = false;
    clearAll();
    assignStation();
  }

  /* 對外介面：之後存檔 / 上傳 / 投影合成（鏡頭與影片）會用到 */
  window.ALONG181 = {
    getStrokes: () => JSON.parse(JSON.stringify(state.strokes)),
    // 窗口多邊形，0~1 相對座標；鏡頭與影片只要用它當遮罩即可
    getWindowPolygons: () => fittedPolygons(state.strokes, W, H).map((p) => p.map((q) => ({ x: q.x / W, y: q.y / H }))),
    getTheme: () => state.theme,
    getStation: () => ({
      index: state.station, name: CONFIG.stations[state.station].name,
      dest: CONFIG.stations[state.dest].name, no: String(state.station + 1).padStart(2, '0') + '/' + CONFIG.totalStations,
    }),
    exportPNG: () => canvas.toDataURL('image/png'),
    stylizeImage: (frameCanvas, alpha, theme) => stylize(frameCanvas, alpha, theme || state.theme),   // 單獨測試插畫化用
    setSegmenter: (s) => { media.segmenter = s; media.segErrors = 0; setSegReady(); },   // 換成自己的去背模型
  };

  /* ================= 相機 + 去背 + 插畫化 + 背景影片 =================
   * 流程：完成 → 開相機（即時去背預覽）→ 拍照倒數 → 插畫化 → 疊在背景影片上。
   * 合成畫在 #live，用「使用者畫的窗口形狀」裁切；下方的卡片 canvas 完全不用動。 */
  const live = $('live');
  const lctx = live.getContext('2d');
  const cam = $('cam');
  const bgv = $('bgvideo');
  const btnShot = $('btnShot');
  const btnSave = $('btnSave');
  const camMsg = $('camMsg');
  const countEl = $('count');
  const flashEl = $('flash');

  const media = {
    camReady: false, segmenter: null, segLoading: false, segRetry: 0, segErrors: 0,
    work: document.createElement('canvas'),   // 鏡像後的相機畫面
    cut: document.createElement('canvas'),    // 去背後的畫面（即時預覽）
    alpha: null, votes: 0, voteN: 0, lastSeg: 0,
    shot: null,       // 插畫化後的人像（canvas）
    shotImg: null,    // 投影頁收到的人像（Image）
    poly: null, bbox: null, raf: 0, counting: false,
  };
  const wctx = media.work.getContext('2d', { willReadFrequently: true });
  const cctx = media.cut.getContext('2d');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let msgTimer = 0;
  function setMsg(text, ms) {
    camMsg.textContent = text || '';
    camMsg.classList.toggle('is-show', !!text);
    clearTimeout(msgTimer);
    if (text && ms) msgTimer = setTimeout(() => camMsg.classList.remove('is-show'), ms);
  }

  /* --- 窗口幾何（與卡片上白色窗口完全相同的多邊形） --- */
  function computeGeom() {
    if (!state.strokes.length || !W || !H) { media.poly = null; media.bbox = null; return; }
    media.poly = fittedPolygons(state.strokes, W, H);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    media.poly.forEach((p) => p.forEach((q) => {
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }));
    media.bbox = { x0, y0, x1, y1 };
  }

  /* --- 背景影片 --- */
  // 以影片本身的狀態判斷能不能畫（不依賴只會觸發一次的事件，重複測試也不會失效）
  const bgReady = () => bgv.readyState >= 2 && bgv.videoWidth > 0 && !bgv.error;
  const isFrozen = () => (mode === 'projection' ? !!media.shotImg : !!media.shot);
  function startBgVideo() {
    const src = CONFIG.videos[state.theme] || CONFIG.videos.default;
    if (!src) return;
    if (bgv.dataset.src !== src) { bgv.dataset.src = src; bgv.src = src; }
    else if (bgv.readyState > 0) bgv.currentTime = 0;               // 同一支影片：從頭再播
    const p = bgv.play();
    if (p && p.catch) p.catch(() => { /* 被擋時，畫面更新迴圈會再試 */ });
  }
  function stopBgVideo() { bgv.pause(); }
  function freezeBgVideo(t) {                                         // 拍照：影片定格
    if (typeof t === 'number' && isFinite(t)) { try { bgv.currentTime = t; } catch (e) { /* ignore */ } }
    bgv.pause();
  }
  function resumeBgVideo() {                                          // 重拍：影片繼續
    const p = bgv.play();
    if (p && p.catch) p.catch(() => {});
  }

  /* --- 相機 --- */
  async function startCamera() {
    if (media.camReady || mode !== 'draw') return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMsg('這個瀏覽器不能開相機：請用 https 或 localhost 開啟頁面', 6000);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      cam.srcObject = stream;
      await cam.play();
      const w = 640, h = Math.round((w * (cam.videoHeight || 360)) / (cam.videoWidth || 640));
      [media.work, media.cut].forEach((c) => { c.width = w; c.height = h; });
      media.alpha = null;
      media.camReady = true;
    } catch (e) {
      console.warn(e);
      setMsg('無法開啟相機：請允許相機權限', 6000);
    }
  }
  function stopCamera() {
    const s = cam.srcObject;
    if (s) s.getTracks().forEach((t) => t.stop());
    cam.srcObject = null;
    media.camReady = false;
  }

  /* --- 去背模型（拍照階段才載入；失敗會自動重試，執行中出錯會自動重建） --- */
  const absUrl = (u) => new URL(u, document.baseURI).href;
  async function loadSegmenter(src) {
    const mp = await import(absUrl(src.bundle));
    const fileset = await mp.FilesetResolver.forVisionTasks(absUrl(src.wasm));
    for (const delegate of ['GPU', 'CPU']) {
      try {
        return await mp.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: absUrl(src.model), delegate },
          runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false,
        });
      } catch (e) { console.warn('segmenter', delegate, e); }
    }
    throw new Error('ImageSegmenter 建立失敗');
  }
  function setSegReady() {
    setMsg('');
    if (!media.counting && !media.shot) btnShot.disabled = false;
  }
  async function initSegmenter() {
    if (media.segmenter || media.segLoading || mode !== 'draw') return;
    media.segLoading = true;
    clearTimeout(media.segRetry);
    setMsg('載入去背模型…');
    let seg = null;
    for (const src of CONFIG.mediapipe.sources) {
      try { seg = await loadSegmenter(src); console.info('去背模型來源：', src.bundle); break; }
      catch (e) { console.warn('去背模型來源失敗：', src.bundle, e); }
    }
    media.segLoading = false;
    if (seg) { media.segmenter = seg; media.segErrors = 0; setSegReady(); return; }
    setMsg(CONFIG.requireSegmentation ? '去背模型載入失敗，請檢查網路（自動重試中…）' : '去背模型載入失敗，先顯示完整相機畫面');
    media.segRetry = setTimeout(() => { if (state.done) initSegmenter(); }, 8000);   // 8 秒後再試
  }
  function onSegError(e) {                       // 連續出錯 3 次：丟掉舊的、重新建立
    console.warn('去背執行錯誤', e);
    media.segErrors = (media.segErrors || 0) + 1;
    if (media.segErrors < 3) return;
    try { if (media.segmenter && media.segmenter.close) media.segmenter.close(); } catch (_) { /* ignore */ }
    media.segmenter = null; media.segErrors = 0;
    if (!media.counting && !media.shot && CONFIG.requireSegmentation) btnShot.disabled = true;
    initSegmenter();
  }

  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function meanRegion(arr, mw, mh, x0, y0, x1, y1) {
    let s = 0, n = 0;
    for (let y = Math.floor(y0 * mh); y < y1 * mh; y += 6) {
      for (let x = Math.floor(x0 * mw); x < x1 * mw; x += 6) { s += arr[y * mw + x]; n++; }
    }
    return n ? s / n : 0;
  }

  /* --- 每一幀：相機 → 鏡像 → 去背 --- */
  function pumpCamera(now) {
    if (mode !== 'draw' || !media.camReady || cam.readyState < 2) return;
    const w = media.work.width, h = media.work.height;
    wctx.save(); wctx.translate(w, 0); wctx.scale(-1, 1);       // 鏡像，像照鏡子
    wctx.drawImage(cam, 0, 0, w, h);
    wctx.restore();
    if (now - media.lastSeg < 45) return;                        // 約 20fps
    media.lastSeg = now;

    const frame = wctx.getImageData(0, 0, w, h);
    const alpha = media.alpha && media.alpha.length === w * h ? media.alpha : new Uint8ClampedArray(w * h);
    if (media.segmenter) {
      try {
        media.segmenter.segmentForVideo(media.work, now, (res) => {
          const masks = res.confidenceMasks;
          if (!masks || !masks.length) return;
          const m = masks[masks.length > 1 ? 1 : 0];
          const arr = m.getAsFloat32Array(), mw = m.width, mh = m.height;
          if (media.voteN < 12) {          // 自動判斷遮罩方向（人 = 高值，或相反）
            const c = meanRegion(arr, mw, mh, 0.35, 0.45, 0.65, 0.95);
            const b = (meanRegion(arr, mw, mh, 0, 0.2, 0.1, 0.95) + meanRegion(arr, mw, mh, 0.9, 0.2, 1, 0.95)) / 2;
            media.votes += c >= b ? 1 : -1; media.voteN++;
          }
          const invert = media.votes < 0;
          for (let y = 0; y < h; y++) {
            const row = Math.min(mh - 1, Math.floor((y * mh) / h)) * mw;
            for (let x = 0; x < w; x++) {
              let p = arr[row + Math.min(mw - 1, Math.floor((x * mw) / w))];
              if (invert) p = 1 - p;
              alpha[y * w + x] = smooth(0.35, 0.65, p) * 255;
            }
          }
        });
        media.segErrors = 0;
      } catch (e) { onSegError(e); }
    } else if (CONFIG.requireSegmentation) {
      media.alpha = null;                   // 去背沒就緒：不顯示相機畫面，等模型載入
      return;
    } else {
      alpha.fill(255);                      // 設定為允許時：沒有去背就用完整畫面
    }
    media.alpha = alpha;
    const d = frame.data;
    for (let i = 0; i < alpha.length; i++) d[i * 4 + 3] = alpha[i];
    cctx.putImageData(frame, 0, 0);
  }

  /* ================= 插畫化 ================= */
  const hexRgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      return 255 * (t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p);
    };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  function gradientAt(stops, t) {
    const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1), i = Math.floor(x), f = x - i;
    return stops[i].map((v, k) => v + (stops[i + 1][k] - v) * f);
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function isSkin(h, s, l) {
    return h >= 0.015 && h <= 0.11 && s >= 0.18 && s <= 0.58 && l >= 0.15 && l <= 0.88;   // 紅色衣服飽和度較高，不會被當成皮膚
  }
  function illustrate(r, g, b, palette, skin, jit) {
    const I = CONFIG.illus;
    let [h, s, l] = rgbToHsl(r, g, b);
    l = clamp01((l - 0.5) * I.contrast + 0.5 + jit);
    if (isSkin(h, s, l)) {                                          // 皮膚：統一成插畫的橘棕色
      const t = clamp01((l - 0.22) / 0.55);
      const q = Math.round(t * (I.skinLevels - 1)) / (I.skinLevels - 1);
      return gradientAt(skin, q).map(Math.round);
    }
    s = clamp01(s * I.sat);
    l = Math.round(l * (I.levels - 1)) / (I.levels - 1);             // 明暗分階，形成平塗色塊
    const base = hslToRgb(h, s, l), map = gradientAt(palette, l);
    return base.map((v, k) => Math.round(v * (1 - I.mix) + map[k] * I.mix));
  }

  // 低多邊形：以帶抖動的格點切成三角形，每片平塗一色；輪廓也會變成折線，像角色插畫的切面
  function stylize(frame, alpha, theme) {
    const w = frame.width, h = frame.height, I = CONFIG.illus;
    const src = frame.getContext('2d').getImageData(0, 0, w, h).data;
    const palette = (I.palettes[theme] || I.palettes.purple).map(hexRgb);
    const skin = I.skin.map(hexRgb);
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d');
    const rnd = rng(7), cell = I.cell;
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
    const pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
        pts.push({
          x: c * cell + (edge ? 0 : (rnd() - 0.5) * cell * I.jitter * 2),
          y: r * cell + (edge ? 0 : (rnd() - 0.5) * cell * I.jitter * 2),
        });
      }
    }
    const P = (r, c) => pts[r * cols + c];
    const px = (x, y) => {
      const xi = Math.min(w - 1, Math.max(0, Math.round(x))), yi = Math.min(h - 1, Math.max(0, Math.round(y)));
      return [xi, yi];
    };
    const fillTri = (a, b, c) => {
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
      const [ax, ay] = px(cx, cy);
      if (alpha[ay * w + ax] < 128) return;                         // 人像以外不畫
      let R = 0, G = 0, B = 0, n = 0;
      [[0, 0], [cell / 3, 0], [-cell / 3, 0], [0, cell / 3], [0, -cell / 3]].forEach(([dx, dy]) => {
        const [sx, sy] = px(cx + dx, cy + dy), k = (sy * w + sx) * 4;
        R += src[k]; G += src[k + 1]; B += src[k + 2]; n++;
      });
      const [cr, cg, cb] = illustrate(R / n, G / n, B / n, palette, skin, (rnd() - 0.5) * I.facetJitter);
      const col = `rgb(${cr},${cg},${cb})`;
      o.fillStyle = col; o.strokeStyle = col; o.lineWidth = 0.8; o.lineJoin = 'round';
      o.beginPath(); o.moveTo(a.x, a.y); o.lineTo(b.x, b.y); o.lineTo(c.x, c.y); o.closePath();
      o.fill(); o.stroke();
    };
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const p00 = P(r, c), p10 = P(r, c + 1), p01 = P(r + 1, c), p11 = P(r + 1, c + 1);
        if ((r + c) % 2) { fillTri(p00, p10, p11); fillTri(p00, p11, p01); }
        else { fillTri(p00, p10, p01); fillTri(p10, p11, p01); }
      }
    }
    return out;
  }

  /* ================= 合成：背景影片 + 人像，裁成窗口形狀 ================= */
  function drawCover(c, el, ew, eh, x, y, w, h) {
    const s = Math.max(w / ew, h / eh), dw = ew * s, dh = eh * s;
    c.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function personSource() {
    if (mode === 'projection') return media.shotImg;
    return media.shot || (media.camReady && media.alpha ? media.cut : null);
  }
  function liveFrame(now) {
    media.raf = 0;
    if (!state.done) return;
    if (!media.shot) pumpCamera(now);
    if (bgv.paused && !isFrozen() && bgv.dataset.src && now - (media.lastPlayTry || 0) > 1000) {
      media.lastPlayTry = now; resumeBgVideo();
    }
    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    lctx.clearRect(0, 0, W, H);
    if (media.poly && media.poly.length && media.bbox) {
      const b = media.bbox, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      lctx.save();
      lctx.beginPath();
      media.poly.forEach((p) => {
        p.forEach((q, i) => (i ? lctx.lineTo(q.x, q.y) : lctx.moveTo(q.x, q.y)));
        lctx.closePath();
      });
      lctx.clip();
      const S = CONFIG.separate, th = CONFIG.themes[state.theme];
      lctx.fillStyle = S.base === 'card' ? th.card : S.base;               // 底色
      lctx.fillRect(b.x0, b.y0, bw, bh);
      if (bgReady()) {                                                      // 影片（調淡）
        lctx.globalAlpha = S.videoOpacity;
        drawCover(lctx, bgv, bgv.videoWidth, bgv.videoHeight, b.x0, b.y0, bw, bh);
        lctx.globalAlpha = 1;
      }
      if (S.dim > 0) { lctx.fillStyle = `rgba(0,0,0,${S.dim})`; lctx.fillRect(b.x0, b.y0, bw, bh); }
      const src = personSource();
      if (src) {
        const pw = src.naturalWidth || src.width, ph = src.naturalHeight || src.height;
        const s = Math.max(bw / pw, bh / ph);                  // 填滿窗口，人像靠下置中
        const px = b.x0 + (bw - pw * s) / 2, py = b.y1 - ph * s;
        if (S.glow > 0) {                                      // 外圍柔光：把人和影片隔開
          lctx.save();
          lctx.shadowColor = S.glowColor;
          lctx.shadowBlur = S.glow * DPR;
          lctx.drawImage(src, px, py, pw * s, ph * s);
          lctx.drawImage(src, px, py, pw * s, ph * s);         // 疊兩次，光暈更明顯
          lctx.restore();
        } else {
          lctx.drawImage(src, px, py, pw * s, ph * s);
        }
      }
      lctx.restore();
    }
    media.raf = requestAnimationFrame(liveFrame);
  }
  function startLive() { if (!media.raf) media.raf = requestAnimationFrame(liveFrame); }
  function clearLive() {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
  }

  /* ================= 拍照 ================= */
  async function takeShot() {
    if (media.counting) return;
    if (media.shot) {                                  // 重拍
      media.shot = null;
      btnShot.textContent = '拍照';
      resumeBgVideo();
      btnSave.hidden = true;
      Bridge.send('shot', { png: null });
      return;
    }
    if (!media.camReady) { setMsg('相機還沒準備好', 3000); return; }
    if (CONFIG.requireSegmentation && !media.segmenter) { setMsg('去背模型還沒載入完成，請稍候', 3000); return; }
    media.counting = true;
    btnShot.disabled = true;
    for (let n = CONFIG.countdown; n > 0; n--) { countEl.textContent = n; await sleep(1000); }
    countEl.textContent = '';
    flashEl.classList.remove('is-on'); void flashEl.offsetWidth; flashEl.classList.add('is-on');

    const frame = document.createElement('canvas');   // 以倒數結束當下的畫面為準
    frame.width = media.work.width; frame.height = media.work.height;
    frame.getContext('2d').drawImage(media.work, 0, 0);
    const alpha = media.alpha ? media.alpha.slice() : new Uint8ClampedArray(frame.width * frame.height).fill(255);
    if (CONFIG.illustrate) media.shot = stylize(frame, alpha, state.theme);
    else {                                              // 直接保留去背後的真人照片
      const d = frame.getContext('2d').getImageData(0, 0, frame.width, frame.height);
      for (let i = 0; i < alpha.length; i++) d.data[i * 4 + 3] = alpha[i];
      frame.getContext('2d').putImageData(d, 0, 0);
      media.shot = frame;
    }
    freezeBgVideo();                                    // 背景影片跟人物一起定格
    btnSave.hidden = false;
    btnShot.textContent = '重拍';
    btnShot.disabled = false;
    media.counting = false;
    Bridge.send('shot', { png: media.shot.toDataURL('image/png'), t: bgv.currentTime });
  }


  /* ================= 存成圖片：卡片 + 窗口內的人物與定格影片 ================= */
  function composeCard() {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;             // 以裝置解析度輸出
    const x = c.getContext('2d');
    x.drawImage(canvas, 0, 0);                                    // 底層：站點卡片
    x.drawImage(live, 0, 0);                                      // 上層：窗口內的影片與人物
    return c;
  }
  async function saveImage() {
    if (!media.shot) return;
    let blob;
    try { blob = await new Promise((res) => composeCard().toBlob(res, 'image/png')); }
    catch (e) { setMsg('無法輸出圖片：請用 http(s) 或 localhost 開啟頁面', 5000); return; }
    if (!blob) { setMsg('圖片輸出失敗', 3000); return; }
    const st = CONFIG.stations[state.station];
    const no = String(state.station + 1).padStart(2, '0');
    const name = ('ALONG181_' + no + '_' + st.name).replace(/[\\/:*?"<>|()（）\s]+/g, '_') + '.png';
    const file = new File([blob], name, { type: 'image/png' });
    // 平板 / 手機：開啟系統分享（存到相簿、AirDrop、列印）；電腦：直接下載
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'ALONG 181' }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    setMsg('已存成圖片', 2500);
  }

  function enterCameraStage() {
    computeGeom();
    media.shot = null;
    btnShot.hidden = false;
    btnSave.hidden = true;
    btnShot.disabled = CONFIG.requireSegmentation && !media.segmenter;   // 去背就緒前先不能按
    btnShot.textContent = '拍照';
    startBgVideo();
    startCamera();
    initSegmenter();
    startLive();
  }
  function leaveCameraStage() {
    media.shot = null; media.counting = false;
    countEl.textContent = '';
    setMsg('');
    btnShot.hidden = true;
    btnSave.hidden = true;
    clearTimeout(media.segRetry);
    stopCamera();
    stopBgVideo();
    clearLive();
  }


  /* ---------- 啟動 ---------- */
  if (mode === 'projection') {
    Bridge.on(({ type, payload }) => {
      if (type === 'stroke') state.strokes.push(payload);
      if (type === 'clear') { state.strokes = []; state.done = false; media.shotImg = null; clearLive(); stopBgVideo(); }
      if (type === 'shot') {
        if (!payload.png) { media.shotImg = null; resumeBgVideo(); }
        else { const im = new Image(); im.onload = () => { media.shotImg = im; freezeBgVideo(payload.t); }; im.src = payload.png; }
      }
      if (type === 'theme') setTheme(payload.theme);
      if (type === 'done') {
        state.strokes = payload.strokes; state.station = payload.station; state.dest = payload.dest;
        setTheme(payload.theme); state.done = true;
        computeGeom(); startBgVideo(); startLive();
      }
      redraw();
    });
  } else {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    btnClear.addEventListener('click', clearAll);
    btnDone.addEventListener('click', finish);
    btnAgain.addEventListener('click', restart);
    btnShot.addEventListener('click', takeShot);
    btnSave.addEventListener('click', saveImage);
  }

  ['contextmenu', 'gesturestart', 'gesturechange', 'dblclick'].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  resize();
  updateButtons();
  if (mode === 'draw') assignStation();
})();