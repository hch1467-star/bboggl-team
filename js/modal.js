/* ============================================
   플로팅 버튼 + 카톡 텍스트 파싱 모달
   ============================================ */

const ScheduleModal = {
  overlayEl: null,
  textareaEl: null,
  previewEl: null,
  addBtn: null,
  lastParsed: null,

  init() {
    this.overlayEl = document.getElementById("modal-overlay");
    this.textareaEl = document.getElementById("modal-textarea");
    this.previewEl = document.getElementById("modal-preview-body");
    this.addBtn = document.getElementById("modal-add-btn");
    this.roomSectionEl = document.getElementById("room-reservation-section");
    this.limoSectionEl = document.getElementById("limo-reservation-section");
    this.roomTextEl = document.getElementById("room-reservation-text");
    this.limoTextEl = document.getElementById("limo-reservation-text");

    document.getElementById("fab-add").addEventListener("click", () => this.open());
    document.getElementById("modal-close-btn").addEventListener("click", () => this.close());
    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) this.close();
    });
    this.textareaEl.addEventListener("input", () => this.updatePreview());
    this.addBtn.addEventListener("click", () => this.commit());
    document.getElementById("copy-room-btn").addEventListener("click", () => this.copyText(this.roomTextEl));
    document.getElementById("copy-limo-btn").addEventListener("click", () => this.copyText(this.limoTextEl));
  },

  copyText(textareaEl) {
    navigator.clipboard.writeText(textareaEl.value).catch(() => {
      textareaEl.select();
      document.execCommand("copy");
    });
  },

  open() {
    this.overlayEl.classList.remove("hidden");
    this.textareaEl.value = "";
    this.updatePreview();
    this.textareaEl.focus();
  },

  close() {
    this.overlayEl.classList.add("hidden");
  },

  updatePreview() {
    const raw = this.textareaEl.value;
    if (!raw.trim()) {
      this.lastParsed = null;
      this.previewEl.innerHTML = `<div class="modal-preview-empty">카톡에서 복사한 일정 텍스트를 붙여넣으면 여기에 미리보기가 표시돼요.</div>`;
      this.addBtn.disabled = true;
      this.roomSectionEl.classList.add("hidden");
      this.limoSectionEl.classList.add("hidden");
      return;
    }

    const parsed = parseSchedule(raw, this.currentYear());
    this.lastParsed = parsed;

    if (parsed.travelers.length === 0 || parsed.entries.length === 0) {
      this.previewEl.innerHTML = `<div class="modal-preview-empty">인식된 동행자·항공편 일정이 없어요. 형식을 확인해주세요.<br>예: 7/24 KE724 1235-1425 COK</div>`;
      this.addBtn.disabled = true;
      this.roomSectionEl.classList.add("hidden");
      this.limoSectionEl.classList.add("hidden");
      return;
    }

    const primary = parsed.travelers[0];
    const showTravelerLabel = parsed.travelers.length > 1;
    const directionMap = classifyDirections(parsed.entries);

    const sortedEntries = [...parsed.entries].sort(
      (a, b) => a.date.localeCompare(b.date) || a.depTime.localeCompare(b.depTime)
    );

    const card = `
      <div class="detail-item">
        <div class="detail-item-header">
          <span>
            <span class="detail-customer-name">${escapeHtml(primary.name)}</span>
            <span class="detail-customer-title">${escapeHtml(primary.title || "")}</span>
          </span>
          <span class="header-badges">
            ${parsed.assignee ? `<span class="badge-assignee">담당 ${escapeHtml(parsed.assignee)}</span>` : ""}
            ${parsed.travelers.length > 1 ? `<span class="badge-class">일행 ${parsed.travelers.length}명</span>` : ""}
          </span>
        </div>
        <div class="entry-list">
          ${sortedEntries.map((entry) => renderEntryRowHtml(entry, showTravelerLabel, directionMap.get(entry))).join("")}
        </div>
        ${renderRosterHtml(parsed.travelers)}
      </div>`;

    let warning = "";
    if (parsed.invalidLines.length > 0) {
      warning = `<div class="modal-preview-warning">인식하지 못한 줄 ${parsed.invalidLines.length}개는 제외됐어요: ${parsed.invalidLines
        .map(escapeHtml)
        .join(" / ")}</div>`;
    }

    this.previewEl.innerHTML = card + warning;
    this.addBtn.disabled = false;

    this.roomTextEl.value = buildRoomReservationText(parsed);
    this.limoTextEl.value = buildLimoReservationText(parsed);
    this.roomSectionEl.classList.remove("hidden");
    this.limoSectionEl.classList.remove("hidden");
  },

  currentYear() {
    return CalendarView.viewYear || new Date().getFullYear();
  },

  async commit() {
    if (!this.lastParsed || this.lastParsed.travelers.length === 0 || this.lastParsed.entries.length === 0) return;

    this.addBtn.disabled = true;
    this.addBtn.textContent = "저장 중...";
    try {
      const { added } = await Store.addFromParsed(this.lastParsed);
      this.close();
      if (added.length > 0) {
        const earliest = [...added].sort((a, b) => a.date.localeCompare(b.date))[0];
        CalendarView.goToDate(earliest.date);
      } else {
        CalendarView.render();
      }
    } catch (err) {
      alert("저장하지 못했어요: " + (err.message || err));
    } finally {
      this.addBtn.disabled = false;
      this.addBtn.textContent = "캘린더에 추가";
    }
  },
};
