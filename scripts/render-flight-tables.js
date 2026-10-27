/* ============================================
   flight-tables/tables.json -> 표 이미지(PNG) 3장
   여행사가 쓰던 스케줄표 모양(노란 제목, 노선별 좌우 표)을 그대로 따라 그린다.

   사용법:
     node scripts/render-flight-tables.js           # PNG 생성 (playwright 필요 — GitHub Actions에서 설치)
     node scripts/render-flight-tables.js --html    # HTML만 만들기 (브라우저로 모양 확인용)
   ============================================ */

const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "flight-tables");
const data = JSON.parse(fs.readFileSync(path.join(DIR, "tables.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function sideTable(title, rows, count) {
  const body = [];
  for (let i = 0; i < count; i++) {
    const r = rows[i];
    body.push(
      r
        ? `<tr><td class="fl">${esc(r.label)}</td><td>${esc(r.dep)}</td><td>${esc(r.arr)}</td></tr>`
        : `<tr><td class="fl">-</td><td>-</td><td>-</td></tr>`
    );
  }
  return `<table>
    <tr><th colspan="3" class="route">${esc(title)}</th></tr>
    <tr class="head"><td>便名</td><td>出発</td><td>到着</td></tr>
    ${body.join("")}
  </table>`;
}

function pageHtml(page) {
  const blocks = page.blocks
    .map((b) => {
      const n = Math.max(b.inRows.length, b.outRows.length, 1); // 좌우 줄 수를 맞춤 (빈 칸은 "-")
      return `<div class="block">${sideTable(b.inTitle, b.inRows, n)}${sideTable(b.outTitle, b.outRows, n)}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:"Noto Sans CJK JP","Noto Sans JP","Yu Gothic","Meiryo",sans-serif;color:#000}
  .sheet{display:inline-block;padding:10px 12px 12px;background:#fff}
  .top{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:4px}
  .badge{background:#ffff00;font-weight:700;font-size:15px;padding:1px 6px}
  .upd{font-size:14px}
  .block{display:flex;border:2px solid #000;border-top:none}
  .block:first-of-type{border-top:2px solid #000}
  table{border-collapse:collapse;width:300px;font-size:14px}
  table + table{border-left:2px solid #000}
  td,th{border:1px solid #000;padding:2px 6px;text-align:center;white-space:nowrap}
  th.route{background:#f6dcef;font-weight:500;text-decoration:underline;padding:3px}
  tr.head td{font-weight:500}
  td.fl{width:58%;font-weight:700}
  .note{font-size:11px;margin-top:4px;color:#333}
  </style></head><body><div class="sheet" id="sheet">
  <div class="top"><span class="badge">※Only business class</span><span class="upd">*${esc(data.updated)} UPDATE</span></div>
  ${blocks}
  <div class="note">※LCC除く。仁川発着時刻は仁川空港データ、日本側の時刻は所要時間からの目安です。${
    data.gimpoSeason && page.blocks.some((b) => b.inTitle.includes("金浦"))
      ? `<br>※金浦路線は新スケジュール未公開のため ${esc(data.gimpoSeason)} スケジュール基準です。`
      : ""
  }</div>
  </div></body></html>`;
}

async function main() {
  const htmlOnly = process.argv.includes("--html");
  const files = data.pages.map((p) => {
    const file = path.join(DIR, `${p.file}.html`);
    fs.writeFileSync(file, pageHtml(p));
    return { file, png: path.join(DIR, `${p.file}.png`) };
  });
  if (htmlOnly) {
    console.log("HTML 생성:", files.map((f) => path.basename(f.file)).join(", "));
    return;
  }

  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const pg = await browser.newPage({ deviceScaleFactor: 2 }); // 폰에서 확대해도 글자가 또렷하게
  for (const f of files) {
    await pg.goto("file://" + f.file);
    await pg.locator("#sheet").screenshot({ path: f.png });
    fs.unlinkSync(f.file); // 배포에는 이미지만 남김
    console.log("이미지 생성:", path.basename(f.png));
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
