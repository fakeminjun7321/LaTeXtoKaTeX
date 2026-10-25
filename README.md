# LaTeX → KaTeX 변환기

LaTeX 문서나 수식을 KaTeX에서 바로 렌더링되는 형태(`$…$`, `$$…$$`)로 바꿔 주는 도구입니다.
웹 화면에는 세 가지 탭이 있습니다. 모두 AI 없이 규칙과 고전 알고리즘으로만 동작합니다.

| 탭 | 하는 일 | 코드 |
| --- | --- | --- |
| LaTeX 변환 | LaTeX 문서 → KaTeX 호환 형태 (CLI도 있음) | `src/latex2katex.js` |
| 이미지 → LaTeX | 수식 이미지(스크린샷 등)를 읽어 LaTeX로 | `src/ocr.js` |
| 말로 → LaTeX | "x 제곱 더하기 1", `sqrt(x)/2` 같은 설명을 LaTeX로 | `src/text2latex.js` |

## 이미지 → LaTeX 동작 방식

1. **이진화** — Otsu 방법으로 흑백 변환(어두운 배경도 자동 반전), 글자 높이가 약 48px가 되도록 크기 조정
2. **연결 요소 분석** — 잉크 덩어리를 찾고, `i`·`j`의 점, `=`, `≤`, `÷`, `:` 처럼 여러 조각인 기호를 합침. 작은 글씨에서 붙어 버린 글자는 가장 얇은 세로선에서 잘라 봄
3. **글자 인식** — KaTeX·Times·Arial 글꼴로 직접 그린 기준 글자(약 400개)와 32×32로 정규화해 **챔퍼 거리**로 비교
4. **구조 복원** — 위치 관계로 분수(가로줄 위아래), 루트(√ 기호 안쪽), 위/아래첨자(기준선 높이와 글자 크기), ∑·∏·lim의 위아래 첨자, `sin`·`log` 같은 함수 이름을 복원

`test/ocr.html`을 로컬 서버로 열면 KaTeX로 그린 39개 수식을 18·32·56px 크기로 인식해 봅니다(현재 111개 중 110개 정확히 일치).
**한계:** 인쇄된(화면에 렌더링된) 수식용입니다. 손글씨, 행렬·여러 줄 수식, 처음 보는 장식 글꼴, 아주 작은 글씨는 잘 못 읽습니다. 결과는 화면에서 바로 고칠 수 있습니다.

## 말로 → LaTeX 예시

| 입력 | 결과 |
| --- | --- |
| `x 제곱 더하기 2x 더하기 1` | `x^2 + 2x + 1` |
| `2 분의 1` | `\frac{1}{2}` |
| `시그마 k=1부터 n까지 k 제곱` | `\sum_{k = 1}^n k^2` |
| `극한 x가 0으로 갈 때 사인 x 나누기 x` | `\lim_{x \to 0}\frac{\sin x}{x}` |
| `x는 3보다 크다` | `x > 3` |
| `x = (-b +- sqrt(b^2-4ac))/(2a)` | `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` |

한국어 단어 사전(제곱, 분의, 루트, 적분, 절댓값, 이상/이하, 그리스 문자 이름 …)으로 토큰을 만든 뒤 재귀 하강 파서로 수식 구조를 만듭니다.

## 사용법

### 웹 화면
`index.html`을 브라우저로 열면 됩니다(인터넷 연결 필요: KaTeX를 CDN에서 불러옴).
이미지 탭에서는 이미지를 끌어다 놓거나 ⌘V/Ctrl+V로 붙여넣으면 됩니다.
파일로 열 때 문제가 있으면 로컬 서버로 여세요:
```bash
python3 -m http.server 8765
```

### 명령줄
```bash
npm install
node cli.js examples/sample.tex --check
node cli.js 입력.tex -o 출력.md
cat 입력.tex | node cli.js --brackets
```

| 옵션 | 설명 |
| --- | --- |
| `-o, --output <파일>` | 결과를 파일로 저장 |
| `--brackets` | `\( \)` / `\[ \]` 구분자 사용 (기본은 `$` / `$$`) |
| `--no-expand` | 사용자 매크로를 펼치지 않고 KaTeX `macros` 객체로 내보냄 (`--macros 파일.json`) |
| `--keep-envs` | `equation`/`align`/`gather` 등 KaTeX가 지원하는 환경을 그대로 유지 |
| `--keep-preamble` | `\begin{document}` 앞부분 유지 |
| `--check` | 변환된 모든 수식을 KaTeX로 실제 렌더링해 보고 오류를 보고 |

### 라이브러리
```js
const { convert, check } = require('./src/latex2katex');
const result = convert(latexSource, { delimiters: 'dollars' });
result.output;   // 변환된 텍스트
result.macros;   // --no-expand 시 KaTeX macros 옵션에 넣을 객체
result.warnings; // 변환 중 경고
check(result, require('katex')); // 렌더링 실패한 수식 목록
```

## 변환 내용

- **구분자**: `\(…\)`, `\[…\]`, `$…$`, `$$…$$`, 수식 환경을 한 가지 형식으로 통일. `\$`, `\\[2pt]`, `\verb`, `verbatim`은 건드리지 않음
- **매크로**: `\newcommand`, `\renewcommand`, `\providecommand`, `\def`, `\let`, `\DeclareMathOperator(*)` 수집 후 펼침 (선택 인자 기본값 지원)
- **환경**: `align`/`flalign` → `aligned`, `gather`/`multline` → `gathered`, `alignat` → `alignedat`, `split` → `aligned`, `eqnarray`의 `&=&` → `&=`, `equation`은 내용만 남김. `\tag`는 aligned 밖으로 이동
- **KaTeX 미지원 명령**: `\mbox`→`\text`, `\mathbbm`/`\mathds`→`\mathbb`, `\ensuremath`, `\label`, `\vspace`, `\displaybreak`, `\intertext`, `\upalpha` 등(upgreek), `\sfrac`, `\hdots`, siunitx(`\SI`, `\si`, `\qty`, `\num`, `\ang`) 등
- **주석** `%` 제거, 문서 프리앰블 제거

## 한계

- KaTeX는 자동 수식 번호와 `\ref`/`\eqref` 상호 참조를 지원하지 않습니다. 참조는 라벨 텍스트로 바뀝니다.
- `\section` 같은 본문 명령은 변환하지 않습니다(수식만 대상).
- `\ce`(mhchem)는 KaTeX mhchem 확장이 있어야 렌더링됩니다(웹 화면과 `--check`에는 포함).

## 테스트
```bash
npm test
```
`npm test`는 LaTeX 변환기와 말 → LaTeX 파서를 검사합니다. 이미지 인식 테스트는 브라우저에서 `http://localhost:8765/test/ocr.html?sizes=18,32,56`을 여세요.
