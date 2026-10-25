#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { convert, check } = require('./src/latex2katex');

const HELP = `사용법: latex2katex [입력.tex] [옵션]
입력 파일을 생략하면 표준입력에서 읽습니다.

옵션:
  -o, --output <파일>     결과를 파일로 저장 (기본: 표준출력)
  --brackets              \\( \\) / \\[ \\] 구분자 사용 (기본: $ / $$)
  --no-expand             매크로를 펼치지 않고 KaTeX macros 객체로 내보냄
  --macros <파일>         KaTeX macros 객체를 JSON 파일로 저장 (--no-expand 와 함께)
  --keep-envs             equation/align/gather 등을 KaTeX 지원 형태 그대로 유지
  --keep-preamble         \\begin{document} 이전 부분 유지
  --check                 변환된 모든 수식을 KaTeX로 렌더링해 오류 보고
  -h, --help              도움말`;

function parseArgs(argv) {
  const a = { options: {} };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    switch (v) {
      case '-h': case '--help': a.help = true; break;
      case '-o': case '--output': a.output = argv[++i]; break;
      case '--macros': a.macros = argv[++i]; break;
      case '--brackets': a.options.delimiters = 'brackets'; break;
      case '--no-expand': a.options.expandMacros = false; break;
      case '--keep-envs': a.options.keepEnvironments = true; break;
      case '--keep-preamble': a.options.keepPreamble = true; break;
      case '--check': a.check = true; break;
      default:
        if (v.startsWith('-')) { console.error(`알 수 없는 옵션: ${v}\n\n${HELP}`); process.exit(2); }
        a.input = v;
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }

const source = fs.readFileSync(args.input ?? 0, 'utf8');
const result = convert(source, args.options);

if (args.output) fs.writeFileSync(args.output, result.output);
else process.stdout.write(result.output);

if (args.macros) fs.writeFileSync(args.macros, JSON.stringify(result.macros, null, 2) + '\n');
else if (Object.keys(result.macros).length) {
  console.error(`\n[알림] KaTeX macros 옵션에 넣어야 할 매크로 ${Object.keys(result.macros).length}개가 있습니다 (--macros 로 저장 가능).`);
}

for (const w of result.warnings) console.error(`[경고] ${w}`);

if (args.check) {
  const katex = require('katex');
  require('katex/contrib/mhchem');
  const errors = check(result, katex);
  for (const e of errors) console.error(`[KaTeX 오류] 출력 ${e.line}행: ${e.message}`);
  console.error(errors.length ? `\n✗ 수식 ${result.math.length}개 중 ${errors.length}개 렌더링 실패` : `\n✓ 수식 ${result.math.length}개 모두 KaTeX 렌더링 성공`);
  if (errors.length) process.exit(1);
}
