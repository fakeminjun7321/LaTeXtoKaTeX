/*
 * LatexImage — KaTeX로 렌더링한 수식을 그림(canvas)으로 만든다.
 * 인식기 테스트와 '예제 이미지' 기능에 쓴다. 글꼴을 data URL 로 넣은 SVG foreignObject 를 그린다.
 */
(function (root, factory) {
  root.LatexImage = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let cssPromise = null;

  function toDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // KaTeX CSS 를 가져와 woff2 글꼴을 data URL 로 바꿔 넣는다
  function inlineCss() {
    if (cssPromise) return cssPromise;
    cssPromise = (async () => {
      const link = [...document.querySelectorAll('link[rel=stylesheet]')].find((l) => /katex/i.test(l.href));
      if (!link) throw new Error('KaTeX CSS 를 찾지 못했습니다.');
      let css = await (await fetch(link.href)).text();
      css = css.replace(/src:([^;}]*)/g, (m, list) => {
        const woff2 = /url\(([^)]+\.woff2)\)/.exec(list);
        return woff2 ? `src:url(${woff2[1]}) format("woff2")` : m;
      });
      const urls = [...new Set([...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]))];
      const map = {};
      await Promise.all(urls.map(async (u) => {
        const abs = new URL(u.replace(/["']/g, ''), link.href).href;
        map[u] = await toDataUrl(await (await fetch(abs)).blob());
      }));
      return css.replace(/url\(([^)]+\.woff2)\)/g, (m, u) => `url(${map[u]})`);
    })();
    return cssPromise;
  }

  async function render(latex, { fontSize = 32, display = true, padding = 16 } = {}) {
    const css = await inlineCss();
    const holder = document.createElement('div');
    holder.style.cssText = `position:absolute;left:-10000px;top:0;font-size:${fontSize}px;padding:${padding}px;background:#fff;color:#000;display:inline-block`;
    holder.innerHTML = katex.renderToString(latex, { displayMode: display, throwOnError: false });
    document.body.append(holder);
    await document.fonts.ready;
    const w = Math.ceil(holder.getBoundingClientRect().width), h = Math.ceil(holder.getBoundingClientRect().height);
    holder.style.position = 'static';
    holder.style.left = '0';
    const xhtml = new XMLSerializer().serializeToString(holder);
    holder.remove();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml"><style>${css.replace(/</g, '\\3c ')}</style>${xhtml.replace(/^<div /, '<div ')}</div></foreignObject></svg>`;
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    return cv;
  }

  return { render };
});
