/* ============================================
   검색 — 고객명(대표+동행자)/편명 키워드로 클라이언트 필터링
   ============================================ */

const SearchBox = {
  inputEl: null,
  resultsEl: null,

  init() {
    this.inputEl = document.getElementById("search-input");
    this.resultsEl = document.getElementById("search-results");

    this.inputEl.addEventListener("input", () => this.onInput());
    document.addEventListener("click", (e) => {
      if (!this.resultsEl.contains(e.target) && e.target !== this.inputEl) {
        this.resultsEl.classList.add("hidden");
      }
    });
  },

  onInput() {
    const keyword = this.inputEl.value.trim().toLowerCase();

    if (!keyword) {
      CalendarView.searchFilterFn = null;
      this.resultsEl.classList.add("hidden");
      CalendarView.render();
      return;
    }

    const matcher = ({ group, entry }) =>
      group.travelers.some((t) => t.name.toLowerCase().includes(keyword)) ||
      entry.flightNo.toLowerCase().includes(keyword);

    CalendarView.searchFilterFn = (pairs) => pairs.filter(matcher);
    CalendarView.render();

    const matches = Store.flatEntries().filter(matcher).sort((a, b) => a.entry.date.localeCompare(b.entry.date));
    this.renderResults(matches, keyword);
  },

  renderResults(matches, keyword) {
    this.resultsEl.innerHTML = "";
    if (matches.length === 0) {
      this.resultsEl.innerHTML = `<div class="search-result-empty">'${escapeHtml(keyword)}'와 일치하는 일정이 없어요.</div>`;
      this.resultsEl.classList.remove("hidden");
      return;
    }

    const seen = new Set();
    matches.forEach(({ group, entry }) => {
      const key = `${group.id}-${entry.date}`;
      if (seen.has(key)) return;
      seen.add(key);

      const primary = group.travelers[0];
      const nameLabel =
        group.travelers.length > 1 ? `${primary.name} 외 ${group.travelers.length - 1}명` : primary.name;

      const [, m, d] = entry.date.split("-");
      const row = document.createElement("div");
      row.className = "search-result-row";
      row.innerHTML = `
        <span class="detail-customer-name">${escapeHtml(nameLabel)}</span>
        <span class="detail-customer-title">${m}/${d} · ${entry.flightNo}</span>
      `;
      row.addEventListener("click", () => {
        this.inputEl.value = "";
        CalendarView.searchFilterFn = null;
        this.resultsEl.classList.add("hidden");
        CalendarView.goToDate(entry.date);
      });
      this.resultsEl.appendChild(row);
    });
    this.resultsEl.classList.remove("hidden");
  },
};
