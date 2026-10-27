/* ============================================
   항공검색 화면 아래 "이달의 항공 스케줄표" — 매달 1일 자동으로 만들어지는 표 이미지를 보여주고 공유·저장
   (이미지는 GitHub Actions의 scripts/build-flight-tables.js + render-flight-tables.js 가 만든다)
   ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("flight-tables-list");
  const updatedEl = document.getElementById("flight-tables-updated");
  if (!listEl) return;

  let data;
  try {
    // 매달 바뀌는 파일이라 브라우저에 남은 예전 것을 쓰지 않게 매번 새로 받는다
    const res = await fetch("flight-tables/tables.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    listEl.innerHTML = `<div class="flight-tables-empty">스케줄표를 아직 만들지 않았거나 불러오지 못했어요.</div>`;
    return;
  }

  updatedEl.textContent = `${data.updated} 기준`;
  const version = encodeURIComponent(data.generatedAt || data.updated); // 새로 만들면 이미지 주소가 바뀌어 새 그림을 받음

  listEl.innerHTML = data.pages
    .map(
      (p) => `
      <div class="flight-table-item">
        <div class="flight-table-item-head">
          <span class="flight-table-name">${escapeHtmlText(p.name || p.file)}</span>
          <span class="flight-table-actions">
            <button type="button" class="btn btn-outline" data-share="${p.file}">공유</button>
            <button type="button" class="btn btn-outline" data-save="${p.file}">저장</button>
          </span>
        </div>
        <a href="flight-tables/${p.file}.png?v=${version}" target="_blank" rel="noopener">
          <img class="flight-table-img" src="flight-tables/${p.file}.png?v=${version}" alt="${escapeHtmlText(p.name || p.file)} 항공 스케줄표" loading="lazy">
        </a>
      </div>`
    )
    .join("");

  const fileName = (name) => `항공스케줄_${data.updated.replace("/", "월")}일_${name}.png`;

  async function imageFile(page) {
    const res = await fetch(`flight-tables/${page.file}.png?v=${version}`);
    const blob = await res.blob();
    return new File([blob], fileName((page.name || page.file).replace(/\s*·\s*/g, "_")), { type: "image/png" });
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  listEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-share],[data-save]");
    if (!btn) return;
    const page = data.pages.find((p) => p.file === (btn.dataset.share || btn.dataset.save));
    if (!page) return;
    try {
      const file = await imageFile(page);
      // 폰에서는 공유창으로 카톡 등에 바로 보낼 수 있다. 공유가 안 되는 환경(PC 등)은 파일로 저장
      if (btn.dataset.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        download(file);
      }
    } catch (err) {
      if (err && err.name === "AbortError") return; // 공유창을 그냥 닫은 경우
      alert("이미지를 보내지 못했어요: " + (err.message || err));
    }
  });
});

function escapeHtmlText(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
