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
    this.reservationSectionEl = document.getElementById("reservation-section");
    this.reservationTextEl = document.getElementById("reservation-text");

    document.getElementById("fab-add").addEventListener("click", () => this.open());
    document.getElementById("modal-close-btn").addEventListener("click", () => this.close());
    this.overlayEl.addEventListener("click", (e) => {
      if (e.target === this.overlayEl) this.close();
    });
    this.textareaEl.addEventListener("input", () => {
      this.mmidLookupFailed = false; // 내용이 바뀌면 고객번호 조회를 다시 시도
      this.updatePreview();
    });
    // 동명이인 후보 중 하나를 고르거나 "변경"을 누르면 그 이름의 선택을 기억하고 예약 텍스트를 다시 만든다
    this.previewEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mmid-key]");
      if (!btn) return;
      customerMmidChoices.set(btn.dataset.mmidKey, btn.dataset.mmidPick);
      this.updatePreview();
    });
    this.addBtn.addEventListener("click", () => this.commit());
    document
      .getElementById("copy-reservation-btn")
      .addEventListener("click", () => this.copyText(this.reservationTextEl));

    // 폰에서는 공유 버튼으로 카톡 등 앱을 바로 골라 보낼 수 있다 (복사 -> 앱 전환 -> 붙여넣기 대신)
    // 공유 기능은 https 주소에서만 켜져서, 지원 안 되는 환경에서는 버튼을 숨긴 채로 둔다
    const shareBtn = document.getElementById("share-reservation-btn");
    if (shareBtn && navigator.share) {
      shareBtn.style.display = "";
      shareBtn.addEventListener("click", () => this.shareText(this.reservationTextEl));
    }
  },

  async shareText(textareaEl) {
    try {
      await navigator.share({ text: textareaEl.value });
    } catch (err) {
      if (err && err.name === "AbortError") return; // 공유창을 그냥 닫은 경우
      this.copyText(textareaEl);
      alert("공유가 안 돼서 대신 복사해뒀어요. 보낼 곳에 붙여넣기 해주세요.");
    }
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
    customerMmidChoices.clear(); // 동명이인 선택은 예약 한 건 안에서만 유효
    this.mmidLookupFailed = false;
    this.updatePreview();
    this.textareaEl.focus();
  },

  // 방 주인 이름의 고객번호를 DB에 물어보고, 답이 오면 미리보기·예약 텍스트를 다시 그린다
  fetchCustomerMmids(names) {
    Store.lookupCustomers(names)
      .then((changed) => {
        if (changed && !this.overlayEl.classList.contains("hidden")) this.updatePreview();
      })
      .catch((err) => {
        console.warn("고객번호를 불러오지 못했어요:", err);
        this.mmidLookupFailed = true; // 다시 그려도 또 묻지 않게 (내용을 고치면 다시 시도)
        if (!this.overlayEl.classList.contains("hidden")) this.updatePreview();
      });
  },

  // 방 주인별 고객번호 확인 칸 — 동명이인이면 후보를 보여주고 고르게 한다
  renderMmidCheckHtml(holderMmids) {
    const rows = holderMmids
      .map(({ holder, found }) => {
        const name = `<b>${escapeHtml(travelerLabel(holder))}</b>`;
        const key = escapeHtml(found.key);
        const change = `<button type="button" class="mmid-change" data-mmid-key="${key}" data-mmid-pick="${MMID_REPICK}">변경</button>`;
        if (found.state === "loading") {
          const msg = this.mmidLookupFailed ? "고객번호를 불러오지 못했어요 (인터넷 연결 확인)" : "고객번호 찾는 중…";
          return `<div class="mmid-row">${name} <span class="mmid-why">${msg}</span></div>`;
        }
        if (found.state === "none") {
          return `<div class="mmid-row">${name} <span class="mmid-why">고객번호 목록에 없는 이름 — MMID 직접 입력</span></div>`;
        }
        if (found.state === "auto") {
          return `<div class="mmid-row">${name} → <span class="mmid-no">${escapeHtml(found.mmid)}</span>
            <span class="mmid-why">편명 ${escapeHtml(found.evidence)} 이력으로 선택 (같은 이름 ${found.candidates.length}명)</span> ${change}</div>`;
        }
        if (found.state === "chosen") {
          return `<div class="mmid-row">${name} → <span class="mmid-no">${escapeHtml(found.mmid)}</span>
            <span class="mmid-why">직접 선택 (같은 이름 ${found.candidates.length}명)</span> ${change}</div>`;
        }
        if (found.state !== "ambiguous") return ""; // 한 명뿐이면 따로 확인할 것 없음

        const cands = found.candidates
          .map((c) => {
            const meta = [
              c.lastRide ? `최근 이용 ${c.lastRide}` : "이용 기록 없음",
              c.flights.length ? c.flights.slice(0, 4).join(" ") : "",
              c.isPrimary ? "" : "다른 표기로 등록",
            ].filter(Boolean);
            return `<button type="button" class="mmid-cand${c.mmid === found.suggested ? " is-suggested" : ""}"
              data-mmid-key="${key}" data-mmid-pick="${escapeHtml(c.mmid)}">
              <span class="mmid-no">${escapeHtml(c.mmid)}</span>
              <span class="mmid-meta">${escapeHtml(meta.join(" · "))}</span></button>`;
          })
          .join("");
        return `<div class="mmid-row mmid-row-pick">${name}
          <span class="mmid-why is-warn">같은 이름 고객 ${found.candidates.length}명 — 이번 예약 고객을 골라주세요</span>
          <div class="mmid-cands">${cands}</div></div>`;
      })
      .filter(Boolean);
    if (rows.length === 0) return "";
    return `<div class="mmid-check"><div class="mmid-check-title">고객번호 확인</div>${rows.join("")}</div>`;
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
      this.reservationSectionEl.classList.add("hidden");
      return;
    }

    const parsed = parseSchedule(raw, this.currentYear(), this.currentMonth());
    this.lastParsed = parsed;

    if (parsed.travelers.length === 0 || parsed.entries.length === 0) {
      this.previewEl.innerHTML = `<div class="modal-preview-empty">인식된 동행자·항공편 일정이 없어요. 형식을 확인해주세요.<br>예: 7/24 KE724 1235-1425 COK</div>`;
      this.addBtn.disabled = true;
      this.reservationSectionEl.classList.add("hidden");
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

    const holderMmids = roomHolderMmids(parsed);
    const pending = holderMmids.filter((h) => h.found.state === "loading").map((h) => h.holder.name);
    if (pending.length && !this.mmidLookupFailed) this.fetchCustomerMmids(pending);

    this.previewEl.innerHTML = card + warning + this.renderMmidCheckHtml(holderMmids);
    this.addBtn.disabled = false;

    this.reservationTextEl.value = buildCombinedReservationText(parsed);
    this.reservationSectionEl.classList.remove("hidden");
  },

  currentYear() {
    return CalendarView.viewYear || new Date().getFullYear();
  },

  // 보고 있는 달(1~12) — 해를 넘기는 일정의 연도를 판단하는 데 쓰임 (js/parseSchedule.js 참고)
  currentMonth() {
    const m = typeof CalendarView !== "undefined" ? CalendarView.viewMonth : null;
    return typeof m === "number" ? m + 1 : new Date().getMonth() + 1; // viewMonth는 0부터 시작
  },

  async commit() {
    if (!this.lastParsed || this.lastParsed.travelers.length === 0 || this.lastParsed.entries.length === 0) return;

    const duplicate = findDuplicateGroup(this.lastParsed);
    if (duplicate) {
      const ok = confirm(
        `${groupLabel(duplicate)}님의 기존 일정이 있어요. 최신 내용으로 갱신할까요?\n(일정은 새로 입력한 내용으로 바뀌고, 적어둔 메모는 그대로 옮겨져요)`
      );
      if (!ok) return;
    }

    this.addBtn.disabled = true;
    this.addBtn.textContent = "저장 중...";
    try {
      // 새 일정을 먼저 저장하고 나서 기존 일정을 지운다 — 저장이 실패해도 기존 일정과 메모가 남도록
      const { added } = await Store.addFromParsed(this.lastParsed, { memo: duplicate ? duplicate.memo || "" : "" });
      if (duplicate) {
        await Store.removeGroup(duplicate.id);
      }
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

// 같은 대표 고객 + 같은 날짜(1건 이상 겹침)의 기존 예약을 찾음 — WT->OK 확정 등으로 재입력할 때 중복 대신 갱신 여부를 물어보기 위함
function findDuplicateGroup(parsed) {
  const primaryName = parsed.travelers[0]?.name;
  if (!primaryName) return null;
  const newDates = new Set(parsed.entries.map((e) => e.date));
  return (
    Store.groups.find((g) => {
      if (!g.travelers[0] || g.travelers[0].name !== primaryName) return false;
      return g.entries.some((e) => newDates.has(e.date));
    }) || null
  );
}
