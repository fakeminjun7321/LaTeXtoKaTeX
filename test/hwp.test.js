'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { parse } = require('../src/text2latex');
const { convert } = require('../src/latex2hwp');

const render = (s) => katex.renderToString(s, { throwOnError: true, displayMode: true, output: 'html' });

// 한글(HWP) 수식, 영어 수, 여러 줄 입력 → LaTeX
const INPUT = [
  ['{a+b} over 2', '\\frac{a + b}{2}'],
  ['2 over l + 4 = 5', '\\frac{2}{l} + 4 = 5'],
  ['a + b over c', 'a + \\frac{b}{c}'],
  ['rm dx over rm dt', '\\frac{\\mathrm{d}x}{\\mathrm{d}t}'],
  ['sqrt {x^2 + 1}', '\\sqrt{x^2 + 1}'],
  ['root 3 of 8 = 2', '\\sqrt[3]{8} = 2'],
  ['sum from {i=1} to n i^2', '\\sum_{i = 1}^n i^2'],
  ['int from 0 to 1 x^2 dx', '\\int_0^1 x^2\\,dx'],
  ['lim from {x -> 0} {sin x} over x', '\\lim_{x \\to 0}\\frac{\\sin x}{x}'],
  ['LEFT ( {1} over {2} RIGHT )', '\\left( \\frac{1}{2} \\right)'],
  ['pmatrix{1 & 0 # 0 & 1}', '\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}'],
  ['f(x) = cases{x, & x >= 0 # -x, & x < 0}', 'f(x) = \\begin{cases} x, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}'],
  ['vec F = m vec a', '\\vec{F} = m\\vec{a}'],
  ['x bar = 3', '\\bar{x} = 3'],
  ['A CHOOSE B', '\\binom{A}{B}'],
  ['alpha TIMES beta APPROX 2 pi', '\\alpha \\times \\beta \\approx 2\\pi'],
  ['"kinetic energy" = 1 over 2 m v^2', '\\text{kinetic energy} = \\frac{1}{2}mv^2'],
  ['sigma dot x', '\\sigma \\cdot x'],
  ['a // b', 'a \\parallel b'],
  ['ten + twenty five = thirty five', '10 + 25 = 35'],
  ['E = mc^2\nF = ma', '\\begin{gathered} E = mc^2 \\\\ F = ma \\end{gathered}'],
  ['x^2 # y = 3', '\\begin{gathered} x^2 \\\\ y = 3 \\end{gathered}'],
  ['x 제곱 더하기 1\n\n2 over 3', '\\begin{gathered} x^2 + 1 \\\\ \\frac{2}{3} \\end{gathered}'],
];
for (const [input, expected] of INPUT) {
  test(`입력: ${JSON.stringify(input)}`, () => {
    const { latex } = parse(input);
    assert.equal(latex, expected);
    assert.doesNotThrow(() => render(latex));
  });
}

// LaTeX → 한글 수식 (Quilo 의 한컴 실측 규칙 반영)
const OUTPUT = [
  ['\\frac{a}{b}', '{a} over {b}'],
  ['\\sqrt[3]{8}', '{}^{3} sqrt {8}'],
  ['A \\Rightarrow B', 'A RARROW B'],
  ['\\sum_{i=1}^{n} i', 'sum from {i=1} to {n} i'],
  ['\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}', 'pmatrix{1 & 0 # 0 & 1}'],
  ['I_{\\text{pivot}}', 'I_{"pivot"}'],
  ['\\infty', 'INF'],
];
for (const [latex, hwp] of OUTPUT) {
  test(`한글 수식: ${latex}`, () => assert.equal(convert(latex), hwp));
}

// 한글 수식 → LaTeX → 한글 수식 → LaTeX 왕복 후에도 같은 그림
for (const h of ['{a+b} over 2', 'sum from {i=1} to n i^2', 'LEFT ( {1} over {2} RIGHT )', 'pmatrix{1 & 0 # 0 & 1}',
  'f(x) = cases{x, & x >= 0 # -x, & x < 0}', 'alpha TIMES beta APPROX 2 pi', 'A RARROW B', 'E = mc^2 # F = ma']) {
  test(`왕복: ${h}`, () => {
    const l1 = parse(h).latex;
    const l2 = parse(convert(l1)).latex;
    assert.equal(render(l2), render(l1));
  });
}
