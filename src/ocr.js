/*
 * FormulaOCR — 수식 이미지를 LaTeX로 인식한다. 머신러닝/AI 없이 고전 알고리즘만 사용:
 *   1) Otsu 이진화  2) 연결 요소 분석  3) i·=·≤·÷ 처럼 여러 조각인 글자 병합
 *   4) KaTeX 글꼴로 그린 템플릿과 챔퍼(chamfer) 거리 비교  5) 기하 배치로 분수·루트·첨자·극한 복원
 * 브라우저 전용(canvas, document.fonts 사용).
 */
(function (root, factory) {
  root.FormulaOCR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 32; // 정규화 크기
  const DOT = 0.4; // 점(.)으로 볼 최대 크기(글자 높이 대비)

  // ───────────────────────── 템플릿 ─────────────────────────

  const GREEK = {
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ϵ': 'epsilon', 'ε': 'varepsilon', 'ζ': 'zeta',
    'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi',
    'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau', 'υ': 'upsilon', 'ϕ': 'phi', 'φ': 'varphi', 'χ': 'chi',
    'ψ': 'psi', 'ω': 'omega', 'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta', 'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi',
    'Σ': 'Sigma', 'Φ': 'Phi', 'Ψ': 'Psi', 'Ω': 'Omega',
  };
  const SYM_LATEX = {
    '−': '-', '×': '\\times', '÷': '\\div', '±': '\\pm', '≤': '\\le', '≥': '\\ge', '≠': '\\neq', '→': '\\to',
    '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '∈': '\\in', '≈': '\\approx', '{': '\\{', '}': '\\}',
    '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∮': '\\oint', '′': "'", '·': '\\cdot',
  };
  const toLatex = (ch) => SYM_LATEX[ch] ?? (GREEK[ch] ? '\\' + GREEK[ch] : ch);

  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SERIF = '"Times New Roman", Times, serif';
  const SANS = 'Arial, Helvetica, sans-serif';
  const WORDS = ['arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'log', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'ln'];
  const SPECS = [
    // [문자들, 글꼴, 스타일, 분류]
    ['0123456789', 'KaTeX_Main', 'normal', 'digit'],
    [WORDS, 'KaTeX_Main', 'normal', 'word'], // 작은 글씨에서 붙어 버린 sin, lim … 을 통째로 인식
    ['+=()[]{}|/<>,.;:!′≤≥≠±×÷→∞∂∇∈≈', 'KaTeX_Main', 'normal', 'sym'],
    [LOWER, 'KaTeX_Main', 'normal', 'roman'],
    ['ΓΔΘΛΞΠΣΦΨΩ', 'KaTeX_Main', 'normal', 'greek'],
    [LOWER + UPPER, 'KaTeX_Math', 'italic', 'letter'],
    ['αβγδϵεζηθικλμνξπρστυϕφχψω', 'KaTeX_Math', 'italic', 'greek'],
    ['∑∏∫∮', 'KaTeX_Size1', 'normal', 'bigop'],
    ['∑∏∫∮', 'KaTeX_Size2', 'normal', 'bigop'],
    ['()[]{}', 'KaTeX_Size1', 'normal', 'delim'],
    ['()[]{}', 'KaTeX_Size2', 'normal', 'delim'],
    ['0123456789+=()<>,.:!', SERIF, 'normal', 'digit'],
    [LOWER + UPPER, SERIF, 'italic', 'letter'],
    ['0123456789+=()<>,.:!×', SANS, 'normal', 'digit'],
    [LOWER + UPPER, SANS, 'normal', 'letter'],
  ];
  const STRETCHY = new Set(['(', ')', '[', ']', '\\{', '\\}', '|', '\\int', '\\oint', '/']);

  let templatesPromise = null;
  function getTemplates() {
    if (!templatesPromise) templatesPromise = buildTemplates();
    return templatesPromise;
  }

  async function buildTemplates() {
    const S = 96;
    if (document.fonts) {
      await Promise.all(SPECS.map(([chars, font, style]) =>
        document.fonts.load(`${style} ${S}px ${font}`, [].concat(chars).join('')).catch(() => null)));
    }
    const W = S * 4, H = S * 4, BASE = S * 2.5;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const [chars, font, style, cls] of SPECS) {
      for (const ch of chars) {
        ctx.clearRect(0, 0, W, H);
        ctx.font = `${style} ${S}px ${font}`;
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(ch, S, BASE);
        // KaTeX 는 ≠ 를 '=' 위에 사선을 겹쳐 그린다
        if (ch === '≠') {
          ctx.clearRect(0, 0, W, H);
          ctx.fillText('=', S, BASE);
          ctx.fillText('/', S + (ctx.measureText('=').width - ctx.measureText('/').width) / 2, BASE);
        }
        const img = ctx.getImageData(0, 0, W, H).data;
        const bin = new Uint8Array(W * H);
        for (let k = 0; k < W * H; k++) bin[k] = img[k * 4 + 3] > 110 ? 1 : 0;
        const bb = bbox(bin, W, H);
        if (!bb) continue;
        const crop = cropBits(bin, W, bb);
        const latex = cls === 'word' ? '\\' + ch : toLatex(ch);
        out.push(Object.assign(makeShape(crop, bb.w, bb.h), {
          ch, latex, font, cls,
          parts: countParts(crop, bb.w, bb.h),
          top: (BASE - bb.y0) / S, bot: (bb.y1 - BASE) / S,
          stretchy: STRETCHY.has(latex),
        }));
      }
    }
    return out;
  }

  // ───────────────────────── 비트맵 유틸 ─────────────────────────

  function bbox(bin, W, H) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (bin[y * W + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    return { x0, y0, x1: x1 + 1, y1: y1 + 1, w: x1 + 1 - x0, h: y1 + 1 - y0 };
  }

  function cropBits(bin, W, bb) {
    const c = new Uint8Array(bb.w * bb.h);
    for (let y = 0; y < bb.h; y++) for (let x = 0; x < bb.w; x++) c[y * bb.w + x] = bin[(bb.y0 + y) * W + bb.x0 + x];
    return c;
  }

  function countParts(bits, w, h) {
    const seen = new Uint8Array(w * h);
    let n = 0;
    for (let s = 0; s < w * h; s++) {
      if (!bits[s] || seen[s]) continue;
      n++;
      const stack = [s];
      seen[s] = 1;
      while (stack.length) {
        const q = stack.pop(), x = q % w, y = (q - x) / w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const r = ny * w + nx;
          if (bits[r] && !seen[r]) { seen[r] = 1; stack.push(r); }
        }
      }
    }
    return n;
  }

  // 종횡비를 유지한 채 N×N 에 넣고(면적 평균), 챔퍼 비교용 거리 변환까지 계산
  function makeShape(bits, w, h) {
    const sat = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += bits[y * w + x];
        sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
      }
    }
    const sum = (ax, ay, bx, by) => sat[by * (w + 1) + bx] - sat[ay * (w + 1) + bx] - sat[by * (w + 1) + ax] + sat[ay * (w + 1) + ax];
    const scale = (N - 2) / Math.max(w, h);
    const offx = (N - w * scale) / 2, offy = (N - h * scale) / 2;
    const ink = new Uint8Array(N * N);
    const pts = [];
    for (let oy = 0; oy < N; oy++) for (let ox = 0; ox < N; ox++) {
      let ax = (ox - offx) / scale, bx = (ox + 1 - offx) / scale;
      let ay = (oy - offy) / scale, by = (oy + 1 - offy) / scale;
      if (bx <= 0 || by <= 0 || ax >= w || ay >= h) continue;
      ax = Math.max(0, Math.floor(ax)); ay = Math.max(0, Math.floor(ay));
      bx = Math.min(w, Math.max(ax + 1, Math.ceil(bx))); by = Math.min(h, Math.max(ay + 1, Math.ceil(by)));
      const cov = sum(ax, ay, bx, by) / ((bx - ax) * (by - ay));
      if (cov >= 0.3) { ink[oy * N + ox] = 1; pts.push(oy * N + ox); }
    }
    return { ink, pts, dt: distanceTransform(ink), asp: (w + 1) / (h + 1) };
  }

  function distanceTransform(ink) {
    const INF = 1e9, d = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) d[k] = ink[k] ? 0 : INF;
    const D1 = 1, D2 = Math.SQRT2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = y * N + x;
      let v = d[k];
      if (x > 0) v = Math.min(v, d[k - 1] + D1);
      if (y > 0) {
        v = Math.min(v, d[k - N] + D1);
        if (x > 0) v = Math.min(v, d[k - N - 1] + D2);
        if (x < N - 1) v = Math.min(v, d[k - N + 1] + D2);
      }
      d[k] = v;
    }
    for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
      const k = y * N + x;
      let v = d[k];
      if (x < N - 1) v = Math.min(v, d[k + 1] + D1);
      if (y < N - 1) {
        v = Math.min(v, d[k + N] + D1);
        if (x < N - 1) v = Math.min(v, d[k + N + 1] + D2);
        if (x > 0) v = Math.min(v, d[k + N - 1] + D2);
      }
      d[k] = v;
    }
    for (let k = 0; k < N * N; k++) if (d[k] > N) d[k] = N;
    return d;
  }

  function chamfer(a, b) {
    if (!a.pts.length || !b.pts.length) return N;
    let s1 = 0, s2 = 0;
    for (const p of a.pts) s1 += b.dt[p];
    for (const p of b.pts) s2 += a.dt[p];
    return (s1 / a.pts.length + s2 / b.pts.length) / 2;
  }

  function classify(shape, parts, templates) {
    const scored = templates.map((t) => {
      let s = chamfer(shape, t);
      const da = Math.abs(Math.log(shape.asp / t.asp));
      s += da * (t.stretchy ? 0.4 : 2.5);
      if (parts !== null && t.parts !== parts && t.cls !== 'word') s += 2.5;
      return { t, s };
    }).sort((a, b) => a.s - b.s);
    // 같은 LaTeX 는 한 번만
    const seen = new Set(), cands = [];
    for (const c of scored) {
      if (seen.has(c.t.latex)) continue;
      seen.add(c.t.latex);
      cands.push(c);
      if (cands.length >= 6) break;
    }
    return cands;
  }

  // ───────────────────────── 전처리 ─────────────────────────

  function binarize(imgData) {
    const { width: W, height: H, data } = imgData;
    const gray = new Uint8Array(W * H);
    const hist = new Uint32Array(256);
    for (let k = 0; k < W * H; k++) {
      const a = data[k * 4 + 3] / 255;
      const l = 0.299 * data[k * 4] + 0.587 * data[k * 4 + 1] + 0.114 * data[k * 4 + 2];
      const g = Math.round(255 - a * (255 - l)); // 흰 배경에 합성
      gray[k] = g;
      hist[g]++;
    }
    // Otsu
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];
    let wB = 0, sumB = 0, best = 0, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = W * H - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    const bin = new Uint8Array(W * H);
    let dark = 0;
    for (let k = 0; k < W * H; k++) if (gray[k] <= thr) { bin[k] = 1; dark++; }
    // 잉크가 더 적은 쪽이라고 가정(어두운 배경의 흰 글씨 지원)
    if (dark > W * H / 2) for (let k = 0; k < W * H; k++) bin[k] ^= 1;
    return { W, H, bin };
  }

  function components({ W, H, bin }) {
    const label = new Int32Array(W * H).fill(-1);
    const comps = [];
    const stack = [];
    for (let s = 0; s < W * H; s++) {
      if (!bin[s] || label[s] >= 0) continue;
      const id = comps.length;
      let x0 = W, y0 = H, x1 = 0, y1 = 0, area = 0;
      label[s] = id;
      stack.push(s);
      while (stack.length) {
        const q = stack.pop(), x = q % W, y = (q - x) / W;
        area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (bin[r] && label[r] < 0) { label[r] = id; stack.push(r); }
        }
      }
      comps.push(box({ id, ids: [id], x0, y0, x1: x1 + 1, y1: y1 + 1, area }));
    }
    for (const c of comps) {
      c.bits = new Uint8Array(c.w * c.h);
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        if (label[(c.y0 + y) * W + c.x0 + x] === c.id) c.bits[y * c.w + x] = 1;
      }
    }
    return { label, comps };
  }

  function box(o) {
    o.w = o.x1 - o.x0; o.h = o.y1 - o.y0;
    o.cx = (o.x0 + o.x1) / 2; o.cy = (o.y0 + o.y1) / 2;
    return o;
  }

  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const xOverlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  // 꽉 찬 작은 원(채움 비율 ≈ 0.78). 작은 첨자 글자(x, e …)는 이보다 훨씬 비어 있다
  const looksLikeDot = (c, medH) => Math.max(c.w, c.h) < DOT * medH && c.area > 0.62 * c.w * c.h &&
    c.w < 2 * c.h && c.h < 2 * c.w;
  const isHline = (c) => c.w >= 3 * c.h && c.area >= 0.7 * c.w * c.h;

  // ───────────────────────── 조각 병합 ─────────────────────────

  function mergeParts(comps, medH) {
    const parent = new Map(comps.map((c) => [c.id, c.id]));
    const find = (k) => { const p = parent.get(k); if (p === k) return k; const r = find(p); parent.set(k, r); return r; };
    const union = (a, b) => { parent.set(find(a), find(b)); };
    const isDot = (c) => looksLikeDot(c, medH);
    const flat = (c) => c.h < 0.45 * c.w;
    const between = (a, b) => comps.some((c) => c !== a && c !== b &&
      xOverlap(c, a) > 0 && c.cy > Math.min(a.cy, b.cy) && c.cy < Math.max(a.cy, b.cy));
    // 가로줄 바로 아래에 (가로줄이 아닌) 기호가 있는지 — 있으면 분수선일 가능성이 큼
    const nothingBelow = (bar, dist) => !comps.some((c) => c !== bar && !isHline(c) &&
      xOverlap(c, bar) > 0.3 * Math.min(c.w, bar.w) && c.y0 >= bar.y1 && c.y0 - bar.y1 < dist * medH);

    for (const a of comps) for (const b of comps) {
      if (a === b || a.id > b.id) continue; // 각 쌍을 한 번만
      const [up, dn] = a.cy < b.cy ? [a, b] : [b, a];
      const gap = dn.y0 - up.y1;
      const ov = xOverlap(a, b);
      // '=', '≈', '≡': 비슷한 너비의 납작한 획 두세 개
      if (flat(a) && flat(b) && ov > 0.7 * Math.min(a.w, b.w) && Math.min(a.w, b.w) > 0.8 * Math.max(a.w, b.w) &&
          gap >= 0 && gap < 0.5 * Math.max(a.w, b.w) && !between(a, b) && nothingBelow(dn, 0.5)) {
        union(a.id, b.id);
        continue;
      }
      // '≤', '≥', '±': 기호 아래 짧은 가로줄(아래에 분모가 없을 때)
      if (isHline(dn) && !isHline(up) && !isDot(up) && ov > 0.6 * dn.w && dn.w < 1.6 * up.w && up.w < 1.6 * dn.w &&
          gap >= 0 && gap < 0.35 * up.h && nothingBelow(dn, 0.8)) {
        union(a.id, b.id);
        continue;
      }
    }
    // 점: i, j, !, :, ;, ÷ — 점마다 가장 알맞은 짝 하나에만 붙인다(옆 글자와 잘못 붙지 않게)
    for (const dot of comps.filter(isDot)) {
      let best = null;
      for (const other of comps) {
        if (other === dot) continue;
        const tol = Math.max(0.2 * other.w, dot.w);
        const vgap = dot.cy < other.cy ? other.y0 - dot.y1 : dot.y0 - other.y1;
        if (!(dot.cx >= other.x0 - tol && dot.cx <= other.x1 + tol && vgap >= -1 && vgap < 0.45 * medH &&
            (isDot(other) || other.h > dot.h * 1.5 || isHline(other)))) continue;
        const cost = Math.abs(dot.cx - other.cx) / Math.max(other.w, dot.w) + vgap / medH;
        if (!best || cost < best.cost) best = { other, cost };
      }
      if (best) union(dot.id, best.other.id);
    }
    const groups = new Map();
    for (const c of comps) {
      const r = find(c.id);
      if (!groups.has(r)) groups.set(r, { ids: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, area: 0 });
      const g = groups.get(r);
      g.ids.push(c.id);
      g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0);
      g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1);
      g.area += c.area;
    }
    return [...groups.values()].map(box);
  }

  function groupBits(g, byId) {
    const bits = new Uint8Array(g.w * g.h);
    for (const id of g.ids) {
      const c = byId.get(id);
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        if (c.bits[y * c.w + x]) bits[(c.y0 - g.y0 + y) * g.w + c.x0 - g.x0 + x] = 1;
      }
    }
    return bits;
  }

  // 붙어 버린 글자(작은 글씨의 'lim', 'b²' 등)를 가장 얇은 세로 기둥에서 잘라 본다.
  // 두 조각이 각각 훨씬 잘 맞을 때만 받아들이고, 조각도 다시 시도한다.
  function splitTouching(c, templates, medH, nextId, depth = 0) {
    const score = (p) => (p.score ??= classify(makeShape(p.bits, p.w, p.h), null, templates)[0].s);
    const own = score(c);
    if (depth > 3 || own < 0.6 || c.w < 0.5 * medH) return [c];
    const col = new Array(c.w).fill(0);
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) col[x] += c.bits[y * c.w + x];
    const cuts = [];
    for (let x = Math.ceil(0.15 * c.w); x < Math.floor(0.85 * c.w); x++) {
      if (col[x] <= col[x - 1] && col[x] <= col[x + 1]) cuts.push(x);
    }
    cuts.sort((a, b) => col[a] - col[b]);
    let best = null;
    for (const cut of cuts.slice(0, 4)) {
      const halves = [[0, cut], [cut, c.w]].map(([a, b]) => piece(c, a, b, nextId));
      if (halves.some((p) => !p)) continue;
      // 각 조각도 더 잘라 본 뒤, 가장 나쁜 조각의 점수로 판단
      const parts = halves.flatMap((p) => splitTouching(p, templates, medH, nextId, depth + 1));
      const worst = Math.max(...parts.map(score));
      if (worst < 0.8 && worst < 0.7 * own && (!best || worst < best.worst)) best = { worst, parts };
    }
    return best ? best.parts : [c];
  }

  function piece(c, a, b, nextId) {
    let y0 = c.h, y1 = -1, area = 0;
    for (let y = 0; y < c.h; y++) for (let x = a; x < b; x++) if (c.bits[y * c.w + x]) { area++; if (y < y0) y0 = y; y1 = y; }
    if (y1 < 0 || area < 3) return null;
    const w = b - a, h = y1 + 1 - y0;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = c.bits[(y0 + y) * c.w + a + x];
    const id = nextId();
    return box({ id, ids: [id], x0: c.x0 + a, y0: c.y0 + y0, x1: c.x0 + b, y1: c.y0 + y1 + 1, area, bits });
  }

  // 루트 기호: 위쪽 가로선 + 왼쪽 아래 체크 모양 + 안에 다른 기호가 있음
  function radicalInfo(g, bits, others) {
    if (g.ids.length !== 1 || g.w < 4 || g.h < 8) return null;
    const band = Math.max(2, Math.round(0.14 * g.h));
    const topHit = (x) => { for (let y = 0; y < band; y++) if (bits[y * g.w + x]) return true; return false; };
    // 오른쪽 끝에서 왼쪽으로 이어지는 위쪽 가로선(vinculum)
    let start = g.w;
    while (start > 0 && topHit(start - 1)) start--;
    const len = g.w - start;
    if (len < 0.3 * g.w || len < 0.25 * g.h || start < 0.15 * g.w) return null;
    // 가로선 아래(내용이 들어가는 자리)는 루트 기호 자신의 잉크가 거의 없어야 함
    let inner = 0;
    const ix0 = start + Math.ceil(0.1 * len), iy0 = Math.floor(0.3 * g.h);
    for (let y = iy0; y < g.h; y++) for (let x = ix0; x < g.w; x++) inner += bits[y * g.w + x];
    if (inner > 0.06 * (g.h - iy0) * (g.w - ix0)) return null;
    // 왼쪽 아래에 체크 모양 획이 있어야 함
    let tick = 0;
    for (let y = Math.floor(0.5 * g.h); y < g.h; y++) for (let x = 0; x < start; x++) tick += bits[y * g.w + x];
    if (!tick) return null;
    const vx = g.x0 + start;
    const contains = others.some((o) => o !== g && o.cx > vx && o.cx < g.x1 && o.cy > g.y0 && o.cy < g.y1);
    return contains ? { vx } : null;
  }

  // ───────────────────────── 배치 분석 ─────────────────────────

  const isSingle = (s) => /^(\\[A-Za-z]+|[^\s])$/.test(s);
  const grp = (s) => (isSingle(s) ? s : `{${s}}`);
  function join(a, b) {
    if (!a) return b;
    if (!b) return a;
    const needs = /(\\[A-Za-z]+|[\^_][A-Za-z0-9])$/.test(a) && /^[A-Za-z0-9]/.test(b);
    return needs ? a + ' ' + b : a + b;
  }


  function layout(items, medEm) {
    const em = medEm;

    function parseRegion(list) {
      if (!list.length) return { latex: '', base: null, em };
      let rest = list.slice();

      // 1) 루트 (큰 것부터)
      for (const r of rest.filter((s) => s.kind === 'radical').sort((a, b) => b.w * b.h - a.w * a.h)) {
        if (!rest.includes(r)) continue;
        const inside = rest.filter((s) => s !== r && s.cx > r.vx && s.cx < r.x1 && s.cy > r.y0 && s.cy < r.y1);
        const index = rest.filter((s) => s !== r && !inside.includes(s) && s.cx < r.vx &&
          s.x1 > r.x0 - em && s.y1 <= r.y0 + 0.65 * r.h && s.h < 0.6 * r.h);
        const body = parseRegion(inside);
        const idx = index.length ? parseRegion(index).latex : '';
        rest = rest.filter((s) => s !== r && !inside.includes(s) && !index.includes(s));
        rest.push(box({
          kind: 'comp', latex: `\\sqrt${idx ? `[${idx}]` : ''}{${body.latex}}`,
          x0: Math.min(r.x0, ...index.map((s) => s.x0)), y0: r.y0, x1: r.x1, y1: r.y1,
          base: body.base ?? r.y1 - 0.2 * em, em: body.em ?? em,
        }));
      }

      // 2) 분수 (가장 넓은 가로줄부터). 분자·분모는 가로줄 범위 안에서 위아래로 이어진 기호들
      const stack = (bar, dir, pool) => {
        const tol = 0.15 * em;
        const cand = pool.filter((s) => s !== bar && s.x0 >= bar.x0 - tol && s.x1 <= bar.x1 + tol &&
          (dir < 0 ? s.y1 <= bar.cy : s.y0 >= bar.cy));
        const got = [];
        let edge = dir < 0 ? bar.y0 : bar.y1;
        for (;;) {
          const near = cand.filter((s) => !got.includes(s) &&
            (dir < 0 ? edge - s.y1 < 0.9 * em : s.y0 - edge < 0.9 * em));
          if (!near.length) break;
          got.push(...near);
          edge = dir < 0 ? Math.min(...got.map((s) => s.y0)) : Math.max(...got.map((s) => s.y1));
        }
        return got;
      };
      for (const bar of rest.filter((s) => s.kind === 'hline').sort((a, b) => b.w - a.w)) {
        if (!rest.includes(bar)) continue;
        const num = stack(bar, -1, rest), den = stack(bar, 1, rest);
        if (num.length && den.length) {
          const n = parseRegion(num), d = parseRegion(den);
          rest = rest.filter((s) => s !== bar && !num.includes(s) && !den.includes(s));
          const all = [bar, ...num, ...den];
          rest.push(box({
            kind: 'comp', latex: `\\frac{${n.latex}}{${d.latex}}`,
            x0: Math.min(...all.map((s) => s.x0)), y0: Math.min(...all.map((s) => s.y0)),
            x1: Math.max(...all.map((s) => s.x1)), y1: Math.max(...all.map((s) => s.y1)),
            base: bar.cy + 0.25 * em, em,
          }));
        } else if (den.length && !num.length && den.every((s) => s.y0 - bar.y1 < 0.35 * em) && bar.w > 0.5 * em) {
          const d = parseRegion(den);
          rest = rest.filter((s) => s !== bar && !den.includes(s));
          const all = [bar, ...den];
          rest.push(box({
            kind: 'comp', latex: `\\overline{${d.latex}}`,
            x0: Math.min(...all.map((s) => s.x0)), y0: bar.y0,
            x1: Math.max(...all.map((s) => s.x1)), y1: Math.max(...all.map((s) => s.y1)),
            base: d.base, em: d.em,
          }));
        }
      }

      // 3) 함수 이름(sin, log, lim …): 각 글자 후보 상위권에 해당 글자가 있으면 인정
      rest.sort((a, b) => a.x0 - b.x0);
      const chars = rest.filter((s) => s.kind === 'char');
      const baseAs = (s, ch) => {
        const t = s.cands.find((c) => c.t.latex === ch).t;
        return s.y1 - t.bot * (s.h / (t.top + t.bot));
      };
      // 통째로 인식된 단어: 안에 들어간 i 의 점은 흡수
      for (const s of chars.filter((c) => c.cls === 'word')) {
        Object.assign(s, { kind: s.latex === '\\lim' ? 'limop' : 'func', em });
        rest = rest.filter((d) => !(d.kind === 'dot' && d.cx > s.x0 && d.cx < s.x1 && d.cy > s.y0 - 0.2 * em && d.cy < s.y1));
        chars.splice(chars.indexOf(s), 1);
      }
      const hasLetter = (s, ch) => s.cands.slice(0, 4).some((c) => c.t.latex === ch && c.s <= s.cands[0].s * 1.35 + 0.3);
      for (let i = 0; i < chars.length; i++) {
        // 같은 줄(세로로 겹치는)에 있는 글자만 이어 본다 — lim 아래의 x→0 이 끼어들지 않게
        const line = chars.slice(i).filter((s) => s === chars[i] ||
          Math.min(s.y1, chars[i].y1) - Math.max(s.y0, chars[i].y0) > 0.5 * Math.min(s.h, chars[i].h));
        for (const w of WORDS) {
          const seq = line.slice(0, w.length);
          if (seq.length < w.length) continue;
          let ok = seq.every((s, k) => hasLetter(s, w[k]));
          // 해당 글자로 읽었을 때의 기준선이 서로 맞아야 함
          const bases = ok ? seq.map((s, k) => baseAs(s, w[k])) : [];
          for (let k = 1; ok && k < seq.length; k++) {
            if (seq[k].x0 - seq[k - 1].x1 > 0.35 * em || Math.abs(bases[k] - bases[0]) > 0.2 * em) ok = false;
          }
          if (!ok) continue;
          const word = box({
            kind: w === 'lim' ? 'limop' : 'func', latex: '\\' + w,
            x0: seq[0].x0, y0: Math.min(...seq.map((s) => s.y0)), x1: seq[seq.length - 1].x1, y1: Math.max(...seq.map((s) => s.y1)),
            base: baseAs(seq[0], w[0]), em,
          });
          rest = rest.filter((s) => !seq.includes(s));
          rest.push(word);
          for (const x of seq) chars.splice(chars.indexOf(x), 1);
          chars.splice(i, 0, word);
          break;
        }
      }

      // 4) 위아래 첨자를 가진 큰 연산자(∑, ∏, lim)
      for (const op of rest.filter((s) => s.kind === 'limop' || (s.kind === 'char' && s.cls === 'bigop' && s.latex !== '\\int' && s.latex !== '\\oint'))) {
        if (!rest.includes(op)) continue;
        const range = { x0: op.x0 - 1.2 * em, x1: op.x1 + 1.2 * em };
        const grab = (dir) => {
          const cand = rest.filter((s) => s !== op && s.cx > range.x0 && s.cx < range.x1 &&
            (dir < 0 ? s.y1 <= op.y0 + 0.1 * op.h : s.y0 >= op.y1 - 0.1 * op.h));
          const got = [];
          let edge = dir < 0 ? op.y0 : op.y1;
          for (;;) {
            const near = cand.filter((s) => !got.includes(s) && (dir < 0 ? edge - s.y1 < 0.6 * em : s.y0 - edge < 0.6 * em));
            if (!near.length) break;
            got.push(...near);
            edge = dir < 0 ? Math.min(...got.map((s) => s.y0)) : Math.max(...got.map((s) => s.y1));
          }
          return got;
        };
        const above = op.kind === 'limop' ? [] : grab(-1), below = grab(1);
        if (!above.length && !below.length) continue;
        const lo = below.length ? parseRegion(below).latex : null, hi = above.length ? parseRegion(above).latex : null;
        rest = rest.filter((s) => s !== op && !above.includes(s) && !below.includes(s));
        const all = [op, ...above, ...below];
        rest.push(box({
          kind: 'comp', latex: op.latex + (lo !== null ? '_' + grp(lo) : '') + (hi !== null ? '^' + grp(hi) : ''),
          x0: op.x0, y0: Math.min(...all.map((s) => s.y0)), x1: op.x1, y1: Math.max(...all.map((s) => s.y1)),
          base: op.kind === 'limop' ? op.base : op.cy + 0.25 * em, em,
        }));
      }

      // 5) 기준선을 따라 왼쪽부터: 각 기호가 현재 밑(base)의 위첨자/아래첨자/같은 줄인지 판정
      rest.sort((a, b) => a.x0 - b.x0);
      const tokens = [];
      let cur = null;
      for (const s of rest) {
        const r = cur ? relation(cur.sym, s) : 'main';
        if (r === 'main') { cur = { sym: s, sub: [], sup: [] }; tokens.push(cur); }
        else cur[r].push(s);
      }

      let latex = '';
      const mainBases = [];
      for (let k = 0; k < tokens.length; k++) {
        const t = tokens[k];
        let base = symLatex(t.sym, tokens, k);
        if (t.sym.kind === 'char' && t.sym.reliable) mainBases.push(t.sym.base);
        if (t.sub.length) base += '_' + grp(parseRegion(t.sub).latex);
        if (t.sup.length) {
          const sup = parseRegion(t.sup).latex;
          base += /^'+$/.test(sup) ? sup : '^' + grp(sup);
        }
        latex = join(latex, base);
      }
      const firstBase = tokens.length ? tokens[0].sym.base : null;
      return { latex, base: mainBases.length ? median(mainBases) : firstBase, em };
    }

    function relation(b, s) {
      if (s.kind === 'hline' || s.kind === 'dot' || s.axis) {
        // 가운데(수학 축)에 놓이는 기호: 축 높이로 비교
        const bAxis = b.base - 0.25 * b.em;
        const d = s.cy - bAxis;
        if (d < -0.22 * b.em && s.x0 >= b.x0) return 'sup';
        if (d > 0.17 * b.em && s.kind !== 'dot') return 'sub';
        return 'main';
      }
      if (s.tall) return 'main';
      if (b.geometric) {
        if (s.y1 <= b.y0 + 0.55 * b.h && s.h < 0.75 * b.h) return 'sup';
        if (s.y0 >= b.y0 + 0.45 * b.h && s.h < 0.75 * b.h && s.cy > b.cy + 0.15 * b.h) return 'sub';
        return 'main';
      }
      const db = s.base - b.base;
      const smaller = s.em < 0.88 * b.em;
      if (db < -0.25 * b.em && (smaller || db < -0.45 * b.em)) return 'sup';
      if (db > 0.08 * b.em && (smaller || db > 0.3 * b.em) && s.y1 > b.base + 0.08 * b.em) return 'sub';
      return 'main';
    }

    function symLatex(s, tokens, k) {
      if (s.kind === 'hline') return '-';
      if (s.kind === 'dot') {
        const prev = tokens[k - 1]?.sym;
        if (prev && prev.base != null && s.y1 < prev.base - 0.12 * prev.em) return '\\cdot';
        return '.';
      }
      if (s.kind !== 'char') return s.latex;
      // 숫자 옆의 l, I, | → 1 / O, o → 0
      const near = (j) => tokens[j] && tokens[j].sym.kind === 'char' && /^[0-9]$/.test(tokens[j].sym.latex);
      if ((near(k - 1) || near(k + 1)) && !tokens[k].sub.length) {
        if (/^[lI|]$/.test(s.latex)) return '1';
        if (/^[Oo]$/.test(s.latex)) return '0';
      }
      return s.latex;
    }

    return parseRegion(items);
  }

  // ───────────────────────── 진입점 ─────────────────────────

  function rasterize(source, scale) {
    const w = Math.max(1, Math.round((source.naturalWidth || source.width) * scale));
    const h = Math.max(1, Math.round((source.naturalHeight || source.height) * scale));
    const cv = document.createElement('canvas');
    cv.width = w + 16; cv.height = h + 16; // 가장자리 여백
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 8, 8, w, h);
    // 여백은 그림 테두리의 평균색으로 채움(어두운 배경 스크린샷에서 흰 테두리가 잉크로 잡히지 않게)
    const d = ctx.getImageData(8, 8, w, h).data;
    const sum = [0, 0, 0, 0];
    let n = 0;
    const add = (x, y) => { const k = (y * w + x) * 4; const a = d[k + 3] / 255; for (let c = 0; c < 3; c++) sum[c] += d[k + c] * a + 255 * (1 - a); n++; };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    const bg = `rgb(${sum.slice(0, 3).map((v) => Math.round(v / n)).join(',')})`;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillRect(0, 0, cv.width, 8); ctx.fillRect(0, cv.height - 8, cv.width, 8);
    ctx.fillRect(0, 0, 8, cv.height); ctx.fillRect(cv.width - 8, 0, 8, cv.height);
    return ctx.getImageData(0, 0, cv.width, cv.height);
  }

  function analyse(source, scale) {
    const img = binarize(rasterize(source, scale));
    const { label, comps } = components(img);
    const sizable = comps.filter((c) => c.area > 4 && !isHline(c));
    const medH = median(sizable.map((c) => c.h)) || 1;
    return { img, label, comps, medH };
  }

  async function recognize(source) {
    const templates = await getTemplates();
    const W0 = source.naturalWidth || source.width, H0 = source.naturalHeight || source.height;
    // 기호 높이가 대략 48px 이 되도록 크기 조정
    let scale = Math.min(1, 1600 / Math.max(W0, H0));
    let a = analyse(source, scale);
    const want = Math.min(48 / a.medH, 4000 / Math.max(W0, H0) / scale);
    if (a.medH < 28 || a.medH > 90) { scale *= want; a = analyse(source, scale); }

    const { medH } = a;
    let comps = a.comps.filter((c) => c.area >= 3 && Math.max(c.w, c.h) >= 0.05 * medH);
    let lastId = Math.max(0, ...a.comps.map((c) => c.id));
    const nextId = () => ++lastId;
    comps = comps.flatMap((c) => {
      if (isHline(c) || looksLikeDot(c, medH)) return [c];
      // 다른 기호를 품은 것(루트 기호)은 자르지 않음
      if (comps.some((o) => o !== c && !looksLikeDot(o, medH) && o.cx > c.x0 && o.cx < c.x1 && o.cy > c.y0 && o.cy < c.y1)) return [c];
      return splitTouching(c, templates, medH, nextId);
    });
    const byId = new Map(comps.map((c) => [c.id, c]));
    const groups = mergeParts(comps, medH);
    const warnings = [];
    if (!groups.length) return { latex: '', symbols: [], warnings: ['이미지에서 글자를 찾지 못했습니다.'] };

    // 기호 분류
    for (const g of groups) {
      const bits = groupBits(g, byId);
      if (g.ids.length === 1 && isHline(g)) { g.kind = 'hline'; continue; }
      if (g.ids.length === 1 && looksLikeDot(g, medH)) { g.kind = 'dot'; continue; }
      const rad = radicalInfo(g, bits, groups);
      if (rad) { g.kind = 'radical'; g.vx = rad.vx; continue; }
      const shape = makeShape(bits, g.w, g.h);
      g.cands = classify(shape, g.ids.length, templates);
      const best = g.cands[0].t;
      g.kind = 'char';
      g.latex = best.latex;
      g.cls = best.cls;
      g.tmpl = best;
    }

    // 글자 크기(em)와 기준선 추정
    const ems = groups.filter((g) => g.kind === 'char' && g.tmpl.top + g.tmpl.bot >= 0.4 &&
      !['bigop', 'delim'].includes(g.cls) && !g.tmpl.stretchy).map((g) => g.h / (g.tmpl.top + g.tmpl.bot));
    const medEm = median(ems) || medH * 1.3;
    for (const g of groups) {
      if (g.kind === 'char') {
        const t = g.tmpl, span = t.top + t.bot;
        const tall = (t.stretchy || g.cls === 'bigop' || g.cls === 'delim') && g.h > 1.25 * medEm;
        if (tall || g.cls === 'bigop') {
          g.em = medEm; g.base = g.cy + 0.25 * medEm; g.tall = tall; g.geometric = true;
        } else if (span >= 0.4 && !t.stretchy) {
          g.em = g.h / span; g.base = g.y1 - t.bot * g.em; g.reliable = true;
        } else {
          g.em = medEm; g.base = g.y1 - t.bot * medEm;
        }
        // + = < 같은 기호는 수학 축(가운데)에 놓이므로 기준선 대신 중심 높이로 판단
        g.axis = /^(\+|=|<|>|\\le|\\ge|\\neq|\\pm|\\times|\\div|\\to|\\approx|\\cdot)$/.test(g.latex);
      } else if (g.kind === 'hline') {
        g.em = medEm; g.base = g.cy + 0.25 * medEm;
      } else if (g.kind === 'dot') {
        g.em = medEm; g.base = g.y1;
      } else {
        g.em = medEm; g.base = g.y1;
      }
    }

    const result = layout(groups, medEm);
    const latex = result.latex.replace(/\s+/g, ' ').trim();
    return {
      latex,
      warnings,
      _groups: groups,
      symbols: groups.map((g) => ({
        x: (g.x0 - 8) / scale, y: (g.y0 - 8) / scale, w: g.w / scale, h: g.h / scale,
        label: g.kind === 'char' ? g.latex : g.kind === 'hline' ? '—' : g.kind === 'dot' ? '·' : g.kind === 'radical' ? '√' : '?',
        alternatives: g.cands ? g.cands.slice(1, 4).map((c) => c.t.latex) : [],
      })),
    };
  }

  return { recognize, getTemplates };
});
