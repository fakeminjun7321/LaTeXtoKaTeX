/*
 * text2latex — 여러 방식으로 적은 수식을 LaTeX로 바꾼다. 한 줄 안에서 섞어 써도 된다.
 *   · 한국어 말:      x 제곱 더하기 1, 2 분의 1, 시그마 k=1부터 n까지
 *   · 텍스트 수식:    x^2 + sqrt(x)/2, sum_(i=1)^n, lim_(x->0)
 *   · 한글(HWP) 수식: {a+b} over 2, sqrt x, sum from {i=1} to n, LEFT( x RIGHT), matrix{a & b # c & d}
 *   · LaTeX 명령:     \frac{a}{b}, \alpha
 * 줄을 바꾸면(또는 한글 수식의 #) 결과도 다음 줄로 간다.
 * AI 없이 사전 기반 토크나이저 + 재귀 하강 파서로 동작한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextToLatex = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
    'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi',
    'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'];
  const FUNCS = ['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'exp', 'det', 'max', 'min', 'gcd', 'deg'];

  // 영어/기호 단어 → 토큰
  const WORDS = {
    sqrt: ['SQRT'], cbrt: ['CBRT'], sum: ['SUM'], prod: ['PROD'], int: ['INT'], oint: ['OINT'], lim: ['LIM'],
    inf: ['ATOM', '\\infty'], infty: ['ATOM', '\\infty'], infinity: ['ATOM', '\\infty'],
    abs: ['ABSF'], in: ['REL', '\\in'], to: ['ARROW'], pm: ['OP', '\\pm'], times: ['OP', '\\times'],
    cdot: ['OP', '\\cdot'], div: ['OP', '\\div'], nabla: ['ATOM', '\\nabla'], partial: ['ATOM', '\\partial'],
    // 영어·한글 수식의 hat/bar/vec 는 앞에 붙는 악센트(한국어 '햇·바·벡터'는 뒤에 붙음)
    hat: ['ACC', '\\hat'], bar: ['ACC', '\\bar'], vec: ['ACC', '\\vec'], dot: ['DOTACC'],
    // ── 한글(HWP) 수식 키워드 (대소문자 구분). 어휘는 Quilo(MIT)의 한컴 실측 표를 참고 ──
    over: ['OVER'], atop: ['ATOP'], choose: ['CHOOSE'], CHOOSE: ['CHOOSE'], root: ['ROOT'], of: ['OFW'],
    from: ['HFROM'], LEFT: ['LEFT'], RIGHT: ['RIGHT'], left: ['LEFT'], right: ['RIGHT'],
    matrix: ['MATRIX', 'matrix'], pmatrix: ['MATRIX', 'pmatrix'], bmatrix: ['MATRIX', 'bmatrix'],
    dmatrix: ['MATRIX', 'vmatrix'], cases: ['MATRIX', 'cases'], eqalign: ['MATRIX', 'aligned'],
    tilde: ['ACC', '\\tilde'], ddot: ['ACC', '\\ddot'], dyad: ['ACC', '\\overrightarrow'], acute: ['ACC', '\\acute'],
    grave: ['ACC', '\\grave'], check: ['ACC', '\\check'], under: ['ACC', '\\underline'],
    rm: ['ACC', '\\mathrm'], it: ['ACC', '\\mathit'], bold: ['ACC', '\\mathbf'],
    dint: ['INT', '\\iint'], tint: ['INT', '\\iiint'], qint: ['INT', '\\iiiint'],
    TIMES: ['OP', '\\times'], DIV: ['OP', '\\div'], mod: ['OP', '\\bmod'],
    APPROX: ['REL', '\\approx'], approx: ['REL', '\\approx'], INF: ['ATOM', '\\infty'], IN: ['REL', '\\in'],
    notin: ['REL', '\\notin'], cup: ['OP', '\\cup'], union: ['OP', '\\cup'], cap: ['OP', '\\cap'], inter: ['OP', '\\cap'],
    subset: ['REL', '\\subset'], supset: ['REL', '\\supset'], subseteq: ['REL', '\\subseteq'], supseteq: ['REL', '\\supseteq'],
    forall: ['ATOM', '\\forall'], exists: ['ATOM', '\\exists'], exist: ['ATOM', '\\exists'],
    therefore: ['ATOM', '\\therefore'], because: ['ATOM', '\\because'], angle: ['ATOM', '\\angle'],
    triangle: ['ATOM', '\\triangle'], sim: ['REL', '\\sim'], cong: ['REL', '\\cong'], propto: ['REL', '\\propto'],
    equiv: ['REL', '\\equiv'], le: ['REL', '\\le'], ge: ['REL', '\\ge'], neq: ['REL', '\\neq'],
    circ: ['ATOM', '\\circ'], hbar: ['ATOM', '\\hbar'], ELL: ['ATOM', '\\ell'], ell: ['ATOM', '\\ell'],
    bot: ['REL', '\\perp'], top: ['ATOM', '\\top'], parallel: ['REL', '\\parallel'], VERT: ['ATOM', '\\|'],
    lnot: ['ATOM', '\\neg'], ldots: ['ATOM', '\\ldots'], cdots: ['ATOM', '\\cdots'], vdots: ['ATOM', '\\vdots'],
    ddots: ['ATOM', '\\ddots'], prime: ['PRIME'], del: ['ATOM', '\\nabla'], DEG: ['DEG'],
    RARROW: ['REL', '\\Rightarrow'], LARROW: ['REL', '\\Leftarrow'], LRARROW: ['REL', '\\Leftrightarrow'],
    ANGSTROM: ['ATOM', '\\mathring{A}'], sup: ['FUNC', '\\sup'], arg: ['FUNC', '\\arg'], dim: ['FUNC', '\\dim'],
    GAMMA: ['ATOM', '\\Gamma'], DELTA: ['ATOM', '\\Delta'], THETA: ['ATOM', '\\Theta'], LAMBDA: ['ATOM', '\\Lambda'],
    XI: ['ATOM', '\\Xi'], PI: ['ATOM', '\\Pi'], SIGMA: ['ATOM', '\\Sigma'], PHI: ['ATOM', '\\Phi'], PSI: ['ATOM', '\\Psi'],
    OMEGA: ['ATOM', '\\Omega'],
  };
  for (const g of GREEK) WORDS[g] = ['ATOM', '\\' + g];
  for (const f of FUNCS) WORDS[f] = ['FUNC', '\\' + f];
  WORDS.to = ['TO'];
  // 영단어 속에서 쪼개 찾을 때(2sinx → 2 sin x)는 그리스 문자·함수·기호 이름만. it·rm·of 같은 짧은 구조어는 제외
  const SPLITTABLE = Object.keys(WORDS).filter((k) => k.length > 1 && /^(ATOM|FUNC|SQRT|CBRT|SUM|PROD|INT|OINT|LIM)$/.test(WORDS[k][0]));

  // 영어 수사: ten → 10, twenty five → 25, three hundred → 300
  const EN_NUM = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const EN_MUL = { hundred: 100, thousand: 1000, million: 1000000 };

  // 한국어 사전(긴 것부터 매칭). 사전에 없는 글자(조사 등)는 무시한다.
  const KO = {
    '플러스마이너스': ['OP', '\\pm'], '플마': ['OP', '\\pm'],
    '더하기': ['OP', '+'], '플러스': ['OP', '+'], '빼기': ['OP', '-'], '마이너스': ['OP', '-'],
    '곱하기': ['OP', '\\times'], '나누기': ['SLASH'],
    '세제곱근': ['CBRT'], '제곱근': ['SQRT'], '루트': ['SQRT'], '근호': ['SQRT'],
    '세제곱': ['CUBE'], '제곱': ['SQUARE'], '승': ['SEUNG'],
    '분의': ['FRACOF'],
    '시그마': ['SUM'], '합': ['SUM'], '총곱': ['PROD'], '적분': ['INT'], '인테그랄': ['INT'], '극한': ['LIM'], '리미트': ['LIM'],
    '부터': ['FROM'], '까지': ['UPTO'], '으로': ['TOWARD'], '로': ['TOWARD'], '때': ['WHEN'],
    '절댓값': ['ABS'], '절대값': ['ABS'], '프라임': ['PRIME'], '팩토리얼': ['OP', '!'],
    '무한대': ['ATOM', '\\infty'], '무한': ['ATOM', '\\infty'],
    '바': ['BAR'], '햇': ['HAT'], '벡터': ['VEC'], '도': ['DEG'], '퍼센트': ['ATOM', '\\%'],
    '이다': ['NOP'], '입니다': ['NOP'], '의': ['OF'], '는': ['REL', '='], '은': ['REL', '='], '이퀄': ['REL', '='],
    '보다': ['THAN'], '크거나': ['REL', '\\ge'], '작거나': ['REL', '\\le'], '크다': ['REL', '>'], '작다': ['REL', '<'],
    '같지': ['REL', '\\neq'], '다르다': ['REL', '\\neq'],
    '이상': ['POSTREL', '\\ge'], '이하': ['POSTREL', '\\le'], '초과': ['POSTREL', '>'], '미만': ['POSTREL', '<'],
    '열고': ['LP'], '여는': ['LP'], '닫고': ['RP'], '닫는': ['RP'],
    '사인': ['FUNC', '\\sin'], '코사인': ['FUNC', '\\cos'], '탄젠트': ['FUNC', '\\tan'],
    '자연로그': ['FUNC', '\\ln'], '로그': ['FUNC', '\\log'], '엘엔': ['FUNC', '\\ln'],
    '알파': ['ATOM', '\\alpha'], '베타': ['ATOM', '\\beta'], '감마': ['ATOM', '\\gamma'], '델타': ['ATOM', '\\delta'],
    '엡실론': ['ATOM', '\\epsilon'], '입실론': ['ATOM', '\\epsilon'], '제타': ['ATOM', '\\zeta'], '에타': ['ATOM', '\\eta'],
    '세타': ['ATOM', '\\theta'], '쎄타': ['ATOM', '\\theta'], '람다': ['ATOM', '\\lambda'], '뮤': ['ATOM', '\\mu'],
    '뉴': ['ATOM', '\\nu'], '크사이': ['ATOM', '\\xi'], '파이': ['ATOM', '\\pi'], '로우': ['ATOM', '\\rho'],
    '타우': ['ATOM', '\\tau'], '피': ['ATOM', '\\phi'], '카이': ['ATOM', '\\chi'], '프사이': ['ATOM', '\\psi'],
    '오메가': ['ATOM', '\\omega'], '델': ['ATOM', '\\nabla'], '라운드': ['ATOM', '\\partial'],
    '엑스': ['VAR', 'x'], '와이': ['VAR', 'y'], '제트': ['VAR', 'z'], '에이': ['VAR', 'a'], '비': ['VAR', 'b'],
    '씨': ['VAR', 'c'], '디': ['VAR', 'd'], '에프': ['VAR', 'f'], '엔': ['VAR', 'n'], '엠': ['VAR', 'm'],
    '케이': ['VAR', 'k'], '아이': ['VAR', 'i'], '제이': ['VAR', 'j'], '티': ['VAR', 't'], '에스': ['VAR', 's'],
    '브이': ['VAR', 'v'], '유': ['VAR', 'u'], '알': ['VAR', 'r'], '피엑스': ['VAR', 'p'],
  };
  const KO_DIGITS = { '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '륙': 6, '칠': 7, '팔': 8, '구': 9 };
  const KO_UNITS = { '십': 10, '백': 100, '천': 1000 };
  // 이십오 → 25, 백삼 → 103, 삼만 → 30000
  function koNumber(s) {
    let total = 0, section = 0, cur = 0;
    for (const ch of s) {
      if (ch in KO_DIGITS) cur = KO_DIGITS[ch];
      else if (ch in KO_UNITS) { section += (cur || 1) * KO_UNITS[ch]; cur = 0; }
      else if (ch === '만') { total += (section + cur || 1) * 10000; section = cur = 0; }
    }
    return total + section + cur;
  }
  const KO_KEYS = Object.keys(KO).sort((a, b) => b.length - a.length);

  const SYMBOLS = [
    ['<->', 'REL', '\\leftrightarrow'], ['<-', 'REL', '\\leftarrow'], ['//', 'REL', '\\parallel'], ['==', 'REL', '\\equiv'],
    ['-+', 'OP', '\\mp'], ['#', 'HASH'], ['&', 'AMP'], ['`', 'ATOM', '\\,'],
    ['<=', 'REL', '\\le'], ['>=', 'REL', '\\ge'], ['!=', 'REL', '\\neq'], ['=/=', 'REL', '\\neq'], ['~=', 'REL', '\\approx'],
    ['->', 'ARROW'], ['=>', 'REL', '\\Rightarrow'], ['+-', 'OP', '\\pm'],
    ['≤', 'REL', '\\le'], ['≥', 'REL', '\\ge'], ['≠', 'REL', '\\neq'], ['≈', 'REL', '\\approx'], ['→', 'ARROW'],
    ['±', 'OP', '\\pm'], ['×', 'OP', '\\times'], ['÷', 'OP', '\\div'], ['·', 'OP', '\\cdot'], ['∈', 'REL', '\\in'],
    ['√', 'SQRT'], ['∑', 'SUM'], ['∏', 'PROD'], ['∫', 'INT'], ['∞', 'ATOM', '\\infty'], ['π', 'ATOM', '\\pi'],
    ['θ', 'ATOM', '\\theta'], ['α', 'ATOM', '\\alpha'], ['β', 'ATOM', '\\beta'], ['∂', 'ATOM', '\\partial'],
    ['²', 'SQUARE'], ['³', 'CUBE'],
    ['=', 'REL', '='], ['<', 'REL', '<'], ['>', 'REL', '>'],
    ['+', 'OP', '+'], ['-', 'OP', '-'], ['*', 'OP', '\\cdot'], ['/', 'SLASH'],
    ['^', 'CARET'], ['_', 'UNDER'], ['(', 'LP'], [')', 'RP'], ['[', 'LB'], [']', 'RB'], ['{', 'LC'], ['}', 'RC'],
    ['|', 'PIPE'], [',', 'COMMA'], ['!', 'OP', '!'], ["'", 'PRIME'], ['%', 'ATOM', '\\%'], ['.', 'ATOM', '.'],
    ['~', 'ATOM', '\\ '], [':', 'REL', ':'], [';', 'COMMA'],
  ];

  function tokenize(input) {
    const toks = [];
    let i = 0, space = true, depth = 0;
    const push = (t, v) => { toks.push({ t, v, space }); space = false; };
    while (i < input.length) {
      const c = input[i];
      // 중괄호 밖의 줄바꿈은 결과에서도 줄바꿈
      if (c === '\n' && depth === 0) { push('NL'); space = true; i++; continue; }
      if (/\s/.test(c)) { space = true; i++; continue; }
      if (c === '{') depth++;
      if (c === '}') depth = Math.max(0, depth - 1);
      // 한글 수식의 "따옴표 글자"
      if (c === '"') {
        const close = input.indexOf('"', i + 1);
        const text = input.slice(i + 1, close === -1 ? input.length : close);
        push('ATOM', `\\text{${text}}`);
        i = close === -1 ? input.length : close + 1;
        continue;
      }
      if (/[0-9]/.test(c)) {
        const m = /^[0-9]+(\.[0-9]+)?/.exec(input.slice(i));
        push('NUM', m[0]); i += m[0].length; continue;
      }
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(input.slice(i));
        const w = m ? m[1] : '';
        const known = WORDS[w];
        if (known && known[0] !== 'ATOM') push(known[0], known[1]);
        else if (w === 'frac') push('FRACF');
        else push('ATOM', '\\' + w);
        i += w.length + 1; continue;
      }
      if (/[A-Za-z]/.test(c)) {
        const w = /^[A-Za-z]+/.exec(input.slice(i))[0];
        i += w.length;
        const lw = w.toLowerCase();
        if (lw in EN_NUM || lw in EN_MUL) {
          // 이어지는 수사 단어를 모아 하나의 수로
          let total = 0, cur = 0, j = i - w.length;
          const re = /^[\s-]*([A-Za-z]+)/;
          let m;
          while ((m = re.exec(input.slice(j))) && (m[1].toLowerCase() in EN_NUM || m[1].toLowerCase() in EN_MUL || (m[1].toLowerCase() === 'and' && cur))) {
            const x = m[1].toLowerCase();
            if (x in EN_NUM) cur += EN_NUM[x];
            else if (x === 'hundred') cur = (cur || 1) * 100;
            else if (x in EN_MUL) { total += (cur || 1) * EN_MUL[x]; cur = 0; }
            j += m[0].length;
          }
          push('NUM', String(total + cur));
          i = j;
          continue;
        }
        if (WORDS[w]) { push(WORDS[w][0], WORDS[w][1]); continue; }
        if (w === 'frac') { push('FRACF'); continue; }
        // 알려진 단어가 섞여 있으면(예: 2sinx) 앞에서부터 가장 긴 단어를 찾는다
        let k = 0;
        while (k < w.length) {
          let hit = '';
          for (const key of SPLITTABLE) if (key.length > hit.length && w.startsWith(key, k)) hit = key;
          if (hit) { push(WORDS[hit][0], WORDS[hit][1]); k += hit.length; }
          else { push('VAR', w[k]); k++; }
        }
        continue;
      }
      if (/[가-힣]/.test(c)) {
        const run = /^[가-힣]+/.exec(input.slice(i))[0];
        i += run.length;
        let k = 0;
        const spaced = space;
        while (k < run.length) {
          const key = KO_KEYS.find((x) => run.startsWith(x, k));
          // 한글 숫자(십, 이십오, 백 …). 앞 글자에 붙은 '이'·'일'(0이다, 0일 때)은 조사로 보고,
          // '이상'·'사인'처럼 사전 단어가 더 길면 사전 단어를 쓴다.
          const num = /^[영공일이삼사오육륙칠팔구십백천만]+/.exec(run.slice(k));
          const attached = k === 0 && !spaced && toks.length > 0;
          const when = num && num[0] === '일' && /^\s*때/.test(input.slice(i - run.length + k + 1));
          if (num && !attached && !when && (!key || num[0].length > key.length)) {
            push('NUM', String(koNumber(num[0])));
            k += num[0].length;
            continue;
          }
          if (key) { if (KO[key][0] !== 'NOP') push(KO[key][0], KO[key][1]); k += key.length; }
          else k++; // 조사 등은 무시
        }
        continue;
      }
      const sym = SYMBOLS.find(([s]) => input.startsWith(s, i));
      if (sym) { push(sym[1], sym[2]); i += sym[0].length; continue; }
      i++; // 알 수 없는 문자
    }
    return toks;
  }

  // ───────────────────────── 파서 ─────────────────────────

  const isSingle = (s) => /^(\\[A-Za-z]+|[^\s])$/.test(s);
  const grp = (s) => (isSingle(s) ? s : `{${s}}`);
  const bare = (n) => n.inner ?? n.tex; // 괄호를 벗긴 내용
  const tall = (s) => /\\(frac|sum|int|prod|lim|sqrt\[)/.test(s);
  function join(a, b) {
    if (!a) return b;
    if (!b) return a;
    // \alpha x, x^n i, \log_2 8 처럼 붙으면 읽기 어렵거나 의미가 바뀌는 경우 공백
    const needs = /(\\[A-Za-z]+|[\^_][A-Za-z0-9])$/.test(a) && /^[A-Za-z0-9]/.test(b);
    return needs ? a + ' ' + b : a + b;
  }

  function parse(input) {
    const toks = tokenize(input);
    const warnings = [];
    let p = 0;
    const peek = (o = 0) => toks[p + o] || { t: 'EOF' };
    const is = (t, o = 0) => peek(o).t === t;
    const eat = (t) => { if (is(t)) return toks[p++]; return null; };
    let absDepth = 0; // |x| 안에서는 '|' 가 닫는 기호
    const starts = () => STARTS.has(peek().t) && !(absDepth > 0 && is('PIPE'));

    const STARTS = new Set(['NUM', 'VAR', 'ATOM', 'FUNC', 'LP', 'LB', 'LC', 'PIPE', 'SQRT', 'CBRT', 'SUM', 'PROD',
      'INT', 'OINT', 'LIM', 'ABS', 'ABSF', 'VEC', 'HAT', 'BAR', 'DOTACC', 'FRACF', 'LEFT', 'MATRIX', 'ROOT', 'ACC']);

    function list(endT) {
      const parts = [relation()];
      while (eat('COMMA')) parts.push(relation());
      if (endT && !eat(endT)) warnings.push('닫는 괄호가 없습니다.');
      return parts.join(', ');
    }

    function relation() {
      let out = expr();
      let lastRel = null; // 마지막으로 넣은 관계 기호의 위치
      for (;;) {
        if (is('REL') || is('ARROW') || is('TO')) {
          const r = toks[p++];
          const sym = r.t === 'REL' ? r.v : '\\to';
          lastRel = { at: out.length, sym };
          out += ` ${sym} `;
          if (is('EOF') || is('COMMA') || is('RP') || is('NL') || is('HASH') || is('AMP')) break;
          out += expr();
          continue;
        }
        // "x는 3보다 크다", "x는 3 이상" → 앞의 '=' 를 바꾼다
        if (is('THAN') || is('POSTREL')) {
          let sym;
          if (eat('THAN')) {
            const r = eat('REL');
            sym = r ? r.v : null;
            if (sym === '=') sym = null;
          } else sym = toks[p++].v;
          // '크거나' 뒤의 '같다'는 사전에 없으므로 무시된다
          if (sym && lastRel) {
            out = out.slice(0, lastRel.at) + ` ${sym} ` + out.slice(lastRel.at + lastRel.sym.length + 2);
            lastRel.sym = sym;
          } else if (sym) out += ` ${sym}`;
          continue;
        }
        break;
      }
      return out.replace(/\s+/g, ' ').trim();
    }

    function expr() {
      let out = '';
      if (is('OP') && (peek().v === '-' || peek().v === '+' || peek().v === '\\pm')) out = toks[p++].v;
      out = join(out, term());
      while (is('OP') && peek().v !== '!') {
        const op = toks[p++].v;
        out += ` ${op} `;
        if (starts() || (is('OP') && peek().v === '-')) {
          if (eat('OP')) out += '-';
          out = join(out, term());
        }
      }
      return out;
    }

    // 곱(암시적 곱 포함)과 분수. '/' 와 한글 수식 over 는 공백 없이 붙은 덩어리끼리 묶는다:
    // dy/dx, 2x/3y, dx over dt → 분수 / a + b over c → a + b/c / 1 over 2 m → (1/2) m
    function term() {
      let cur = '';
      let runStart = 0, runNode = null; // 지금 덩어리가 cur 에서 시작하는 위치, 덩어리가 인자 하나면 그 노드
      const attached = () => (is('VAR') || is('NUM') || is('ATOM') || is('LP')) && !peek().space;
      for (;;) {
        // 두 피연산자 사이의 영어 'dot' 은 내적(·). 'dot{x}' 나 맨 앞의 dot 은 악센트
        if (cur && is('DOTACC') && !is('LC', 1) && STARTS.has(peek(1).t)) { p++; cur += ' \\cdot '; runStart = cur.length; runNode = null; continue; }
        if (!starts()) break;
        const fresh = !cur || peek().space;
        const n = factor();
        const joined = join(cur, n.tex);
        if (fresh) { runStart = joined.length - n.tex.length; runNode = n; } else runNode = null;
        cur = joined;
        if (is('SLASH') || is('OVER') || is('ATOP') || is('CHOOSE')) {
          const k = toks[p++].t;
          let den = bare(factor());
          while (attached()) den = join(den, factor().tex);
          const num = runNode ? bare(runNode) : cur.slice(runStart);
          const frac = k === 'CHOOSE' ? `\\binom{${num}}{${den}}` : k === 'ATOP' ? `\\genfrac{}{}{0pt}{}{${num}}{${den}}` : `\\frac{${num}}{${den}}`;
          cur = cur.slice(0, runStart) + frac;
          runNode = { tex: frac };
        }
      }
      return cur;
    }

    // "b 분의 a" → a/b
    function factor() {
      const left = postfix();
      if (eat('FRACOF')) {
        const right = postfix();
        return { tex: `\\frac{${bare(right)}}{${bare(left)}}` };
      }
      return left;
    }

    function script(base, kind, n) {
      return { tex: `${base.tex}${kind}${grp(n)}` };
    }

    function scriptArg() {
      if (is('OP') && peek().v === '-') { p++; return '-' + bare(postfixNoScripts()); }
      return bare(postfixNoScripts());
    }

    function postfixNoScripts() { return primary(); }

    function postfix() {
      let n = primary();
      for (;;) {
        if (eat('CARET')) n = script(n, '^', scriptArg());
        else if (eat('UNDER')) n = script(n, '_', scriptArg());
        else if (eat('SQUARE')) n = script(n, '^', '2');
        else if (eat('CUBE')) n = script(n, '^', '3');
        else if (eat('PRIME')) n = { tex: n.tex + "'" };
        else if (is('OP') && peek().v === '!') { p++; n = { tex: n.tex + '!' }; }
        else if (eat('DEG')) n = { tex: n.tex + '^\\circ' };
        else if (eat('BAR')) n = { tex: (isSingle(bare(n)) ? '\\bar' : '\\overline') + `{${bare(n)}}` };
        else if (eat('HAT')) n = { tex: (isSingle(bare(n)) ? '\\hat' : '\\widehat') + `{${bare(n)}}` };
        else if (eat('VEC')) n = { tex: `\\vec{${bare(n)}}` };
        // 'x bar' 처럼 뒤에 꾸밀 대상이 없는 영어 악센트는 앞 글자에 붙인다
        else if (is('ACC') && /^\\(bar|hat|vec|tilde)$/.test(peek().v) && !STARTS.has(peek(1).t)) {
          const v = toks[p++].v, w = { '\\bar': '\\overline', '\\hat': '\\widehat', '\\tilde': '\\widetilde' };
          n = { tex: `${w[v] && !isSingle(bare(n)) ? w[v] : v}{${bare(n)}}` };
        }
        else if (is('OF')) {
          // x의 제곱 / x의 3승 / x의 절댓값 / x의 제곱근
          const a = peek(1), b = peek(2);
          if (a.t === 'SQUARE') { p += 2; n = script(n, '^', '2'); }
          else if (a.t === 'CUBE') { p += 2; n = script(n, '^', '3'); }
          else if (a.t === 'ABS') { p += 2; n = { tex: `\\left|${bare(n)}\\right|` }; }
          else if (a.t === 'SQRT') { p += 2; n = { tex: `\\sqrt{${bare(n)}}` }; }
          else if (a.t === 'CBRT') { p += 2; n = { tex: `\\sqrt[3]{${bare(n)}}` }; }
          else if ((a.t === 'NUM' || a.t === 'VAR' || a.t === 'LP') && (b.t === 'SQUARE' || b.t === 'SEUNG' || a.t === 'LP')) {
            p++;
            const e = primary();
            if (!eat('SQUARE')) eat('SEUNG');
            n = script(n, '^', bare(e));
          } else { p++; } // 그냥 '의'
        } else if (eat('SEUNG')) { /* 홀로 쓰인 '승' 무시 */ }
        else break;
      }
      return n;
    }

    function group(open, close, l, r) {
      p++;
      const inner = list(close);
      const big = tall(inner);
      return { tex: big ? `\\left${l}${inner}\\right${r}` : `${l}${inner}${r}`, inner };
    }

    // 극한·합·적분의 범위: _a^b 형식 또는 "a부터 b까지"
    function bounds() {
      let lo = null, hi = null;
      // 한글 수식: sum from {i=1} to n
      if (eat('HFROM')) { lo = bare(postfix()); if (eat('TO')) hi = bare(postfix()); return { lo, hi }; }
      if (eat('UNDER')) { lo = scriptArg(); if (eat('CARET')) hi = scriptArg(); return { lo, hi }; }
      if (eat('CARET')) { hi = scriptArg(); if (eat('UNDER')) lo = scriptArg(); return { lo, hi }; }
      const save = p;
      if (starts() || is('OP')) {
        const a = relation();
        if (eat('FROM')) {
          lo = a;
          hi = expr();
          eat('UPTO');
          return { lo, hi };
        }
      }
      p = save;
      return { lo, hi };
    }
    // LEFT/RIGHT 다음의 괄호 기호
    function delim() {
      const t = toks[p++] || { t: 'EOF' };
      const map = { LP: '(', RP: ')', LB: '[', RB: ']', LC: '\\{', RC: '\\}', PIPE: '|' };
      if (map[t.t]) return map[t.t];
      if (t.t === 'REL' && t.v === '<') return '\\langle';
      if (t.t === 'REL' && t.v === '>') return '\\rangle';
      if (t.t === 'ATOM' && (t.v === '.' || t.v === '\\|')) return t.v;
      p--;
      return '.';
    }
    const limits = (cmd, b) => cmd + (b.lo !== null ? `_${grp(b.lo)}` : '') + (b.hi !== null ? `^${grp(b.hi)}` : '');

    function limitSub() {
      if (eat('UNDER') || eat('HFROM')) return scriptArg().replace(/\s*\\to\s*/, ' \\to ');
      // x -> 0 / x→0
      if (is('VAR') && (is('ARROW', 1) || is('TO', 1))) { const v = toks[p++].v; p++; return `${v} \\to ${bare(postfix())}`; }
      // x가 0으로 (갈) 때
      if (is('VAR') && (is('TOWARD', 2) || is('TOWARD', 3))) {
        const v = toks[p++].v;
        const target = expr();
        eat('TOWARD'); eat('WHEN');
        return `${v} \\to ${target}`;
      }
      return null;
    }

    function primary() {
      const tk = peek();
      switch (tk.t) {
        case 'NUM': case 'ATOM': p++; return { tex: tk.v };
        case 'VAR': {
          // "x가 0으로 갈 때 극한 ..." 처럼 극한 조건이 앞에 오는 경우
          if (is('TOWARD', 2) && (is('WHEN', 3) || is('LIM', 3))) {
            const sub = limitSub();
            eat('LIM');
            return { tex: `\\lim_{${sub}} ${term()}`.trim() };
          }
          p++;
          return { tex: tk.v };
        }
        case 'LP': return group('LP', 'RP', '(', ')');
        case 'LB': return group('LB', 'RB', '[', ']');
        // { } 는 LaTeX·한글 수식처럼 보이지 않는 묶음. 중괄호 기호는 \\{ \\} 로
        case 'LC': { p++; const inner = list('RC'); return { tex: `{${inner}}`, inner }; }
        case 'LEFT': {
          p++;
          const open = delim();
          const inner = list('RIGHT');
          const close = delim();
          return { tex: `\\left${open} ${inner} \\right${close}`, inner };
        }
        case 'MATRIX': {
          p++;
          const env = tk.v;
          if (!eat('LC')) { warnings.push(`${env} 뒤에 { } 가 필요합니다.`); return { tex: '' }; }
          const rows = [[]];
          for (;;) {
            rows[rows.length - 1].push(is('AMP') || is('HASH') || is('RC') ? '' : list());
            if (eat('AMP')) continue;
            if (eat('HASH') || eat('NL')) { rows.push([]); continue; }
            if (!eat('RC')) warnings.push(`${env} 의 닫는 } 가 없습니다.`);
            break;
          }
          const body = rows.filter((r) => r.some(Boolean)).map((r) => r.join(' & ')).join(' \\\\ ');
          return { tex: `\\begin{${env}} ${body} \\end{${env}}` };
        }
        case 'ROOT': {
          p++;
          const idx = postfix();
          eat('OFW');
          const a = postfix();
          return { tex: `\\sqrt[${bare(idx)}]{${bare(a)}}` };
        }
        case 'ACC': {
          p++;
          const a = primary();
          const wide = { '\\bar': '\\overline', '\\hat': '\\widehat', '\\tilde': '\\widetilde' };
          return { tex: `${wide[tk.v] && !isSingle(bare(a)) ? wide[tk.v] : tk.v}{${bare(a)}}` };
        }
        case 'PIPE': {
          p++;
          absDepth++;
          const inner = expr();
          absDepth--;
          eat('PIPE');
          return { tex: `\\left|${inner}\\right|` };
        }
        case 'ABS': case 'ABSF': { p++; const a = postfix(); return { tex: `\\left|${bare(a)}\\right|` }; }
        case 'SQRT': {
          p++;
          if (is('LB')) { p++; const idx = list('RB'); const a = postfix(); return { tex: `\\sqrt[${idx}]{${bare(a)}}` }; }
          const a = postfix();
          return { tex: `\\sqrt{${bare(a)}}` };
        }
        case 'CBRT': { p++; const a = postfix(); return { tex: `\\sqrt[3]{${bare(a)}}` }; }
        case 'FRACF': {
          p++;
          const a = primary(), b = primary();
          return { tex: `\\frac{${bare(a)}}{${bare(b)}}` };
        }
        case 'VEC': case 'HAT': case 'BAR': case 'DOTACC': {
          p++;
          const a = primary();
          const cmd = { VEC: '\\vec', HAT: isSingle(bare(a)) ? '\\hat' : '\\widehat', BAR: isSingle(bare(a)) ? '\\bar' : '\\overline', DOTACC: '\\dot' }[tk.t];
          return { tex: `${cmd}{${bare(a)}}` };
        }
        case 'FUNC': {
          p++;
          let head = tk.v;
          for (;;) {
            if (eat('CARET')) head += '^' + grp(scriptArg());
            else if (eat('UNDER')) head += '_' + grp(scriptArg());
            else if (eat('SQUARE')) head += '^2';
            else if (eat('CUBE')) head += '^3';
            else break;
          }
          if (!starts()) return { tex: head };
          const arg = is('LP') ? primary() : postfix();
          return { tex: join(head, arg.tex) };
        }
        case 'SUM': case 'PROD': {
          p++;
          const b = bounds();
          const body = term();
          return { tex: join(limits(tk.t === 'SUM' ? '\\sum' : '\\prod', b), body) };
        }
        case 'INT': case 'OINT': {
          p++;
          const b = bounds();
          let body = expr();
          // 끝의 dx 앞에 얇은 공백
          body = body.replace(/(.)\s*d([A-Za-z])$/, (m, pre, v) => (pre === '\\' ? m : `${pre}\\,d${v}`));
          return { tex: join(limits(tk.t === 'INT' ? tk.v || '\\int' : '\\oint', b), body) };
        }
        case 'LIM': {
          p++;
          const sub = limitSub();
          const body = term();
          return { tex: join(sub ? `\\lim_{${sub}}` : '\\lim', body) };
        }
        default:
          p++;
          warnings.push(`이해하지 못한 부분을 건너뜀: ${tk.v ?? tk.t}`);
          return { tex: '' };
      }
    }

    // 줄(입력의 줄바꿈 또는 한글 수식의 #)마다 따로 읽는다. & 는 줄 사이 정렬 위치
    const lines = [];
    let line = '';
    while (p < toks.length) {
      if (eat('NL') || eat('HASH')) { lines.push(line); line = ''; continue; }
      if (eat('AMP')) { line += ' & '; continue; }
      const before = p;
      const part = list();
      if (part) line = line && !/&\s*$/.test(line) ? line + ' \\quad ' + part : line + part;
      if (p === before) { warnings.push(`이해하지 못한 부분을 건너뜀: ${peek().v ?? peek().t}`); p++; }
    }
    lines.push(line);
    const rows = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    let latex = rows[0] || '';
    if (rows.length > 1) {
      const env = rows.some((r) => r.includes('&')) ? 'aligned' : 'gathered';
      latex = `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
    }
    return { latex, warnings, lines: rows };
  }

  return { parse, tokenize };
});
