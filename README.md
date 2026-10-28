# LaTeX → KaTeX 변환기

LaTeX 문서나 수식을 KaTeX에서 바로 렌더링되는 형태(`$…$`, `$$…$$`)로 바꿔 주는 도구입니다.
웹 화면에는 세 가지 탭이 있습니다. 모두 AI 없이 규칙과 고전 알고리즘으로만 동작합니다.

| 탭 | 하는 일 | 코드 |
| --- | --- | --- |
| LaTeX 변환 | LaTeX 문서 → KaTeX 호환 형태 (CLI도 있음) | `src/latex2katex.js` |
| 이미지 → LaTeX | 수식 이미지(스크린샷 등)를 읽어 LaTeX로 | `src/ocr.js` |
| 말로 → LaTeX | "x 제곱 더하기 1", `sqrt(x)/2` 같은 설명을 LaTeX로 | `src/text2latex.js` |

## 이미지 → LaTeX 동작 방식

1. **이진화** — 글자 높이가 약 48px가 되도록 크기를 맞추고(어두운 배경은 자동 반전), 종이색 기준으로 세 가지 문턱값(연하게·중간·Otsu)을 모두 시도한 뒤 **글자가 기준 모양과 가장 잘 맞는 쪽**을 고름. Computer Modern처럼 획이 가는 글꼴과 번진 스캔본을 둘 다 다루기 위함
2. **연결 요소 분석** — 잉크 덩어리를 찾고, `i`·`j`의 점, `=`, `≤`, `÷`, `:` 처럼 여러 조각인 기호를 합침. 작은 글씨에서 붙어 버린 글자는 가장 얇은 세로선에서 잘라 봄
3. **글자 인식** — KaTeX·Times·Arial 글꼴로 직접 그린 기준 글자(약 400개, `ℏ`·`⟨⟩`·`≡`·`∓` 포함) + **사용자가 가르친 글자**와 32×32로 정규화해 **챔퍼 거리**로 비교
4. **구조 복원** — 위치 관계로 분수, 루트, 위/아래첨자, ∑·∏·lim의 위아래 첨자, `\hat`·`\tilde`·`\vec` 악센트, `sin`·`log` 같은 함수 이름을 복원

**한계:** 인쇄된(화면에 렌더링된) 수식용입니다. 손글씨, 행렬·여러 줄 수식은 잘 못 읽습니다. 결과는 화면에서 바로 고칠 수 있습니다.

## 교재로 학습시키기

이미지 탭에서 인식 결과를 올바르게 고친 뒤 **이 수정으로 학습**을 누르면, 그 교재의 글자 모양을 배워 다음 수식부터 더 잘 읽습니다. AI 학습이 아니라 **기준 글자를 늘리는 방식**입니다.

1. 고친 LaTeX를 KaTeX로 그리되 **기호마다 다른 색**(`\textcolor`)을 칠합니다. 그림의 각 글자 색을 보면 어떤 LaTeX 기호인지 정확히 알 수 있습니다(인식에 의존하지 않으므로 `ℏ`처럼 처음 보는 기호도 정답 라벨을 얻음).
2. 스크린샷의 글자와 이 기준 그림의 글자를 상대 위치로 짝짓습니다(순서를 지키는 동적 계획법 정렬).
3. 원래 잘못 읽었거나 자신 없게 읽은 글자만, 스크린샷의 모양 그대로 그 기호의 새 기준 글자로 저장합니다.

사이트에는 그리피스 3판·Townsend 2판·일반역학(Morin)에서 미리 배운 글자 85개(`data/learned-textbooks.json`, 글자 모양 32×32 비트맵과 라벨만 들어 있음)가 **내장**되어 있어, 교재 칸에 그 이름을 고르면 처음부터 그 교재를 더 잘 읽습니다. 내장 데이터는 "학습 지우기"로 지워지지 않습니다.

학습 데이터는 **교재(프로필)별로** 브라우저에 저장되고, 내보내기/가져오기로 다른 기기에 옮길 수 있습니다. 교재마다 따로 두는 이유는 한 교재에서 배운 모양이 다른 교재에서는 헷갈림을 만들기 때문입니다(아래 실측에서 약 3%p 차이).

### 실제 교재로 잰 정확도

그리피스 3판(전자책), Townsend 2판(스캔본), Morin 일반역학(LaTeX 조판)에서 잘라낸 수식 62개로 쟀습니다. 학습 효과는 **책마다 절반으로 학습하고 나머지 절반으로 시험**(2-fold 교차 검증)해서, 배운 수식으로 시험 보지 않게 했습니다. 토큰 정확도는 LaTeX 기호 단위 편집 거리로 잰 값입니다.

| 단계 | 토큰 정확도 | 완전히 일치 |
| --- | --- | --- |
| 처음 버전 | 36.6% | 2 / 62 |
| 이진화 개선(문턱값 자동 선택) | 61.0% | 10 / 62 |
| + 학습 (모든 교재 섞어서) | 69.4% | 13 / 62 |
| + 학습 (**교재별**) | **72.4%** | **18 / 62** |

교재별로는 그리피스 83%, Morin 76%, Townsend(스캔본) 57%입니다. 합성 테스트(`test/ocr.html`, KaTeX로 그린 수식 111개)는 110개 일치를 유지합니다.

### 내 교재로 벤치마크 만들기

교재 이미지는 저작권이 있으므로 `bench/local/`(git 제외)에만 둡니다.
```bash
python3 bench/crop_equations.py 교재.pdf 58 62 bench/local/책이름
```
잘린 수식 중 쓸 것을 골라 `bench/local/truth.json`에 `{"책이름": {"파일.png": "정답 LaTeX"}}`로 적은 뒤, 로컬 서버에서 `bench/bench.html?mode=baseline`(그대로), `?mode=cv`(학습 효과), `?mode=cv&pool=book`(교재별 학습)을 엽니다. 스캔본이 두 쪽씩 펼쳐져 있으면 명령 끝에 `--split`을 붙입니다.

## 말로 → LaTeX 예시

| 입력 | 결과 |
| --- | --- |
| `x 제곱 더하기 2x 더하기 1` | `x^2 + 2x + 1` |
| `2 분의 1` | `\frac{1}{2}` |
| `시그마 k=1부터 n까지 k 제곱` | `\sum_{k = 1}^n k^2` |
| `극한 x가 0으로 갈 때 사인 x 나누기 x` | `\lim_{x \to 0}\frac{\sin x}{x}` |
| `x는 3보다 크다` | `x > 3` |
| `십의 제곱 더하기 오는 40이다` | `10^2 + 5 = 40` |
| `이십오 더하기 삼분의 일` | `25 + \frac{1}{3}` |
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
