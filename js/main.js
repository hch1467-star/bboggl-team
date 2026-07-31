/* ============================================
   초기화 진입점 — 로그인 확인 → 내 데이터 로드 → 화면 초기화
   ============================================ */

document.addEventListener("DOMContentLoaded", async () => {
  const session = await requireSession();
  if (!session) return; // login.html로 이동 중

  if (await checkIsAdmin(CurrentUser.id)) {
    window.location.href = "admin.html";
    return;
  }

  const loadingEl = document.getElementById("loading-overlay");

  try {
    await Store.init(CurrentUser.id);
    await maybeImportLocalData();
  } catch (err) {
    alert("일정을 불러오지 못했어요: " + (err.message || err));
  }

  // 서로 상관없는 자료들이라 하나씩 기다리지 않고 동시에 불러온다 (기다리는 시간이 합이 아니라 최댓값이 됨)
  // 고객 MMID 목록은 1만 건이 넘어 여기서 불러오면 첫 화면이 그만큼 늦어진다.
  // 붙여넣기 모달에서만 쓰이므로 그때 불러온다 (js/modal.js의 open 참고)
  await Promise.all([
    Store.loadEvents().catch((err) => console.warn("이벤트를 불러오지 못했어요:", err)),
    Store.loadEventNotes().catch((err) => console.warn("이벤트 개인 메모를 불러오지 못했어요:", err)),
    Store.loadStaffDirectory().catch((err) => console.warn("담당자 디렉터리를 불러오지 못했어요:", err)),
  ]);

  if (loadingEl) loadingEl.remove();

  CalendarView.init();
  SearchBox.init();
  ScheduleModal.init();
  EventModal.init();
  wireLogoutButton();
});
