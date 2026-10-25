/*
 * text2latex — 말(한국어)이나 간단한 텍스트 수식(x^2 + sqrt(x)/2)을 LaTeX로 바꾼다.
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
    hat: ['HAT'], bar: ['BAR'], vec: ['VEC'], dot: ['DOTACC'],
  };
  for (const g of GREEK) WORDS[g] = ['ATOM', '\\' + g];
  for (const f of FUNCS) WORDS[f] = ['FUNC', '\\' + f];

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
    '의': ['OF'], '는': ['REL', '='], '은': ['REL', '='], '이퀄': ['REL', '='],
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
  const KO_KEYS = Object.keys(KO).sort((a, b) => b.length - a.length);

  const SYMBOLS = [
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
  ];

  function tokenize(input) {
    const toks = [];
    let i = 0, space = true;
    const push = (t, v) => { toks.push({ t, v, space }); space = false; };
    while (i < input.length) {
      const c = input[i];
      if (/\s/.test(c)) { space = true; i++; continue; }
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
        if (WORDS[w]) { push(WORDS[w][0], WORDS[w][1]); continue; }
        if (w === 'frac') { push('FRACF'); continue; }
        // 알려진 단어가 섞여 있으면(예: 2sinx) 앞에서부터 가장 긴 단어를 찾는다
        let k = 0;
        while (k < w.length) {
          let hit = '';
          for (const key of Object.keys(WORDS)) if (key.length > hit.length && w.startsWith(key, k) && key.length > 1) hit = key;
          if (hit) { push(WORDS[hit][0], WORDS[hit][1]); k += hit.length; }
          else { push('VAR', w[k]); k++; }
        }
        continue;
      }
      if (/[가-힣]/.test(c)) {
        const run = /^[가-힣]+/.exec(input.slice(i))[0];
        i += run.length;
        let k = 0;
        while (k < run.length) {
          const key = KO_KEYS.find((x) => run.startsWith(x, k));
          if (key) { push(KO[key][0], KO[key][1]); k += key.length; }
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
      'INT', 'OINT', 'LIM', 'ABS', 'ABSF', 'VEC', 'HAT', 'BAR', 'DOTACC', 'FRACF']);

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
        if (is('REL') || is('ARROW')) {
          const r = toks[p++];
          const sym = r.t === 'ARROW' ? '\\to' : r.v;
          lastRel = { at: out.length, sym };
          out += ` ${sym} `;
          if (is('EOF') || is('COMMA') || is('RP')) break;
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

    // 곱(암시적 곱 포함)과 '/' 분수
    function term() {
      let cur = '';
      while (starts()) {
        const n = factor();
        cur = join(cur, n.tex);
        if (is('SLASH')) {
          p++;
          // 분모: 다음 인자 + 공백 없이 붙은 단순 인자들 (dy/dx, 2x/3y)
          let den = factor();
          let denTex = bare(den);
          while ((is('VAR') || is('NUM') || is('ATOM')) && !peek().space) denTex = join(denTex, factor().tex);
          const numTex = cur === n.tex ? bare(n) : cur;
          cur = `\\frac{${numTex}}{${denTex}}`;
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
    const limits = (cmd, b) => cmd + (b.lo !== null ? `_${grp(b.lo)}` : '') + (b.hi !== null ? `^${grp(b.hi)}` : '');

    function limitSub() {
      if (eat('UNDER')) return scriptArg().replace(/\s*\\to\s*/, ' \\to ');
      // x -> 0 / x→0
      if (is('VAR') && is('ARROW', 1)) { const v = toks[p++].v; p++; return `${v} \\to ${bare(postfix())}`; }
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
        case 'LC': return group('LC', 'RC', '\\{', '\\}');
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
          return { tex: join(limits(tk.t === 'INT' ? '\\int' : '\\oint', b), body) };
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

    let out = '';
    while (p < toks.length) {
      const before = p;
      const part = list();
      out = out ? out + ' \\quad ' + part : part;
      if (p === before) { warnings.push(`이해하지 못한 부분을 건너뜀: ${peek().v ?? peek().t}`); p++; }
    }
    return { latex: out.replace(/\s+/g, ' ').trim(), warnings };
  }

  return { parse, tokenize };
});
