/*
 * latex2katex — LaTeX 문서/수식을 KaTeX에서 렌더링 가능한 형태로 변환한다.
 * 브라우저(<script>)와 Node(require) 양쪽에서 사용할 수 있는 UMD 모듈.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LatexToKatex = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MATH_ENVS = new Set([
    'equation', 'equation*', 'align', 'align*', 'flalign', 'flalign*',
    'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
    'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*',
  ]);
  const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment']);

  const GREEK = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega';

  const SI_UNITS = {
    meter: 'm', metre: 'm', second: 's', gram: 'g', kilogram: 'kg', ampere: 'A', kelvin: 'K',
    mole: 'mol', candela: 'cd', newton: 'N', joule: 'J', watt: 'W', volt: 'V', ohm: '\\Omega',
    coulomb: 'C', hertz: 'Hz', pascal: 'Pa', liter: 'L', litre: 'L', tesla: 'T', farad: 'F',
    henry: 'H', weber: 'Wb', siemens: 'S', becquerel: 'Bq', gray: 'Gy', sievert: 'Sv',
    electronvolt: 'eV', minute: 'min', hour: 'h', day: 'd', degree: '^\\circ',
    celsius: '{}^\\circ\\mathrm{C}', percent: '\\%',
    kilo: 'k', mega: 'M', giga: 'G', tera: 'T', centi: 'c', milli: 'm', micro: '\\mu',
    nano: 'n', pico: 'p', femto: 'f', deci: 'd',
    squared: '^{2}', cubed: '^{3}', per: '/',
  };

  // ───────────────────────── 저수준 파서 유틸 ─────────────────────────

  const isLetter = (c) => c !== undefined && /[A-Za-z@]/.test(c);

  function skipSpaces(src, i) {
    while (i < src.length && /\s/.test(src[i])) i++;
    return i;
  }

  // src[i] === '{' 인 균형 잡힌 그룹을 읽는다.
  function readGroup(src, i) {
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return { content: src.slice(i + 1, j), end: j + 1 };
    }
    return null;
  }

  // src[i] === '[' 인 선택 인자를 읽는다(중괄호 안의 ']'는 무시).
  function readOptional(src, i) {
    let depth = 0;
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === ']' && depth === 0) return { content: src.slice(i + 1, j), end: j + 1 };
    }
    return null;
  }

  // 단일 토큰: 제어 시퀀스(\foo, \,) 또는 문자 하나.
  function readToken(src, i) {
    if (src[i] === '\\') {
      let j = i + 1;
      if (isLetter(src[j])) { while (isLetter(src[j])) j++; } else j++;
      return { content: src.slice(i, j), end: j };
    }
    return { content: src[i] || '', end: i + 1 };
  }

  function readArg(src, i) {
    i = skipSpaces(src, i);
    if (src[i] === '{') return readGroup(src, i);
    if (i >= src.length) return null;
    return readToken(src, i);
  }

  function lineOf(src, pos) {
    let n = 1;
    for (let k = 0; k < pos && k < src.length; k++) if (src[k] === '\n') n++;
    return n;
  }

  // \verb|..| 이나 verbatim 류 환경이면 끝 위치를 돌려준다.
  function matchVerbatim(src, i) {
    if (src.startsWith('\\verb', i) && !isLetter(src[i + 5])) {
      let j = i + 5;
      if (src[j] === '*') j++;
      const delim = src[j];
      if (!delim || /\s/.test(delim)) return null;
      const close = src.indexOf(delim, j + 1);
      return close === -1 ? null : { end: close + 1, drop: false };
    }
    if (src.startsWith('\\begin{', i)) {
      const g = readGroup(src, i + 6);
      if (g && VERBATIM_ENVS.has(g.content)) {
        const endTag = '\\end{' + g.content + '}';
        const close = src.indexOf(endTag, g.end);
        const end = close === -1 ? src.length : close + endTag.length;
        return { end, drop: g.content === 'comment' };
      }
    }
    return null;
  }

  function findEnvEnd(src, from, name) {
    const b = '\\begin{' + name + '}', e = '\\end{' + name + '}';
    let depth = 1, j = from;
    while (j < src.length) {
      const nb = src.indexOf(b, j), ne = src.indexOf(e, j);
      if (ne === -1) return -1;
      if (nb !== -1 && nb < ne) { depth++; j = nb + b.length; }
      else { if (--depth === 0) return ne; j = ne + e.length; }
    }
    return -1;
  }

  // 수식 닫는 구분자를 찾는다. 중괄호 안($\text{$x$}$ 등)의 구분자는 건너뛴다.
  function findMathEnd(src, from, closer) {
    let depth = 0;
    for (let j = from; j < src.length; j++) {
      const c = src[j];
      if (depth === 0 && src.startsWith(closer, j)) return j;
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
    }
    return -1;
  }

  // 중괄호·중첩 환경 밖에 있는 구분자로만 자른다.
  function splitTopLevel(src, sep) {
    const parts = [];
    let depth = 0, envDepth = 0, last = 0;
    for (let j = 0; j < src.length; j++) {
      const c = src[j];
      if (depth === 0 && envDepth === 0 && src.startsWith(sep, j)) {
        parts.push(src.slice(last, j));
        j += sep.length - 1;
        last = j + 1;
        continue;
      }
      if (c === '\\') {
        if (src.startsWith('\\begin{', j)) envDepth++;
        else if (src.startsWith('\\end{', j)) envDepth--;
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    parts.push(src.slice(last));
    return parts;
  }

  // ───────────────────────── 전처리 ─────────────────────────

  function stripComments(src) {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        const v = matchVerbatim(src, i);
        if (v) {
          if (!v.drop) out += src.slice(i, v.end);
          i = v.end;
          continue;
        }
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '%') {
        let j = src.indexOf('\n', i);
        if (j === -1) j = src.length;
        // 주석만 있는 줄은 줄 전체를 지우고, 줄 끝 주석은 주석 부분만 지운다
        const lineStart = out.lastIndexOf('\n') + 1;
        if (/^[ \t]*$/.test(out.slice(lineStart))) { out = out.slice(0, lineStart); j++; }
        else out = out.replace(/[ \t]+$/, '');
        i = j;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function splitDocument(src) {
    const b = src.indexOf('\\begin{document}');
    if (b === -1) return { preamble: '', body: src, isDocument: false };
    const e = src.indexOf('\\end{document}', b);
    return {
      preamble: src.slice(0, b),
      body: src.slice(b + '\\begin{document}'.length, e === -1 ? src.length : e),
      isDocument: true,
    };
  }

  // \newcommand, \renewcommand, \def, \let, \DeclareMathOperator 등을 수집하고 원문에서 제거한다.
  function extractMacros(src, macros, warnings) {
    const re = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|def|gdef|let)(?![A-Za-z@])(\*?)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      const start = m.index;
      if (start > 0 && src[start - 1] === '\\') continue;
      const kind = m[1], star = m[2] === '*';
      let i = skipSpaces(src, re.lastIndex);
      let name, def = null;

      if (kind === 'def' || kind === 'gdef') {
        const tok = readToken(src, i);
        name = tok.content;
        i = tok.end;
        const brace = src.indexOf('{', i);
        if (brace === -1) continue;
        const params = src.slice(i, brace);
        const g = readGroup(src, brace);
        if (!g) continue;
        const nums = params.match(/#\d/g) || [];
        if (/[^#\d\s]/.test(params)) warnings.push(`\\def${name}: 구분자가 있는 매개변수는 지원하지 않아 단순 인자로 처리합니다.`);
        def = { nargs: nums.length, body: g.content, end: g.end };
      } else if (kind === 'let') {
        const a = readToken(src, i);
        let j = skipSpaces(src, a.end);
        if (src[j] === '=') j = skipSpaces(src, j + 1);
        const b = readToken(src, j);
        name = a.content;
        def = { nargs: 0, body: b.content, end: b.end };
      } else {
        const n = src[i] === '{' ? readGroup(src, i) : readToken(src, i);
        if (!n) continue;
        name = n.content.trim();
        i = skipSpaces(src, n.end);
        if (kind === 'DeclareMathOperator') {
          const g = readArg(src, i);
          if (!g) continue;
          def = { nargs: 0, body: `\\operatorname${star ? '*' : ''}{${g.content}}`, end: g.end };
        } else {
          let nargs = 0, defaultArg;
          if (src[i] === '[') {
            const o = readOptional(src, i);
            nargs = parseInt(o.content, 10) || 0;
            i = skipSpaces(src, o.end);
            if (src[i] === '[') {
              const d = readOptional(src, i);
              defaultArg = d.content;
              i = skipSpaces(src, d.end);
            }
          }
          const g = readArg(src, i);
          if (!g) continue;
          def = { nargs, defaultArg, body: g.content, end: g.end };
        }
      }

      if (!name || !name.startsWith('\\')) continue;
      const key = name.slice(1);
      if (kind === 'providecommand' && macros[key]) { /* 이미 정의됨 */ }
      else macros[key] = { nargs: def.nargs, defaultArg: def.defaultArg, body: def.body };
      out += src.slice(last, start);
      last = def.end;
      re.lastIndex = def.end;
    }
    return out + src.slice(last);
  }

  function expandMacros(src, macros, depth = 0) {
    if (depth > 50) throw new Error('매크로 확장 깊이 초과(재귀 정의가 있는지 확인하세요)');
    let out = '', i = 0;
    while (i < src.length) {
      if (src[i] !== '\\') { out += src[i++]; continue; }
      const v = matchVerbatim(src, i);
      if (v) { out += src.slice(i, v.end); i = v.end; continue; }
      const tok = readToken(src, i);
      const key = tok.content.slice(1);
      const mac = Object.prototype.hasOwnProperty.call(macros, key) ? macros[key] : null;
      if (!mac) { out += tok.content; i = tok.end; continue; }

      let j = tok.end;
      const args = [];
      let argStart = 0;
      if (mac.defaultArg !== undefined) {
        const k = skipSpaces(src, j);
        if (src[k] === '[') {
          const o = readOptional(src, k);
          args.push(o.content);
          j = o.end;
        } else args.push(mac.defaultArg);
        argStart = 1;
      }
      for (let n = argStart; n < mac.nargs; n++) {
        const a = readArg(src, j);
        if (!a) break;
        args.push(a.content);
        j = a.end;
      }
      const replaced = mac.body.replace(/(\\[A-Za-z]+)?#(\d)/g, (_, cs, d) => {
        const arg = args[d - 1] ?? '';
        return cs ? cs + (/^[A-Za-z]/.test(arg) ? ' ' : '') + arg : arg;
      });
      out += expandMacros(replaced, macros, depth + 1);
      i = j;
    }
    return out;
  }

  // ───────────────────────── 수식 분리 ─────────────────────────

  function splitSegments(src, warnings) {
    const segs = [];
    let text = '', i = 0;
    const pushText = () => { if (text) segs.push({ type: 'text', value: text }); text = ''; };
    const pushMath = (display, body, env, pos) => { pushText(); segs.push({ type: 'math', display, body, env, pos }); };
    const unclosed = (what, pos) => warnings.push(`${lineOf(src, pos)}행: 닫히지 않은 ${what} — 텍스트로 둡니다.`);

    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        const v = matchVerbatim(src, i);
        if (v) { text += src.slice(i, v.end); i = v.end; continue; }
        const n = src[i + 1];
        if (n === '(' || n === '[') {
          const closer = n === '(' ? '\\)' : '\\]';
          const e = findMathEnd(src, i + 2, closer);
          if (e === -1) { unclosed(n === '(' ? '\\(' : '\\[', i); text += src.slice(i, i + 2); i += 2; continue; }
          pushMath(n === '[', src.slice(i + 2, e), null, i);
          i = e + 2;
          continue;
        }
        if (src.startsWith('\\begin{', i)) {
          const g = readGroup(src, i + 6);
          if (g && MATH_ENVS.has(g.content)) {
            const e = findEnvEnd(src, g.end, g.content);
            if (e === -1) { unclosed(`\\begin{${g.content}}`, i); text += src.slice(i, g.end); i = g.end; continue; }
            const endLen = ('\\end{' + g.content + '}').length;
            pushMath(g.content !== 'math', src.slice(i, e + endLen), g.content, i);
            i = e + endLen;
            continue;
          }
        }
        text += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '$') {
        const display = src[i + 1] === '$';
        const open = display ? 2 : 1;
        const e = findMathEnd(src, i + open, display ? '$$' : '$');
        if (e === -1) { unclosed(display ? '$$' : '$', i); text += src.slice(i, i + open); i += open; continue; }
        pushMath(display, src.slice(i + open, e), null, i);
        i = e + open;
        continue;
      }
      text += c;
      i++;
    }
    pushText();
    return segs;
  }

  // ───────────────────────── 수식 변환 ─────────────────────────

  function transformEnv(src, name, fn) {
    const b = '\\begin{' + name + '}', e = '\\end{' + name + '}';
    let from = 0;
    for (;;) {
      const start = src.indexOf(b, from);
      if (start === -1) return src;
      const after = start + b.length;
      const end = findEnvEnd(src, after, name);
      if (end === -1) return src;
      const inner = transformEnv(src.slice(after, end), name, fn);
      const rep = fn(inner);
      src = src.slice(0, start) + rep + src.slice(end + e.length);
      from = start + rep.length;
    }
  }

  // aligned 류 안에서는 \tag 를 쓸 수 없으므로 환경 밖으로 꺼낸다.
  function wrapWithTags(env, inner, warnings) {
    const tags = [];
    inner = replaceCommand(inner, 'tag', { args: 1, star: true }, (a, _o, star) => {
      tags.push(`\\tag${star ? '*' : ''}{${a[0]}}`);
      return '';
    });
    if (tags.length > 1) warnings.push(`여러 줄 수식의 \\tag 가 ${tags.length}개 있습니다. KaTeX는 수식당 하나만 지원하므로 첫 번째(${tags[0]})만 남깁니다.`);
    return `\\begin{${env}}${inner}\\end{${env}}` + (tags.length ? ' ' + tags[0] : '');
  }

  function fixEqnarray(inner) {
    return splitTopLevel(inner, '\\\\').map((row) => {
      const cells = splitTopLevel(row, '&');
      if (cells.length < 3) return row;
      const rest = cells.slice(2).join('&');
      // "&\le&c" 를 합칠 때 "\lec" 가 되지 않도록
      const gap = /\\[A-Za-z]+$/.test(cells[1]) && /^[A-Za-z]/.test(rest) ? ' ' : '';
      return cells[0] + '&' + cells[1] + gap + rest;
    }).join('\\\\');
  }

  function mapEnvironments(body, opts, warnings) {
    const keep = opts.keepEnvironments;
    const strip = (inner) => inner;
    const toEnv = (env) => (inner) => wrapWithTags(env, inner, warnings);
    const rules = [
      ['displaymath', strip], ['math', strip], ['dmath', strip], ['dmath*', strip],
      ['split', toEnv('aligned')],
      ['eqnarray', (x) => wrapWithTags('aligned', fixEqnarray(x), warnings)],
      ['eqnarray*', (x) => wrapWithTags('aligned', fixEqnarray(x), warnings)],
      ['multline', toEnv('gathered')], ['multline*', toEnv('gathered')],
    ];
    if (!keep) {
      rules.push(
        ['equation', strip], ['equation*', strip],
        ['align', toEnv('aligned')], ['align*', toEnv('aligned')],
        ['flalign', toEnv('aligned')], ['flalign*', toEnv('aligned')],
        ['gather', toEnv('gathered')], ['gather*', toEnv('gathered')],
        ['alignat', toEnv('alignedat')], ['alignat*', toEnv('alignedat')],
      );
    }
    for (const [name, fn] of rules) body = transformEnv(body, name, fn);
    return body;
  }

  // \name 을 찾아 인자를 읽고 fn(args, optional, starred) 의 결과로 바꾼다.
  function replaceCommand(src, name, spec, fn) {
    const needle = '\\' + name;
    let from = 0;
    for (;;) {
      const start = src.indexOf(needle, from);
      if (start === -1) return src;
      let j = start + needle.length;
      let bs = 0;
      while (src[start - 1 - bs] === '\\') bs++;
      // 다른 명령의 접두어(\reff 등)거나 \\name 처럼 앞의 백슬래시에 먹힌 경우는 건너뜀
      if (isLetter(src[j]) || bs % 2 === 1 || (spec.braced && src[skipSpaces(src, j)] !== '{' && src[skipSpaces(src, j)] !== '[')) {
        from = start + 1;
        continue;
      }
      let star = false, opt;
      if (spec.star && src[j] === '*') { star = true; j++; }
      if (spec.optional) {
        const k = skipSpaces(src, j);
        if (src[k] === '[') { const o = readOptional(src, k); if (o) { opt = o.content; j = o.end; } }
      }
      const args = [];
      let ok = true;
      for (let n = 0; n < (spec.args || 0); n++) {
        const a = readArg(src, j);
        if (!a) { ok = false; break; }
        args.push(a.content);
        j = a.end;
      }
      if (!ok) { from = start + 1; continue; }
      let rep = fn(args, opt, star);
      // 인자 없는 명령을 지울 때 뒤따르는 공백까지 함께 정리
      if (!spec.args && rep === '') j = skipSpacesInline(src, j);
      src = src.slice(0, start) + rep + src.slice(j);
      from = start;
    }
  }

  function skipSpacesInline(src, i) {
    while (src[i] === ' ' || src[i] === '\t') i++;
    return i;
  }

  function siUnits(s) {
    return s
      .replace(/\\([A-Za-z]+)/g, (m, n) => (n in SI_UNITS ? SI_UNITS[n] : m))
      .replace(/[.~]/g, '\\,')
      .replace(/\s+/g, '');
  }

  const text = (a) => `\\text{${a[0]}}`;
  const remove = () => '';
  const COMMAND_RULES = [
    ['mbox', { args: 1 }, text],
    ['makebox', { args: 1, optional: true }, text],
    ['textsc', { args: 1 }, text],
    ['textsl', { args: 1 }, (a) => `\\textit{${a[0]}}`],
    ['mathbbm', { args: 1 }, (a) => `\\mathbb{${a[0]}}`],
    ['mathds', { args: 1 }, (a) => `\\mathbb{${a[0]}}`],
    ['ensuremath', { args: 1 }, (a) => a[0]],
    ['lefteqn', { args: 1 }, (a) => a[0]],
    ['shoveleft', { args: 1 }, (a) => a[0]],
    ['shoveright', { args: 1 }, (a) => a[0]],
    ['intertext', { args: 1 }, (a) => `\\text{${a[0]}}\\\\`],
    ['shortintertext', { args: 1 }, (a) => `\\text{${a[0]}}\\\\`],
    ['label', { args: 1 }, remove],
    ['vspace', { args: 1, star: true }, remove],
    ['protect', {}, remove],
    ['displaybreak', { optional: true }, remove],
    ['allowdisplaybreaks', { optional: true }, remove],
    ['noindent', {}, remove],
    ['centering', {}, remove],
    ['linebreak', { optional: true }, remove],
    ['nolinebreak', { optional: true }, remove],
    ['hfill', {}, () => '\\qquad'],
    ['hdots', {}, () => '\\ldots'],
    ['textdegree', {}, () => '^\\circ'],
    ['sfrac', { args: 2 }, (a) => `{}^{${a[0]}}\\!/{}_{${a[1]}}`],
    ['nicefrac', { args: 2 }, (a) => `{}^{${a[0]}}\\!/{}_{${a[1]}}`],
    ['eqref', { args: 1 }, (a) => `\\text{(${a[0]})}`],
    ['ref', { args: 1 }, (a) => `\\text{${a[0]}}`],
    ['si', { braced: true, args: 1, optional: true }, (a) => `\\mathrm{${siUnits(a[0])}}`],
    ['unit', { braced: true, args: 1, optional: true }, (a) => `\\mathrm{${siUnits(a[0])}}`],
    ['SI', { braced: true, args: 2, optional: true }, (a) => `${a[0]}\\,\\mathrm{${siUnits(a[1])}}`],
    ['qty', { braced: true, args: 2, optional: true }, (a) => `${a[0]}\\,\\mathrm{${siUnits(a[1])}}`],
    ['num', { braced: true, args: 1, optional: true }, (a) => a[0]],
    ['ang', { braced: true, args: 1, optional: true }, (a) => `${a[0]}^\\circ`],
  ];

  function convertMathBody(body, opts, warnings) {
    body = mapEnvironments(body, opts, warnings);
    for (const [name, spec, fn] of COMMAND_RULES) {
      if (body.includes('\\' + name)) {
        if (name === 'ref' || name === 'eqref') warnings.push(`\\${name}: KaTeX는 상호 참조를 지원하지 않아 라벨 텍스트로 바꿉니다.`);
        body = replaceCommand(body, name, spec, fn);
      }
    }
    body = body.replace(new RegExp(`\\\\up(${GREEK})(?![A-Za-z])`, 'g'), '\\$1');
    // 마크다운 등에서 빈 줄은 수식을 끊으므로 제거
    body = body.replace(/\n[ \t]*(?=\n)/g, '').replace(/\n{2,}/g, '\n');
    return body.trim();
  }

  function convertText(t) {
    return t
      .replace(/\\(begin|end)\{subequations\}[ \t]*\n?/g, '')
      .replace(/\\label\{[^{}]*\}/g, '');
  }

  // ───────────────────────── 공개 API ─────────────────────────

  const DEFAULTS = {
    delimiters: 'dollars',      // 'dollars' → $..$ / $$..$$, 'brackets' → \(..\) / \[..\]
    expandMacros: true,         // false 면 매크로를 KaTeX macros 옵션용 객체로 내보냄
    keepPreamble: false,        // \begin{document} 이전 부분 유지 여부
    keepEnvironments: false,    // true 면 equation/align/gather 등을 KaTeX 지원 형태 그대로 유지
    displayOnOwnLine: true,     // 디스플레이 수식을 별도 줄에 배치
  };

  function convert(input, options) {
    const opts = Object.assign({}, DEFAULTS, options);
    const warnings = [];
    const macros = {};

    let src = stripComments(String(input).replace(/\r\n?/g, '\n'));
    const doc = splitDocument(src);
    const preamble = extractMacros(doc.preamble, macros, warnings);
    let body = extractMacros(doc.body, macros, warnings);

    const katexMacros = {};
    if (opts.expandMacros) {
      body = expandMacros(body, macros);
    } else {
      const forced = {};
      for (const [k, m] of Object.entries(macros)) {
        if (m.defaultArg !== undefined) forced[k] = m; // KaTeX macros는 선택 인자를 지원하지 않음
        else katexMacros['\\' + k] = m.body;
      }
      body = expandMacros(body, forced);
    }

    const segs = splitSegments(body, warnings);
    const [il, ir, dl, dr] = opts.delimiters === 'brackets' ? ['\\(', '\\)', '\\[', '\\]'] : ['$', '$', '$$', '$$'];

    let out = opts.keepPreamble && doc.isDocument ? preamble + '\\begin{document}' : '';
    const math = [];
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (s.type === 'text') { out += convertText(s.value); continue; }
      const segWarnings = [];
      const tex = convertMathBody(s.body, opts, segWarnings);
      for (const w of segWarnings) warnings.push(`${lineOf(body, s.pos)}행: ${w}`);
      if (!s.display) {
        math.push({ display: false, tex, line: lineOf(out, out.length) });
        out += il + tex + ir;
        continue;
      }
      if (opts.displayOnOwnLine) {
        out = out.replace(/[ \t]+$/, '');
        if (out && !out.endsWith('\n')) out += '\n';
      }
      math.push({ display: true, tex, line: lineOf(out, out.length) });
      out += `${dl}\n${tex}\n${dr}`;
      if (opts.displayOnOwnLine) {
        const next = segs[k + 1];
        if (next && next.type === 'text') next.value = next.value.replace(/^[ \t]+/, '');
        if (next && !(next.type === 'text' && next.value.startsWith('\n'))) out += '\n';
      }
    }
    if (opts.keepPreamble && doc.isDocument) out += '\\end{document}\n';
    else out = out.replace(/^\s*\n/, '').replace(/\s+$/, '\n');

    return { output: out, macros: katexMacros, warnings, math };
  }

  // KaTeX 로 실제 렌더링해 보고 실패한 수식 목록을 돌려준다.
  function check(result, katex) {
    const errors = [];
    for (const m of result.math) {
      try {
        katex.renderToString(m.tex, {
          displayMode: m.display, throwOnError: true, strict: 'ignore',
          macros: Object.assign({}, result.macros),
        });
      } catch (e) {
        errors.push({ line: m.line, tex: m.tex, message: e.message });
      }
    }
    return errors;
  }

  return { convert, check, DEFAULTS, _internal: { stripComments, extractMacros, expandMacros, splitSegments, fixEqnarray } };
});
