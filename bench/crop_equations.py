"""PDF 페이지에서 가운데 정렬된 수식 줄(디스플레이 수식)을 잘라 PNG로 저장한다.

사용법: python3 bench/crop_equations.py <pdf> <첫쪽> <끝쪽> <출력폴더> [dpi] [--split]
--split: 스캔본처럼 한 장에 두 쪽이 펼쳐져 있으면 좌우로 나눠 처리
교재 이미지는 저작권이 있으므로 출력은 bench/local/ (git 제외) 아래에 두세요.
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image


def ink_mask(img):
    g = np.asarray(img.convert('L'), dtype=np.float32)
    return g < 160


def bands(mask, min_gap):
    """잉크가 있는 가로 띠들을 찾고, min_gap 보다 가까운 띠는 합친다."""
    rows = mask.any(axis=1)
    out, start, last = [], None, None
    for y, r in enumerate(rows):
        if r:
            if start is None:
                start = y
            elif y - last > min_gap:
                out.append((start, last + 1))
                start = y
            last = y
    if start is not None:
        out.append((start, last + 1))
    return out


def clusters(cols, min_gap):
    out, start, last = [], None, None
    for x, c in enumerate(cols):
        if c:
            if start is None:
                start = x
            elif x - last > min_gap:
                out.append((start, last + 1))
                start = x
            last = x
    if start is not None:
        out.append((start, last + 1))
    return out


def main():
    pdf, first, last, outdir = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    dpi = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5].isdigit() else 150
    split = '--split' in sys.argv
    os.makedirs(outdir, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['pdftoppm', '-f', str(first), '-l', str(last), '-r', str(dpi), '-png', pdf, f'{tmp}/p'], check=True)
        n = 0
        for name in sorted(os.listdir(tmp)):
            full = Image.open(f'{tmp}/{name}').convert('RGB')
            halves = [full.crop((0, 0, full.width // 2, full.height)), full.crop((full.width // 2, 0, full.width, full.height))] if split else [full]
            for img in halves:
                n = crop_page(img, dpi, outdir, name, n)
        print(f'{n} crops → {outdir}')


def crop_page(img, dpi, outdir, name, n):
    mask = ink_mask(img)
    W = mask.shape[1]
    line_h = int(dpi * 0.06)
    for (y0, y1) in bands(mask, line_h):
        h = y1 - y0
        if h < dpi * 0.12 or h > dpi * 1.6:
            continue
        cols = mask[y0:y1].any(axis=0)
        parts = clusters(cols, int(dpi * 0.35))
        # 여백·쪽 구분선을 빼고, 오른쪽 끝의 수식 번호 "(2.53)" 같은 작은 덩어리를 제외
        parts = [p for p in parts if p[1] - p[0] > dpi * 0.15]
        if not parts:
            continue
        main = max(parts, key=lambda p: p[1] - p[0])
        width = main[1] - main[0]
        # 본문 줄(폭이 넓음)은 버리고 가운데 쪽 수식 줄만
        page_left = np.argmax(mask.any(axis=0))
        page_right = W - np.argmax(mask.any(axis=0)[::-1])
        text_w = page_right - page_left
        if width > 0.8 * text_w and len(parts) == 1:
            continue
        pad = int(dpi * 0.05)
        crop = img.crop((max(0, main[0] - pad), max(0, y0 - pad), min(W, main[1] + pad), y1 + pad))
        n += 1
        crop.save(f'{outdir}/{os.path.splitext(name)[0]}_{n:03d}.png')
    return n


if __name__ == '__main__':
    main()
