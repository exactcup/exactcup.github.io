#!/usr/bin/env node
// Renders the site's share images (og:image cards + the Pinterest pin for the
// printable chart) from brand-styled HTML via headless Chrome, into assets/.
// Run manually when the designs change: node scripts/make-images.js
// The PNGs are committed, so build.js/CI never needs Chrome.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ingredients.json"), "utf8"));
const ing = (slug) => DATA.ingredients.find((i) => i.slug === slug);
const g = (slug) => Math.round(ing(slug).gramsPerCup);

const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{overflow:hidden}
body{font-family:${FONT};color:#1f2328;background:#fff;-webkit-font-smoothing:antialiased}
.brand{font-weight:800;letter-spacing:-.5px}.brand span{color:#c2410c}
table{border-collapse:collapse;width:100%}
td,th{text-align:left;padding:6px 10px;border-bottom:1px solid #e6e8eb}
th{color:#5b6470;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.muted{color:#5b6470}
`;

// --- 1200x630 default og card: the brand + a sample of the core data ---
const ogDefault = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{width:1200px;height:630px;display:flex;flex-direction:column;justify-content:space-between;padding:56px 64px;border-top:14px solid #c2410c}
h1{font-size:64px;letter-spacing:-1.5px}
.tag{font-size:31px;color:#5b6470;margin-top:10px}
.cols{display:flex;gap:48px;align-items:center}
.sample{background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:18px 26px;font-size:26px;min-width:430px}
.sample td,.sample th{border-bottom:1px solid #fed7aa;padding:8px 12px}
.sample tr:last-child td{border-bottom:none}
.pts{font-size:23px;line-height:2;white-space:nowrap}
.pts li{list-style:none;padding-left:34px;position:relative}
.pts li:before{content:"✓";position:absolute;left:0;color:#c2410c;font-weight:800}
.url{font-size:26px;font-weight:700;color:#c2410c}
</style></head><body>
<div><h1 class="brand">Exact<span>Cup</span></h1>
<p class="tag">Accurate cups&nbsp;→&nbsp;grams for ${DATA.ingredients.length}+ ingredients — because a &ldquo;cup&rdquo; isn&rsquo;t a weight</p></div>
<div class="cols">
<table class="sample">
<tr><td>1 cup flour</td><td class="num">${g("all-purpose-flour")} g</td></tr>
<tr><td>1 cup sugar</td><td class="num">${g("granulated-sugar")} g</td></tr>
<tr><td>1 cup butter</td><td class="num">${g("butter")} g</td></tr>
<tr><td>1 cup honey</td><td class="num">${g("honey")} g</td></tr>
</table>
<ul class="pts">
<li>Verified vs King Arthur &amp; USDA</li>
<li>Recipe scaler, oven temps &amp; more</li>
<li>Free · no ads · no sign-up</li>
</ul>
</div>
<p class="url">exactcup.github.io</p>
</body></html>`;

// --- 1200x630 og card for the printable chart page: a peek at the chart itself ---
const ogChart = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{width:1200px;height:630px;display:flex;flex-direction:column;justify-content:space-between;padding:44px 64px 36px;border-top:14px solid #c2410c}
h1{font-size:54px;letter-spacing:-1.5px}
.tag{font-size:27px;color:#5b6470;margin:8px 0 0}
.cols{display:flex;gap:40px}
.col{flex:1}
h2{font-size:22px;color:#c2410c;margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em}
table{font-size:24px}
td,th{padding:7px 10px}
.foot{display:flex;justify-content:space-between;align-items:baseline;font-size:25px}
.url{font-weight:700;color:#c2410c}
</style></head><body>
<h1>Kitchen Conversion Chart</h1>
<p class="tag">Free printable — volume, ingredient weights &amp; oven temps on one page</p>
<div class="cols">
<div class="col"><h2>Volume</h2><table>
<tr><td>1 cup</td><td class="num">16 tbsp</td><td class="num">237 mL</td></tr>
<tr><td>1/2 cup</td><td class="num">8 tbsp</td><td class="num">118 mL</td></tr>
<tr><td>1/4 cup</td><td class="num">4 tbsp</td><td class="num">59 mL</td></tr>
<tr><td>1 tbsp</td><td class="num">3 tsp</td><td class="num">15 mL</td></tr>
</table></div>
<div class="col"><h2>Grams per cup</h2><table>
<tr><td>Flour</td><td class="num">${g("all-purpose-flour")} g</td></tr>
<tr><td>Sugar</td><td class="num">${g("granulated-sugar")} g</td></tr>
<tr><td>Butter</td><td class="num">${g("butter")} g</td></tr>
<tr><td>Honey</td><td class="num">${g("honey")} g</td></tr>
</table></div>
<div class="col"><h2>Oven</h2><table>
<tr><td class="num">325°F</td><td class="num">170°C</td><td>Gas 3</td></tr>
<tr><td class="num">350°F</td><td class="num">180°C</td><td>Gas 4</td></tr>
<tr><td class="num">400°F</td><td class="num">200°C</td><td>Gas 6</td></tr>
<tr><td class="num">425°F</td><td class="num">220°C</td><td>Gas 7</td></tr>
</table></div>
</div>
<div class="foot"><span class="brand" style="font-size:30px">Exact<span>Cup</span></span>
<span class="url">exactcup.github.io/kitchen-conversion-chart</span></div>
</body></html>`;

// --- 1000x1500 Pinterest pin (2:3) for the printable chart ---
const pin = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
body{width:1000px;height:1500px;display:flex;flex-direction:column;padding:44px 58px 36px;border:16px solid #c2410c}
.brand{font-size:32px}
h1{font-size:72px;line-height:1.05;letter-spacing:-2px;margin:14px 0 4px}
.tag{font-size:30px;color:#5b6470;margin-bottom:16px}
h2{font-size:25px;color:#c2410c;margin:20px 0 4px;text-transform:uppercase;letter-spacing:.04em}
table{font-size:27px}
td,th{padding:7px 12px}
.two{display:flex;gap:44px}.two>div{flex:1}
.foot{margin-top:auto;padding-top:18px;text-align:center;font-size:27px}
.foot .url{font-weight:800;color:#c2410c;font-size:31px}
</style></head><body>
<span class="brand">Exact<span>Cup</span></span>
<h1>Kitchen<br>Conversion Chart</h1>
<p class="tag">Free printable — fits one page</p>
<h2>Volume equivalents (US)</h2>
<table>
<tr><td>1 cup</td><td class="num">16 tbsp</td><td class="num">8 fl oz</td><td class="num">237 mL</td></tr>
<tr><td>3/4 cup</td><td class="num">12 tbsp</td><td class="num">6 fl oz</td><td class="num">177 mL</td></tr>
<tr><td>1/2 cup</td><td class="num">8 tbsp</td><td class="num">4 fl oz</td><td class="num">118 mL</td></tr>
<tr><td>1/4 cup</td><td class="num">4 tbsp</td><td class="num">2 fl oz</td><td class="num">59 mL</td></tr>
<tr><td>1 tbsp</td><td class="num">3 tsp</td><td class="num">1/2 fl oz</td><td class="num">15 mL</td></tr>
</table>
<div class="two">
<div><h2>Grams per cup</h2>
<table>
<tr><td>Flour</td><td class="num">${g("all-purpose-flour")} g</td></tr>
<tr><td>Sugar</td><td class="num">${g("granulated-sugar")} g</td></tr>
<tr><td>Brown sugar</td><td class="num">${g("brown-sugar")} g</td></tr>
<tr><td>Butter</td><td class="num">${g("butter")} g</td></tr>
<tr><td>Honey</td><td class="num">${g("honey")} g</td></tr>
<tr><td>Cocoa</td><td class="num">${g("cocoa-powder")} g</td></tr>
</table></div>
<div><h2>Oven temps</h2>
<table>
<tr><td class="num">300°F</td><td class="num">150°C</td><td>Gas 2</td></tr>
<tr><td class="num">325°F</td><td class="num">170°C</td><td>Gas 3</td></tr>
<tr><td class="num">350°F</td><td class="num">180°C</td><td>Gas 4</td></tr>
<tr><td class="num">375°F</td><td class="num">190°C</td><td>Gas 5</td></tr>
<tr><td class="num">400°F</td><td class="num">200°C</td><td>Gas 6</td></tr>
<tr><td class="num">425°F</td><td class="num">220°C</td><td>Gas 7</td></tr>
</table></div>
</div>
<h2>Butter</h2>
<table>
<tr><td>1 stick</td><td class="num">1/2 cup</td><td class="num">8 tbsp</td><td class="num">${Math.round(ing("butter").gramsPerCup / 2)} g</td></tr>
<tr><td>2 sticks</td><td class="num">1 cup</td><td class="num">16 tbsp</td><td class="num">${Math.round(ing("butter").gramsPerCup)} g</td></tr>
</table>
<div class="foot"><p class="muted">Print the full one-page chart free — plus interactive converters for ${DATA.ingredients.length}+ ingredients</p>
<p class="url">exactcup.github.io/kitchen-conversion-chart</p></div>
</body></html>`;

const JOBS = [
  ["og-default.png", 1200, 630, ogDefault],
  ["og-kitchen-conversion-chart.png", 1200, 630, ogChart],
  ["kitchen-conversion-chart-pin.png", 1000, 1500, pin],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exactcup-img-"));
for (const [name, w, h, html] of JOBS) {
  const src = path.join(tmp, name.replace(/\.png$/, ".html"));
  fs.writeFileSync(src, html);
  const out = path.join(ROOT, "assets", name);
  // Render 200px taller than the target: at an exact-fit viewport headless
  // Chrome clips the bottom ~100px of the paint. Crop back to size after.
  execFileSync("google-chrome", [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", `--window-size=${w},${h + 200}`,
    `--screenshot=${out}`, `file://${src}`,
  ], { stdio: "pipe" });
  execFileSync("python3", ["-c",
    `from PIL import Image; Image.open("${out}").crop((0, 0, ${w}, ${h})).save("${out}")`,
  ], { stdio: "pipe" });
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`${name}: ${w}x${h}, ${kb} KB`);
}
fs.rmSync(tmp, { recursive: true, force: true });
