/* ============================================
   항공검색 — 출발/도착 공항 선택 → 노선별 편명·시간 목록
   ============================================ */

const AIRPORT_OPTIONS = [...KOREA_AIRPORTS, ...JAPAN_AIRPORTS];

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

  wireLogoutButton();

  const fromSelect = document.getElementById("from-airport-select");
  const toSelect = document.getElementById("to-airport-select");
  const titleEl = document.getElementById("flight-results-title");
  const resultsEl = document.getElementById("flight-results");

  const optionsHtml = `<option value="">선택</option>` + AIRPORT_OPTIONS.map((a) => `<option value="${a}">${a}</option>`).join("");
  fromSelect.innerHTML = optionsHtml;
  toSelect.innerHTML = optionsHtml;
  fromSelect.value = "인천";
  toSelect.value = "오사카";

  function render() {
    const from = fromSelect.value;
    const to = toSelect.value;

    if (!from || !to) {
      titleEl.textContent = "노선을 선택해주세요";
      resultsEl.innerHTML = "";
      return;
    }
    if (from === to) {
      titleEl.textContent = "출발공항과 도착공항이 같아요";
      resultsEl.innerHTML = "";
      return;
    }

    const flights = findFlightsForRoute(from, to);

    if (flights === null) {
      titleEl.textContent = "한국↔일본 노선만 검색할 수 있어요";
      resultsEl.innerHTML = "";
      return;
    }
    if (flights.length === 0) {
      titleEl.textContent = `${from} → ${to}`;
      resultsEl.innerHTML = `<div class="detail-empty">이 노선은 아직 지원하지 않아요.</div>`;
      return;
    }

    titleEl.textContent = `${from} → ${to} · ${flights.length}편`;
    resultsEl.innerHTML = flights
      .map(
        (f) => `
      <div class="flight-result-row">
        <span class="flight-result-code">${escapeHtml(f.label)}</span>
        <span class="flight-result-time">${f.range.replace("-", " - ")}</span>
      </div>`
      )
      .join("");
  }

  fromSelect.addEventListener("change", render);
  toSelect.addEventListener("change", render);
  document.getElementById("swap-airports-btn").addEventListener("click", () => {
    const tmp = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = tmp;
    render();
  });

  render();
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
