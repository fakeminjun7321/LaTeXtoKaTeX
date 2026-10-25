'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const katex = require('katex');
require('katex/contrib/mhchem');
const { convert, check } = require('../src/latex2katex');

const out = (src, opts) => convert(src, opts).output.trim();

test('인라인/디스플레이 구분자 정규화', () => {
  assert.equal(out('a \\(x\\) b'), 'a $x$ b');
  assert.equal(out('\\[x\\]'), '$$\nx\n$$');
  assert.equal(out('$x$', { delimiters: 'brackets' }), '\\(x\\)');
  assert.equal(out('$$x$$', { delimiters: 'brackets' }), '\\[\nx\n\\]');
});

test('이스케이프된 달러와 \\\\[ 줄바꿈은 수식이 아님', () => {
  assert.equal(out('가격 \\$5 와 \\$6'), '가격 \\$5 와 \\$6');
  assert.equal(out('a\\\\[2pt] b'), 'a\\\\[2pt] b');
});

test('\\text 안의 $ 는 인라인 수식을 끝내지 않음', () => {
  assert.equal(out('$\\text{if $x$}$'), '$\\text{if $x$}$');
});

test('주석 제거', () => {
  assert.equal(out('a % c\nb\n% 전체 줄\nc'), 'a\nb\nc');
  assert.equal(out('50\\% 할인'), '50\\% 할인');
});

test('매크로 확장: 인자, 선택 인자, \\def, DeclareMathOperator', () => {
  const src = [
    '\\newcommand{\\R}{\\mathbb{R}}',
    '\\newcommand\\abs[1]{\\left|#1\\right|}',
    '\\newcommand{\\pow}[2][2]{#2^{#1}}',
    '\\def\\v#1{\\mathbf{#1}}',
    '\\DeclareMathOperator*{\\argmin}{arg\\,min}',
    '$\\R \\abs{x} \\pow{a} \\pow[3]{b} \\v v \\argmin_x$',
  ].join('\n');
  assert.equal(out(src), '$\\mathbb{R} \\left|x\\right| a^{2} b^{3} \\mathbf{v} \\operatorname*{arg\\,min}_x$');
});

test('--no-expand 이면 KaTeX macros 로 내보냄', () => {
  const r = convert('\\newcommand{\\R}{\\mathbb{R}}\n$\\R$', { expandMacros: false });
  assert.equal(r.output.trim(), '$\\R$');
  assert.deepEqual(r.macros, { '\\R': '\\mathbb{R}' });
  assert.deepEqual(check(r, katex), []);
});

test('align → aligned, label 제거', () => {
  assert.equal(
    out('\\begin{align}a &= b \\label{x}\\\\ c &= d\\end{align}'),
    '$$\n\\begin{aligned}a &= b \\\\ c &= d\\end{aligned}\n$$',
  );
});

test('keepEnvironments 이면 align 유지', () => {
  assert.equal(out('\\begin{align*}a&=b\\end{align*}', { keepEnvironments: true }), '$$\n\\begin{align*}a&=b\\end{align*}\n$$');
});

test('eqnarray 의 &=& 를 &= 로', () => {
  assert.equal(out('\\begin{eqnarray}a&=&b\\\\&\\le&c\\end{eqnarray}'), '$$\n\\begin{aligned}a&=b\\\\&\\le c\\end{aligned}\n$$');
});

test('eqnarray 안의 행렬 & 는 건드리지 않음', () => {
  const r = out('\\begin{eqnarray*}A&=&\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\end{eqnarray*}');
  assert.match(r, /A&=\\begin\{pmatrix\}1&2\\\\3&4\\end\{pmatrix\}/);
});

test('\\tag 는 aligned 밖으로 이동', () => {
  assert.equal(out('\\begin{gather}a\\tag{1}\\end{gather}'), '$$\n\\begin{gathered}a\\end{gathered} \\tag{1}\n$$');
});

test('미지원 명령 치환', () => {
  assert.equal(out('$\\mbox{a} \\mathbbm{1} \\ensuremath{x} \\upmu \\hdots$'), '$\\text{a} \\mathbb{1} x \\mu \\ldots$');
  assert.equal(out('$\\SI{9.8}{\\meter\\per\\second\\squared}$'), '$9.8\\,\\mathrm{m/s^{2}}$');
  assert.equal(out('$\\sin x$'), '$\\sin x$'); // \si 의 접두어로 오인하지 않음
});

test('verbatim / \\verb 안은 그대로', () => {
  assert.equal(out('\\verb|$x$| \\begin{verbatim}\n$y$ % no\n\\end{verbatim}'), '\\verb|$x$| \\begin{verbatim}\n$y$ % no\n\\end{verbatim}');
});

test('문서 프리앰블 제거', () => {
  assert.equal(out('\\documentclass{article}\n\\begin{document}\nhi $x$\n\\end{document}'), 'hi $x$');
});

test('예제 문서의 모든 수식이 KaTeX 로 렌더링됨', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'examples', 'sample.tex'), 'utf8');
  for (const keepEnvironments of [false, true]) {
    const r = convert(src, { keepEnvironments });
    assert.ok(r.math.length >= 8);
    assert.deepEqual(check(r, katex), []);
  }
});
