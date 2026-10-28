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
    'ℏ': '\\hbar', '⟨': '\\langle', '⟩': '\\rangle', '≡': '\\equiv', '∓': '\\mp', '⇒': '\\Rightarrow',
    '⟹': '\\implies', '≪': '\\ll', '≫': '\\gg', '∗': '*', 'ˆ': '\\hat', '˜': '\\tilde',
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
    ['ℏ⟨⟩≡∓⇒⟹≪≫∗', 'KaTeX_Main', 'normal', 'sym'],
    ['ˆ˜', 'KaTeX_Main', 'normal', 'accent'],
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
  const STRETCHY = new Set(['(', ')', '[', ']', '\\{', '\\}', '|', '\\int', '\\oint', '/', '\\langle', '\\rangle']);

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

  function toGray(imgData) {
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
    // 어두운 배경(다크 모드 스크린샷)이면 반전해서 "밝은 종이 위 어두운 잉크"로 맞춘다
    let bg = 0;
    for (let i = 1; i < 256; i++) if (hist[i] > hist[bg]) bg = i;
    if (bg < 128) {
      for (let k = 0; k < W * H; k++) gray[k] = 255 - gray[k];
      hist.reverse();
      bg = 255 - bg;
    }
    let n = 0, sum = 0, sq = 0;
    for (let i = Math.max(0, bg - 30); i <= Math.min(255, bg + 30); i++) { n += hist[i]; sum += i * hist[i]; sq += i * i * hist[i]; }
    const sd = n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
    let acc = 0, ink = 0;
    for (; ink < 256; ink++) { acc += hist[ink]; if (acc >= 0.005 * W * H) break; }
    return { W, H, gray, hist, bg, sd, ink };
  }

  // level: 'otsu' 또는 종이색에서 얼마나 가까운 곳에서 자를지(작을수록 연한 획까지 잉크로 봄).
  // Otsu 는 잉크와 종이의 중간에서 자르기 때문에 Computer Modern 같은 글꼴의 가는 획이 끊기고,
  // 반대로 너무 너그러우면 스캔본의 번진 테두리끼리 붙는다. 그래서 여러 단계를 시도한다.
  function threshold(g, level) {
    const o = otsu(g.hist, g.W * g.H);
    const thr = level === 'otsu' ? o : Math.max(o, Math.min(g.bg - level * (g.bg - g.ink), g.bg - 3 * g.sd - 6));
    const bin = new Uint8Array(g.W * g.H);
    for (let k = 0; k < g.W * g.H; k++) if (g.gray[k] <= thr) bin[k] = 1;
    return { W: g.W, H: g.H, bin };
  }

  function otsu(hist, total) {
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * hist[i];
    let wB = 0, sumB = 0, best = 0, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return thr;
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
    if (depth > 3 || own < 0.9 || c.w < 0.5 * medH) return [c];
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
      if (worst < 0.6 && worst < 0.55 * own && (!best || worst < best.worst)) best = { worst, parts };
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

      // 1.5) 악센트(\\hat, \\tilde, \\vec): 글자 바로 위에 붙은 작은 기호
      for (const s of rest.filter((x) => x.kind === 'char' && (x.cls === 'accent' || (x.latex === '\\to' && x.h < 0.4 * em)))) {
        if (!rest.includes(s)) continue;
        const below = rest.filter((t) => t !== s && t.kind !== 'hline' && t.kind !== 'dot' &&
          xOverlap(s, t) >= 0.5 * s.w && t.y0 >= s.y1 - 0.15 * em && t.y0 - s.y1 < 0.4 * em && s.w < 1.6 * t.w + 0.3 * em)
          .sort((a, b) => (a.y0 - s.y1) - (b.y0 - s.y1));
        const t = below[0];
        if (!t) continue;
        const cmd = s.latex === '\\to' ? '\\vec' : s.latex;
        rest = rest.filter((x) => x !== s && x !== t);
        rest.push(box(Object.assign({}, t, {
          kind: 'comp', latex: `${cmd}{${t.latex}}`, x0: Math.min(s.x0, t.x0), y0: s.y0, x1: Math.max(s.x1, t.x1), y1: t.y1,
        })));
      }

      // 붙을 글자가 없는 악센트 모양은 악센트가 아님 → 다음 후보로
      for (const s of rest) {
        if (s.kind !== 'char' || s.cls !== 'accent') continue;
        const alt = s.cands.find((c) => c.t.cls !== 'accent');
        if (alt) Object.assign(s, { latex: alt.t.latex, cls: alt.t.cls, tmpl: alt.t });
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
      const emAs = (s, ch) => {
        const t = s.cands.find((c) => c.t.latex === ch).t;
        return s.h / (t.top + t.bot);
      };
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
            // 같은 크기의 글자여야 함(ma_x 의 아래첨자 x 를 max 로 읽지 않게)
            if (Math.abs(Math.log(emAs(seq[k], w[k]) / emAs(seq[0], w[0]))) > 0.25) ok = false;
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

  // ───────────────────────── 학습(사용자 템플릿) ─────────────────────────
  //
  // 사용자가 고친 LaTeX 를 KaTeX 로 그리되 기호마다 다른 색을 칠한다. 그러면 기준 그림의 각 글자가
  // 어떤 LaTeX 토큰에서 왔는지 색으로 정확히 알 수 있다(인식할 필요가 없음). 그다음 스크린샷의 글자와
  // 기준 그림의 글자를 상대 위치로 짝지어, 스크린샷 글자 모양을 그 토큰의 새 템플릿으로 저장한다.

  const STORE_KEY = 'formulaocr-learned-v1';
  let learnedList = null;
  let builtinList = []; // 사이트에 함께 올라간 학습 묶음(data/*.json). 저장·삭제 대상이 아님
  let persist = true;
  let profile = null; // 교재 프로필. null 이면 모든 학습 템플릿 사용
  const PROFILE_KEY = 'formulaocr-profile';
  try { profile = localStorage.getItem(PROFILE_KEY) || null; } catch { /* 무시 */ }

  function loadLearned() {
    if (learnedList) return learnedList;
    learnedList = [];
    if (!persist) return learnedList;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) learnedList = JSON.parse(raw).map(fromJSON);
    } catch { /* 저장소를 못 쓰면 메모리에만 */ }
    return learnedList;
  }

  function saveLearned() {
    if (!persist) return;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(learnedList.map(toJSON))); } catch { /* 무시 */ }
  }

  function toJSON(t) {
    let bin = '';
    for (let k = 0; k < N * N; k += 8) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte |= t.ink[k + b] << b;
      bin += String.fromCharCode(byte);
    }
    return { l: t.latex, c: t.cls, p: t.parts, a: +t.asp.toFixed(4), t: +t.top.toFixed(3), b: +t.bot.toFixed(3), i: btoa(bin), s: t.source || '' };
  }

  function fromJSON(o) {
    const bin = atob(o.i), ink = new Uint8Array(N * N), pts = [];
    for (let k = 0; k < N * N; k++) if ((bin.charCodeAt(k >> 3) >> (k & 7)) & 1) { ink[k] = 1; pts.push(k); }
    return {
      ink, pts, dt: distanceTransform(ink), asp: o.a, latex: o.l, cls: o.c, parts: o.p, top: o.t, bot: o.b,
      stretchy: STRETCHY.has(o.l), font: 'learned', learned: true, source: o.s,
    };
  }

  // 기본 템플릿 + (현재 교재 프로필의) 학습 템플릿.
  // 다른 교재에서 배운 모양이 섞이면 오히려 헷갈리는 경우가 있어(실측 약 3%p 손해) 프로필별로 나눈다.
  async function allTemplates() {
    const mine = loadLearned().concat(builtinList).filter((t) => !profile || t.source === profile);
    return (await getTemplates()).concat(mine);
  }

  const learnedApi = {
    count: () => loadLearned().length,
    // 라벨별 개수
    summary: () => loadLearned().reduce((m, t) => ((m[t.latex] = (m[t.latex] || 0) + 1), m), {}),
    export: () => JSON.stringify({ version: 1, templates: loadLearned().map(toJSON) }),
    import(json) {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      const list = (data.templates || data).map(fromJSON);
      loadLearned().push(...list);
      saveLearned();
      return list.length;
    },
    // 프로필을 지정하면 그 교재 것만, 아니면 전부 지움
    clear(name) {
      learnedList = name ? loadLearned().filter((t) => t.source !== name) : [];
      saveLearned();
    },
    // 교재별 개수. includeBuiltin 이 false 면 사용자가 직접 가르친 것만
    profiles(includeBuiltin = true) {
      const m = {};
      for (const t of includeBuiltin ? loadLearned().concat(builtinList) : loadLearned()) m[t.source || '기본'] = (m[t.source || '기본'] || 0) + 1;
      return m;
    },
    builtinCount: () => builtinList.length,
    // 내장 학습 묶음을 불러온다(내보내기 형식과 같음)
    async loadPack(url) {
      const data = await (await fetch(url)).json();
      builtinList = builtinList.concat((data.templates || data).map((o) => Object.assign(fromJSON(o), { builtin: true })));
      return builtinList.length;
    },
    getProfile: () => profile,
    setProfile(name) {
      profile = name || null;
      try { if (profile) localStorage.setItem(PROFILE_KEY, profile); else localStorage.removeItem(PROFILE_KEY); } catch { /* 무시 */ }
    },
    // 테스트용: localStorage 를 쓰지 않고 메모리에서만 학습
    usePersistence(on) { persist = on; learnedList = null; },
  };

  // 기호 하나하나를 서로 다른 색으로 감싼 LaTeX 와 색 → 토큰 표를 만든다
  const ARITY = {
    '\\frac': 2, '\\dfrac': 2, '\\tfrac': 2, '\\sqrt': 1, '\\overline': 1, '\\underline': 1, '\\boldsymbol': 1,
    '\\mathrm': 1, '\\mathbf': 1, '\\mathit': 1, '\\mathcal': 1, '\\mathbb': 1, '\\vec': 1, '\\bar': 1, '\\dot': 1,
  };
  const ACCENTS = { '\\hat': '\\hat', '\\widehat': '\\hat', '\\tilde': '\\tilde', '\\widetilde': '\\tilde' };
  const SKIP = new Set(['\\,', '\\;', '\\!', '\\quad', '\\qquad', '\\ ', '\\displaystyle', '\\limits', '\\nolimits']);

  function colorize(latex) {
    const toks = latex.match(/\\[A-Za-z]+|\\.|\S/g) || [];
    const entries = [];
    let p = 0;
    const color = () => {
      const k = entries.length;
      // 어둡고 서로 잘 구분되는 색(밝기가 낮아야 이진화에서 잉크로 잡힌다)
      const hue = (k * 137.508) % 360, light = 28 + (k % 3) * 6;
      return { css: hslHex(hue, 85, light), k };
    };
    const wrap = (inner, labels) => {
      const c = color();
      entries.push({ color: c.css, labels });
      return `\\textcolor{${c.css}}{${inner}}`;
    };
    function arg() {
      if (toks[p] === '{') { p++; const s = seq('}'); p++; return s; }
      return seq(null, 1);
    }
    function seq(end, max = Infinity) {
      let out = '', n = 0;
      while (p < toks.length && toks[p] !== end && n < max) {
        const t = toks[p++];
        n++;
        if (t === '{') { out += '{' + seq('}') + '}'; p++; continue; }
        if (t === '^' || t === '_') { out += t + '{' + arg() + '}'; continue; }
        if (SKIP.has(t)) { out += t + ' '; continue; }
        if (t === '\\left') {
          const open = toks[p++];
          const inner = seq('\\right');
          p++;
          const close = toks[p++];
          out += wrap(`\\left${open} ${inner} \\right${close}`, [open, close]);
          continue;
        }
        if (ACCENTS[t]) { out += wrap(`${t}{${arg()}}`, [ACCENTS[t]]); continue; }
        if (t === '\\sqrt' && toks[p] === '[') { p++; out += '\\sqrt[' + seq(']') + ']'; p++; out += '{' + arg() + '}'; continue; }
        if (ARITY[t]) { out += t; for (let a = 0; a < ARITY[t]; a++) out += '{' + arg() + '}'; continue; }
        if (/^\\(text|operatorname|mathrm\*)$/.test(t)) { out += t + '{' + arg() + '}'; continue; }
        if (/^\\(sin|cos|tan|log|ln|exp|lim|max|min|sec|csc|cot|det)$/.test(t)) { out += t + ' '; continue; }
        if (t === '&' || t === '\\\\') { out += t; continue; }
        out += wrap(t.startsWith('\\') ? t + ' ' : t, [t === '*' ? '*' : t]);
      }
      return out;
    }
    const tex = seq(null);
    return { tex, entries };
  }

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const f = (n) => {
      const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  // 기준 그림의 기호마다 색을 읽어 토큰 라벨을 붙인다
  function labelByColor(ref, canvas, entries) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pal = entries.map((e) => [1, 3, 5].map((i) => parseInt(e.color.slice(i, i + 2), 16)));
    const byEntry = new Map();
    for (const g of ref.groups) {
      const votes = new Map();
      const step = Math.max(1, Math.floor(Math.min(g.w, g.h) / 12));
      for (let y = g.y0; y < g.y1; y += step) for (let x = g.x0; x < g.x1; x += step) {
        const ox = Math.round((x - 8) / ref.scale), oy = Math.round((y - 8) / ref.scale);
        if (ox < 0 || oy < 0 || ox >= canvas.width || oy >= canvas.height) continue;
        const k = (oy * canvas.width + ox) * 4;
        const r = data[k], gg = data[k + 1], b = data[k + 2];
        if (r + gg + b > 480) continue; // 배경·가장자리
        let best = -1, bd = Infinity;
        pal.forEach(([pr, pg, pb], i) => {
          const d = (pr - r) ** 2 + (pg - gg) ** 2 + (pb - b) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        if (best >= 0 && bd < 2500) votes.set(best, (votes.get(best) || 0) + 1);
      }
      let win = -1, wv = 0;
      for (const [i, v] of votes) if (v > wv) { wv = v; win = i; }
      if (win < 0) continue;
      if (!byEntry.has(win)) byEntry.set(win, []);
      byEntry.get(win).push(g);
    }
    // 한 색에 글자가 하나면 그 토큰, \left( … \right) 처럼 둘이면 왼쪽·오른쪽 순서로
    for (const [i, gs] of byEntry) {
      const labels = entries[i].labels;
      if (gs.length !== labels.length) continue;
      gs.sort((a, b) => a.cx - b.cx).forEach((g, j) => { g.truth = labels[j]; });
    }
  }

  // 위치 순서를 지키면서(동적 계획법) 두 그림의 기호를 짝짓는다
  function align(A, B) {
    const norm = (gs) => {
      const x0 = Math.min(...gs.map((g) => g.x0)), x1 = Math.max(...gs.map((g) => g.x1));
      const y0 = Math.min(...gs.map((g) => g.y0)), y1 = Math.max(...gs.map((g) => g.y1));
      const W = x1 - x0 || 1, H = y1 - y0 || 1;
      return gs.map((g) => ({ g, x: (g.cx - x0) / W, y: (g.cy - y0) / H, h: g.h / H, w: g.w / W })).sort((a, b) => a.x - b.x);
    };
    const a = norm(A), b = norm(B);
    const kindOk = (p, q) => p.g.kind === q.g.kind || (p.g.kind === 'char' && q.g.kind === 'char');
    const cost = (p, q) => (kindOk(p, q) ? Math.abs(p.x - q.x) + 1.5 * Math.abs(p.y - q.y) + 0.3 * Math.abs(Math.log((p.h + 0.01) / (q.h + 0.01))) : 9);
    const GAP = 0.25;
    const n = a.length, m = b.length;
    const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    for (let i = 1; i <= n; i++) D[i][0] = i * GAP;
    for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
    for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
      D[i][j] = Math.min(D[i - 1][j - 1] + cost(a[i - 1], b[j - 1]), D[i - 1][j] + GAP, D[i][j - 1] + GAP);
    }
    const pairs = [];
    for (let i = n, j = m; i > 0 && j > 0;) {
      const c = cost(a[i - 1], b[j - 1]);
      if (Math.abs(D[i][j] - (D[i - 1][j - 1] + c)) < 1e-9) {
        if (c < 0.3) pairs.push([a[i - 1].g, b[j - 1].g]);
        i--; j--;
      } else if (Math.abs(D[i][j] - (D[i - 1][j] + GAP)) < 1e-9) i--;
      else j--;
    }
    return pairs.reverse();
  }

  async function learn(source, latex, { render = typeof LatexImage !== 'undefined' ? LatexImage.render : null, sourceName = profile || '기본' } = {}) {
    if (!render) throw new Error('LatexImage 가 필요합니다.');
    const { tex, entries } = colorize(latex);
    const canvas = await render(tex, { fontSize: 40 });
    const [mine, ref] = await Promise.all([analyzeImage(source), analyzeImage(canvas)]);
    labelByColor(ref, canvas, entries);
    const base = await getTemplates();
    const list = loadLearned();
    const pairs = align(mine.groups, ref.groups);
    const learnedNow = [];
    for (const [g, r] of pairs) {
      if (g.kind !== 'char' || !r.truth || !g.shape) continue;
      const label = r.truth;
      // 크기 비율이 너무 다르면(붙어 버린 글자 등) 짝이 잘못된 것으로 보고 건너뜀
      if (Math.abs(Math.log(g.shape.asp / (r.shape ? r.shape.asp : g.shape.asp))) > 0.7) continue;
      const best = g.cands[0];
      if (best.t.latex === label && best.s < 0.35) continue; // 이미 잘 읽는 글자
      if (list.some((t) => t.source === sourceName && t.latex === label && chamfer(t, g.shape) < 0.3)) continue; // 비슷한 것이 이미 있음
      const proto = base.find((t) => t.latex === label) || r.tmpl || best.t;
      const t = Object.assign({}, g.shape, {
        latex: label, cls: proto.cls, parts: g.ids.length, top: proto.top, bot: proto.bot,
        stretchy: STRETCHY.has(label), font: 'learned', learned: true, source: sourceName,
      });
      list.push(t);
      learnedNow.push({ from: best.t.latex, to: label });
    }
    saveLearned();
    const chars = mine.groups.filter((g) => g.kind === 'char').length;
    return { added: learnedNow.length, changes: learnedNow, matched: pairs.length, chars, total: list.length };
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

  function analyse(gray, level) {
    const img = threshold(gray, level);
    const { label, comps } = components(img);
    const sizable = comps.filter((c) => c.area > 4 && !isHline(c));
    const medH = median(sizable.map((c) => c.h)) || 1;
    return { img, label, comps, medH };
  }

  function segmentAndClassify(a, templates) {
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
    for (const g of groups) {
      const bits = groupBits(g, byId);
      if (g.ids.length === 1 && isHline(g)) { g.kind = 'hline'; continue; }
      if (g.ids.length === 1 && looksLikeDot(g, medH)) { g.kind = 'dot'; continue; }
      const rad = radicalInfo(g, bits, groups);
      if (rad) { g.kind = 'radical'; g.vx = rad.vx; continue; }
      const shape = makeShape(bits, g.w, g.h);
      g.shape = shape;
      g.cands = classify(shape, g.ids.length, templates);
      const best = g.cands[0].t;
      g.kind = 'char';
      g.latex = best.latex;
      g.cls = best.cls;
      g.tmpl = best;
    }
    return groups;
  }

  const LEVELS = [0.17, 0.28, 'otsu'];

  // 이미지 → 분류·크기 추정까지 마친 기호 묶음. recognize 와 learn 이 함께 쓴다.
  async function analyzeImage(source) {
    const templates = await allTemplates();
    const W0 = source.naturalWidth || source.width, H0 = source.naturalHeight || source.height;
    // 기호 높이가 대략 48px 이 되도록 크기 조정
    let scale = Math.min(1, 1600 / Math.max(W0, H0));
    let gray = toGray(rasterize(source, scale));
    const first = analyse(gray, 0.28);
    if (first.medH < 28 || first.medH > 90) {
      scale *= Math.min(48 / first.medH, 4000 / Math.max(W0, H0) / scale);
      gray = toGray(rasterize(source, scale));
    }
    // 이진화 단계마다 글자를 나눠 분류해 보고, 템플릿과 가장 잘 맞는(면적 가중 평균 거리가 작은) 결과를 고른다
    let best = null;
    for (const level of LEVELS) {
      const a = analyse(gray, level);
      const groups = segmentAndClassify(a, templates);
      let wsum = 0, ssum = 0;
      for (const g of groups) if (g.kind === 'char') { wsum += g.area; ssum += g.area * g.cands[0].s; }
      const quality = wsum ? ssum / wsum : Infinity;
      if (!best || quality < best.quality) best = { a, groups, quality, level };
    }
    const { a, groups } = best;
    const { medH } = a;
    if (!groups.length) return { groups, medEm: medH, scale, templates, bin: a.img };

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

    return { groups, medEm, scale, templates, bin: a.img, level: best.level };
  }

  async function recognize(source) {
    const { groups, medEm, scale } = await analyzeImage(source);
    if (!groups.length) return { latex: '', symbols: [], warnings: ['이미지에서 글자를 찾지 못했습니다.'] };
    const latex = tidy(layout(groups, medEm).latex);
    return {
      latex,
      warnings: [],
      _groups: groups,
      symbols: groups.map((g) => ({
        x: (g.x0 - 8) / scale, y: (g.y0 - 8) / scale, w: g.w / scale, h: g.h / scale,
        label: g.kind === 'char' ? g.latex : g.kind === 'hline' ? '—' : g.kind === 'dot' ? '·' : g.kind === 'radical' ? '√' : '?',
        alternatives: g.cands ? g.cands.slice(1, 4).map((c) => c.t.latex) : [],
      })),
    };
  }

  // 점 세 개 → \\cdots / \\ldots, 공백 정리
  function tidy(latex) {
    return latex
      .replace(/(\\cdot\s*){3}/g, '\\cdots ')
      .replace(/\.\s*\.\s*\./g, '\\ldots ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // 디버깅용: 인식에 쓰인 흑백 이미지
  async function debugBinary(source) {
    const { bin } = await analyzeImage(source);
    const cv = document.createElement('canvas');
    cv.width = bin.W; cv.height = bin.H;
    const ctx = cv.getContext('2d');
    const im = ctx.createImageData(bin.W, bin.H);
    for (let k = 0; k < bin.W * bin.H; k++) { const v = bin.bin[k] ? 0 : 255; im.data.set([v, v, v, 255], k * 4); }
    ctx.putImageData(im, 0, 0);
    return cv;
  }

  return { recognize, learn, learned: learnedApi, getTemplates, debugBinary };
});
