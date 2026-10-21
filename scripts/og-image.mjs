// Gera public/og-image.png (1200x630) a partir do logo e das fontes do projeto.
// Uso: npm run og   (precisa do Chromium do Playwright: npx playwright install chromium)
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const b64 = (path) => readFileSync(path).toString('base64');
const logo = b64('public/logo-pitdrive.webp');
const kanit = b64('node_modules/@fontsource/kanit/files/kanit-latin-700-italic.woff2');
const sans = b64('node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-600-normal.woff2');

const html = `<!doctype html><html><head><style>
@font-face{font-family:K;font-style:italic;font-weight:700;src:url(data:font/woff2;base64,${kanit})}
@font-face{font-family:S;font-weight:600;src:url(data:font/woff2;base64,${sans})}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:#1A1A1A;color:#fff;font-family:S;padding:72px 80px;position:relative;overflow:hidden}
img{width:264px;height:auto}
h1{font-family:K;font-style:italic;font-size:76px;line-height:1.02;margin-top:56px;letter-spacing:-.01em}
h1 span{display:block;color:#6B9BFF}
p{position:absolute;left:80px;bottom:64px;font-size:26px;color:#E5E7EB;display:flex;align-items:center;gap:14px}
p i{width:12px;height:12px;border-radius:50%;background:#39FF14;display:inline-block}
.s{position:absolute;right:80px;bottom:76px;display:flex;gap:10px;transform:skewX(-14deg)}
.s b{display:block;height:8px;width:60px;background:rgba(255,255,255,.22)}
.s b:first-child{width:110px;background:#0052FF}.s b:last-child{width:26px;background:#39FF14}
</style></head><body>
<img src="data:image/webp;base64,${logo}">
<h1>Coloque seu carro.<span>O PitDrive mostra o que<br>ele precisa e quando.</span></h1>
<p><i></i>Pré-lançamento · Entre na lista de espera</p>
<div class="s"><b></b><b></b><b></b></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
console.log('public/og-image.png gerado.');
