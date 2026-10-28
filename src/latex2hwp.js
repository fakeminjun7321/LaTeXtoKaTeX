/*
 * latex2hwp — LaTeX 수식을 한글(한컴) 수식 편집기 스크립트로 바꾼다.
 * 키워드 표와 한컴 렌더러 특이사항은 Quilo(MIT, lib/equation/hwpx_equation_tool.py,
 * docs/hwp-equation-quirks.md)의 실측 결과를 따랐다. 예:
 *   ⇒ 는 '=>'가 아니라 RARROW, n제곱근은 'root n of' 대신 {}^{n} sqrt, 키워드를 품은
 *   글자 묶음(pivot ⊃ pi)은 p{}i{}v{}o{}t 처럼 빈 그룹으로 끊어야 한컴이 잘못 읽지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LatexToHwp = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CMD = {
    times: 'TIMES', cdot: 'cdot', div: 'DIV', pm: '+-', mp: '-+', approx: 'APPROX', equiv: '==',
    le: '<=', leq: '<=', ge: '>=', geq: '>=', leqslant: '<=', geqslant: '>=', ne: '!=', neq: '!=',
    to: '->', rightarrow: '->', longrightarrow: '->', leftarrow: '<-', longleftarrow: '<-',
    leftrightarrow: '<->', longleftrightarrow: '<->', Rightarrow: 'RARROW', Longrightarrow: 'RARROW', implies: 'RARROW',
    Leftarrow: 'LARROW', Longleftarrow: 'LARROW', Leftrightarrow: 'LRARROW', Longleftrightarrow: 'LRARROW', iff: 'LRARROW',
    infty: 'INF', partial: 'partial', nabla: 'nabla', forall: 'forall', exists: 'exists', in: 'in', notin: 'notin',
    cup: 'cup', cap: 'cap', subset: 'subset', subseteq: 'subseteq', supset: 'supset', supseteq: 'supseteq',
    varepsilon: 'epsilon', epsilon: 'epsilon', vartheta: 'theta', varphi: 'phi', varrho: 'rho', varsigma: 'sigma',
    Delta: 'DELTA', Sigma: 'SIGMA', Gamma: 'GAMMA', Theta: 'THETA', Lambda: 'LAMBDA', Xi: 'XI', Pi: 'PI',
    Omega: 'OMEGA', Phi: 'PHI', Psi: 'PSI', Upsilon: 'Upsilon',
    sum: 'sum', prod: 'prod', int: 'int', iint: 'dint', iiint: 'tint', iiiint: 'qint', oint: 'oint', lim: 'lim',
    circ: 'circ', degree: 'DEG', hbar: 'hbar', ell: 'ELL', perp: 'bot', parallel: 'parallel', propto: 'propto',
    AA: 'ANGSTROM', ldots: 'ldots', cdots: 'cdots', vdots: 'vdots', ddots: 'ddots', dots: 'ldots',
    sup: 'sup', inf: 'inf', mod: 'mod', bmod: 'mod', pmod: 'mod', top: 'top', bot: 'bot', neg: 'lnot', lnot: 'lnot',
    mid: '|', lVert: 'VERT', rVert: 'VERT', Vert: 'VERT', lvert: '|', rvert: '|', vert: '|',
    sim: 'sim', cong: 'cong', angle: 'angle', triangle: 'triangle', therefore: 'therefore', because: 'because',
    prime: "'", langle: '<', rangle: '>',
  };
  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu',
    'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'];
  const FUNCS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
    'log', 'ln', 'exp', 'min', 'max', 'det', 'gcd', 'arg', 'deg', 'dim'];
  for (const g of GREEK) CMD[g] = g;
  for (const f of FUNCS) CMD[f] = f;
  const SPACES = { ',': '`', ';': '~', ':': '~', ' ': '~', quad: '~', qquad: '~ ~', '!': '' };
  const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'left', 'right', 'middle']);
  const ACCENT = {
    hat: 'hat', widehat: 'hat', bar: 'bar', overline: 'bar', vec: 'vec', tilde: 'tilde', widetilde: 'tilde',
    dot: 'dot', ddot: 'ddot', overrightarrow: 'dyad', underline: 'under', mathrm: 'rm', mathbf: 'bold',
    boldsymbol: 'bold', mathit: 'it', acute: 'acute', grave: 'grave', check: 'check',
  };
  const STRIP = new Set(['mathbb', 'mathcal', 'mathscr', 'mathfrak', 'mathsf', 'mathtt', 'operatorname', 'ensuremath']);
  const TEXT = new Set(['text', 'textrm', 'textnormal', 'mbox', 'textbf', 'textit']);
  const ENV = {
    matrix: 'matrix', pmatrix: 'pmatrix', bmatrix: 'bmatrix', vmatrix: 'dmatrix', Vmatrix: 'dmatrix', Bmatrix: 'matrix',
    smallmatrix: 'matrix', cases: 'cases', aligned: 'matrix', align: 'matrix', 'align*': 'matrix', gathered: 'matrix',
    array: 'matrix', alignat: 'matrix', alignedat: 'matrix', split: 'matrix',
  };
  const BIG = new Set(['sum', 'prod', 'int', 'oint', 'dint', 'tint', 'qint']);

  // 한컴은 글자 묶음을 키워드 최장 일치로 쪼개 읽는다(pivot → π vot). 그런 묶음은 빈 그룹으로 끊는다.
  const KEYWORDS = Array.from(new Set(Object.values(CMD).concat(Object.values(ACCENT), [
    'over', 'atop', 'sqrt', 'root', 'of', 'from', 'to', 'in', 'it', 'rm', 'matrix', 'cases', 'LEFT', 'RIGHT',
  ]))).filter((k) => /^[A-Za-z]{2,}$/.test(k));
  const guardRun = (w) => (w.length > 1 && KEYWORDS.some((k) => w.includes(k)) ? w.split('').join('{}') : w);

  function convert(latex) {
    const toks = String(latex).match(/\\[A-Za-z]+\*?|\\.|[{}^_&\[\]]|\s+|[A-Za-z]+|[0-9.]+|[^\\{}^_&\[\]\sA-Za-z0-9.]/g) || [];
    let p = 0;
    const peek = () => toks[p];
    const skipWs = () => { while (p < toks.length && /^\s+$/.test(toks[p])) p++; };

    // 인자 하나: {..} 묶음 또는 토큰 하나
    function arg() {
      skipWs();
      if (peek() === '{') { p++; const s = seq('}'); p++; return s; }
      return atom();
    }
    function rawGroup() {
      skipWs();
      if (peek() !== '{') return toks[p++] || '';
      let depth = 0, out = '';
      for (; p < toks.length; p++) {
        if (toks[p] === '{' && depth++ === 0) continue;
        if (toks[p] === '}' && --depth === 0) { p++; break; }
        out += toks[p];
      }
      return out;
    }
    function optional() {
      skipWs();
      if (peek() !== '[') return null;
      p++;
      const s = seq(']');
      p++;
      return s;
    }
    function delim() {
      skipWs();
      const t = toks[p++] || '.';
      if (t === '.') return '';
      if (t === '\\{' || t === '\\lbrace') return '{';
      if (t === '\\}' || t === '\\rbrace') return '}';
      if (t.startsWith('\\')) return CMD[t.slice(1)] || t.slice(1);
      return t;
    }
    // 큰 연산자 뒤의 _ ^ → from … to …
    function limits(kw) {
      let lo = null, hi = null;
      for (;;) {
        skipWs();
        if (peek() === '_' && lo === null) { p++; lo = arg(); } else if (peek() === '^' && hi === null) { p++; hi = arg(); } else break;
      }
      if (kw === 'lim') return lo !== null ? `lim _{${lo}}` : 'lim';
      return kw + (lo !== null ? ` from {${lo}}` : '') + (hi !== null ? ` to {${hi}}` : '');
    }

    function atom() {
      const t = toks[p++];
      if (t === undefined) return '';
      if (/^\s+$/.test(t)) return ' ';
      if (t === '{') { const s = seq('}'); p++; return `{${s}}`; }
      if (t === '^' || t === '_') return `${t}{${arg()}}`;
      if (t === '&') return ' & ';
      if (t === '\\\\') return ' # ';
      if (/^[A-Za-z]+$/.test(t)) return guardRun(t);
      if (!t.startsWith('\\')) return t;
      const c = t.slice(1);
      if (c in SPACES) return ` ${SPACES[c]} `;
      if (c === '{' || c === '}') return `"${c}"`;
      if (c === '|') return ' VERT ';
      if (c === '%') return '%';
      if (IGNORE.has(c)) return c === 'left' || c === 'right' ? ` ${c.toUpperCase()} ${delim()} ` : '';
      if (c === 'frac' || c === 'dfrac' || c === 'tfrac') { const a = arg(), b = arg(); return ` {${a}} over {${b}} `; }
      if (c === 'binom') { const a = arg(), b = arg(); return ` {${a}} CHOOSE {${b}} `; }
      if (c === 'sqrt') {
        const n = optional();
        const x = arg();
        return n ? ` {}^{${n}} sqrt {${x}} ` : ` sqrt {${x}} `;
      }
      if (ACCENT[c]) return ` ${ACCENT[c]} {${arg()}} `;
      if (STRIP.has(c)) return `{${arg()}}`;
      if (TEXT.has(c)) return `"${rawGroup()}"`;
      if (c === 'begin') {
        const env = rawGroup();
        if (/^(array|alignat|alignedat)$/.test(env)) rawGroup(); // 열 지정 인자
        const body = seq('\\end');
        p++;
        rawGroup();
        // 여러 줄 수식(gathered·aligned)은 한글 수식에서 맨 바깥의 # 이 곧 줄바꿈
        if (/^(gathered|gather\*?|aligned|align\*?|split)$/.test(env)) return ` ${body} `;
        return ` ${ENV[env] || 'matrix'}{${body}} `;
      }
      if (BIG.has(CMD[c]) || c === 'lim') return ` ${limits(CMD[c])} `;
      if (c in CMD) return ` ${CMD[c]} `;
      return ` ${guardRun(c)} `; // 모르는 명령은 이름을 글자로
    }

    function seq(end) {
      let out = '';
      while (p < toks.length && toks[p] !== end) out += atom();
      return out;
    }

    return seq(null)
      .replace(/\s+/g, ' ')
      .replace(/\s*([\^_])\s*/g, '$1')
      .replace(/\{\s+/g, '{').replace(/\s+\}/g, '}')
      .trim();
  }

  return { convert };
});
