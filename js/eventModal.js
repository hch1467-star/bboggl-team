/* ============================================
   이벤트(주말 행사 등) 추가 모달 — 직원 전체 공통, 매달 수동 등록
   ============================================ */

const EventModal = {
  init() {
    document.getElementById("event-modal-close-btn").addEventListener("click", () => this.close());
    document.getElementById("event-modal-cancel-btn").addEventListener("click", () => this.close());
    document.getElementById("event-modal-save-btn").addEventListener("click", () => this.save());
    document.getElementById("add-event-btn").addEventListener("click", () => this.open());
  },

  open(dateStr) {
    document.getElementById("event-date-input").value = dateStr || CalendarView.selectedDate;
    document.getElementById("event-title-input").value = "";
    document.getElementById("event-memo-input").value = "";
    document.getElementById("event-modal-overlay").classList.remove("hidden");
    document.getElementById("event-title-input").focus();
  },

  close() {
    document.getElementById("event-modal-overlay").classList.add("hidden");
  },

  async save() {
    const date = document.getElementById("event-date-input").value;
    const title = document.getElementById("event-title-input").value.trim();
    const memo = document.getElementById("event-memo-input").value.trim();

    if (!date || !title) {
      alert("날짜와 제목을 입력해주세요.");
      return;
    }

    const saveBtn = document.getElementById("event-modal-save-btn");
    saveBtn.disabled = true;
    try {
      await Store.addEvent({ date, title, memo });
      this.close();
      CalendarView.render();
    } catch (err) {
      alert("이벤트를 추가하지 못했어요: " + (err.message || err));
    } finally {
      saveBtn.disabled = false;
    }
  },
};
