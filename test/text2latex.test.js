'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const katex = require('katex');
const { parse } = require('../src/text2latex');

const CASES = [
  ['x^2 + 2x + 1', 'x^2 + 2x + 1'],
  ['(x+1)/(x-1)', '\\frac{x + 1}{x - 1}'],
  ['dy/dx', '\\frac{dy}{dx}'],
  ['x = (-b +- sqrt(b^2 - 4ac))/(2a)', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
  ['e^(i pi) + 1 = 0', 'e^{i\\pi} + 1 = 0'],
  ['|x - 1| <= 2', '\\left|x - 1\\right| \\le 2'],
  ['int_0^1 x^2 dx', '\\int_0^1 x^2\\,dx'],
  ['lim_(x->0) sin x / x', '\\lim_{x \\to 0}\\frac{\\sin x}{x}'],
  ['sum_(i=1)^n i = n(n+1)/2', '\\sum_{i = 1}^n i = \\frac{n(n + 1)}{2}'],
  ['x 제곱 더하기 2x 더하기 1', 'x^2 + 2x + 1'],
  ['2 분의 1', '\\frac{1}{2}'],
  ['루트 x 더하기 1', '\\sqrt{x} + 1'],
  ['2의 10제곱', '2^{10}'],
  ['x의 세제곱근', '\\sqrt[3]{x}'],
  ['시그마 i=1부터 n까지 i 제곱', '\\sum_{i = 1}^n i^2'],
  ['적분 0부터 1까지 x 제곱 dx', '\\int_0^1 x^2\\,dx'],
  ['극한 x가 0으로 갈 때 사인 x 나누기 x', '\\lim_{x \\to 0}\\frac{\\sin x}{x}'],
  ['x가 0으로 갈 때 극한 sin(x)/x', '\\lim_{x \\to 0} \\frac{\\sin(x)}{x}'],
  ['y는 x의 절댓값', 'y = \\left|x\\right|'],
  ['x는 3보다 크다', 'x > 3'],
  ['x는 3 이상', 'x \\ge 3'],
  ['a 제곱 더하기 b 제곱 은 c 제곱', 'a^2 + b^2 = c^2'],
  ['사인 제곱 세타 더하기 코사인 제곱 세타는 1', '\\sin^2\\theta + \\cos^2\\theta = 1'],
  ['알파 더하기 베타', '\\alpha + \\beta'],
  ['30도', '30^\\circ'],
];

for (const [input, expected] of CASES) {
  test(input, () => {
    const { latex } = parse(input);
    assert.equal(latex, expected);
    assert.doesNotThrow(() => katex.renderToString(latex, { throwOnError: true }));
  });
}
