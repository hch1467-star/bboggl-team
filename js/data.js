/* ============================================
   Store — Supabase 기반 (팀 버전)
   각자 로그인한 사용자의 데이터만 불러오고/저장한다 (RLS로 DB에서도 강제됨).
   ============================================ */

const LOCAL_IMPORT_KEY = "bboggl_groups_v1"; // 예전 개인용 버전(localStorage)과 같은 키 — 같은 브라우저 출처일 때만 의미 있음

// DB row -> 화면에서 쓰는 모양으로 변환
function toEntry(row, travelers) {
  return {
    id: row.id,
    date: row.date,
    flightNo: row.flight_no,
    depTime: row.dep_time,
    arrTime: row.arr_time,
    seatClass: row.seat_class,
    status: row.status,
    memo: row.memo || "",
    createdAt: row.created_at || new Date().toISOString(),
    travelers: travelers || [],
  };
}

function toTraveler(row) {
  return { id: row.id, name: row.name, title: row.title || "", note: row.note || "" };
}

const Store = {
  groups: [],
  events: [], // 직원 전체가 공통으로 보는 이벤트(주말 행사 등) — user_id로 분리하지 않음
  staffDirectory: [], // 담당자 사번/전화번호 — 개인정보라 DB(staff_directory 테이블)에서만 불러옴, git에는 저장 안 함
  customerMmid: [], // 고객명 ↔ MMID(고객번호) — 개인정보라 DB(customer_mmid 테이블)에서만 불러옴, git에는 저장 안 함

  // 로그인 직후 이 사용자의 데이터를 전부 불러와 메모리에 재구성
  async init(userId) {
    const [groupsRes, travelersRes, entriesRes, entryTravelersRes] = await Promise.all([
      supabaseClient.from("groups").select("*").eq("user_id", userId).order("created_at"),
      supabaseClient.from("travelers").select("*").eq("user_id", userId).order("sort_order"),
      supabaseClient.from("entries").select("*").eq("user_id", userId),
      supabaseClient.from("entry_travelers").select("*").eq("user_id", userId),
    ]);

    for (const res of [groupsRes, travelersRes, entriesRes, entryTravelersRes]) {
      if (res.error) throw res.error;
    }

    const travelerById = new Map(travelersRes.data.map((t) => [t.id, toTraveler(t)]));

    const travelersByGroup = new Map();
    travelersRes.data.forEach((t) => {
      if (!travelersByGroup.has(t.group_id)) travelersByGroup.set(t.group_id, []);
      travelersByGroup.get(t.group_id).push(travelerById.get(t.id));
    });

    const travelersByEntry = new Map();
    entryTravelersRes.data.forEach((et) => {
      if (!travelersByEntry.has(et.entry_id)) travelersByEntry.set(et.entry_id, []);
      const traveler = travelerById.get(et.traveler_id);
      if (traveler) travelersByEntry.get(et.entry_id).push(traveler);
    });

    const entriesByGroup = new Map();
    entriesRes.data.forEach((e) => {
      const entry = toEntry(e, travelersByEntry.get(e.id));
      if (!entriesByGroup.has(e.group_id)) entriesByGroup.set(e.group_id, []);
      entriesByGroup.get(e.group_id).push(entry);
    });

    this.groups = groupsRes.data.map((g) => ({
      id: g.id,
      travelers: travelersByGroup.get(g.id) || [],
      entries: entriesByGroup.get(g.id) || [],
      assignee: g.assignee || "",
      memo: g.memo || "",
    }));
  },

  // 파싱된 카톡 텍스트 → 그룹(예약 단위) 생성 후 Supabase에 저장
  async addFromParsed(parsed) {
    const userId = CurrentUser.id;

    const { data: groupRow, error: gErr } = await supabaseClient
      .from("groups")
      .insert({ user_id: userId, assignee: parsed.assignee || "" })
      .select()
      .single();
    if (gErr) throw gErr;

    const travelerRows = parsed.travelers.map((t, i) => ({
      group_id: groupRow.id,
      user_id: userId,
      name: t.name,
      title: t.title || "",
      note: t.note || "",
      sort_order: i,
    }));
    const { data: insertedTravelers, error: tErr } = await supabaseClient
      .from("travelers")
      .insert(travelerRows)
      .select();
    if (tErr) throw tErr;

    const travelerByName = new Map(insertedTravelers.map((t) => [t.name, toTraveler(t)]));

    const insertedEntries = [];
    for (const entry of parsed.entries) {
      const { data: entryRow, error: eErr } = await supabaseClient
        .from("entries")
        .insert({
          group_id: groupRow.id,
          user_id: userId,
          date: entry.date,
          flight_no: entry.flightNo,
          dep_time: entry.depTime,
          arr_time: entry.arrTime,
          seat_class: entry.seatClass,
          status: entry.status,
          memo: entry.memo || "",
        })
        .select()
        .single();
      if (eErr) throw eErr;

      const entryTravelers = (entry.travelers || []).map((t) => travelerByName.get(t.name)).filter(Boolean);

      if (entryTravelers.length > 0) {
        const entryTravelerRows = entryTravelers.map((t) => ({
          entry_id: entryRow.id,
          traveler_id: t.id,
          user_id: userId,
        }));
        const { error: etErr } = await supabaseClient.from("entry_travelers").insert(entryTravelerRows);
        if (etErr) throw etErr;
      }

      insertedEntries.push(toEntry(entryRow, entryTravelers));
    }

    const group = {
      id: groupRow.id,
      travelers: insertedTravelers.map(toTraveler),
      entries: insertedEntries,
      assignee: groupRow.assignee || "",
      memo: groupRow.memo || "",
    };
    this.groups.push(group);
    return { group, added: group.entries };
  },

  // 그룹(예약 단위) 전체 삭제 — 그 안의 동행자·항공편 전부 제거 (DB의 cascade 삭제로 처리)
  async removeGroup(groupId) {
    const { error } = await supabaseClient.from("groups").delete().eq("id", groupId);
    if (error) throw error;
    this.groups = this.groups.filter((g) => g.id !== groupId);
  },

  // 예약(그룹)에 자유롭게 적는 메모 저장
  async updateGroupMemo(groupId, memo) {
    const { error } = await supabaseClient.from("groups").update({ memo }).eq("id", groupId);
    if (error) throw error;
    const group = this.groups.find((g) => g.id === groupId);
    if (group) group.memo = memo;
  },

  // 이벤트(주말 행사 등) — 직원 전체 공통, 매달 수동으로 등록
  async loadEvents() {
    const { data, error } = await supabaseClient.from("events").select("*").order("date");
    if (error) throw error;
    this.events = data.map((e) => ({ id: e.id, date: e.date, title: e.title, memo: e.memo || "" }));
  },

  async addEvent({ date, title, memo }) {
    const { data, error } = await supabaseClient
      .from("events")
      .insert({ date, title, memo: memo || "" })
      .select()
      .single();
    if (error) throw error;
    const event = { id: data.id, date: data.date, title: data.title, memo: data.memo || "" };
    this.events.push(event);
    return event;
  },

  async removeEvent(eventId) {
    const { error } = await supabaseClient.from("events").delete().eq("id", eventId);
    if (error) throw error;
    this.events = this.events.filter((e) => e.id !== eventId);
  },

  // 담당자 사번/전화번호 디렉터리 — 개인정보라 DB에서만 불러옴 (예약 텍스트의 BILLING/HOST에 사용)
  async loadStaffDirectory() {
    const { data, error } = await supabaseClient.from("staff_directory").select("*").order("name");
    if (error) throw error;
    this.staffDirectory = data.map((s) => ({
      name: s.name,
      nickname: s.nickname,
      employeeId: s.employee_id,
      phone: s.phone,
    }));
  },

  // 고객명 ↔ MMID(고객번호) — 개인정보라 DB에서만 불러옴 (예약 텍스트의 MMID에 사용). 건수가 많아 1000건씩 나눠서 전부 가져옴
  async loadCustomerMmid() {
    const rows = [];
    const batchSize = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseClient
        .from("customer_mmid")
        .select("name, mmid")
        .range(offset, offset + batchSize - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < batchSize) break;
      offset += batchSize;
    }
    this.customerMmid = rows;
  },

  // {group, entry} 쌍으로 평탄화한 목록 — 캘린더/검색에서 공통으로 사용
  flatEntries() {
    const list = [];
    this.groups.forEach((group) => {
      group.entries.forEach((entry) => list.push({ group, entry }));
    });
    return list;
  },

};

// 관리자 전용 — 선택한 여러 사용자의 데이터를 한 번에 불러와 그룹마다 소유자 이메일을 붙여서 반환
// (RLS의 is_admin() 예외 덕분에 관리자 계정은 본인 것이 아닌 user_id도 조회 가능)
async function loadGroupsForUsers(userIds, emailById) {
  if (userIds.length === 0) return [];

  const [groupsRes, travelersRes, entriesRes, entryTravelersRes] = await Promise.all([
    supabaseClient.from("groups").select("*").in("user_id", userIds).order("created_at"),
    supabaseClient.from("travelers").select("*").in("user_id", userIds).order("sort_order"),
    supabaseClient.from("entries").select("*").in("user_id", userIds),
    supabaseClient.from("entry_travelers").select("*").in("user_id", userIds),
  ]);

  for (const res of [groupsRes, travelersRes, entriesRes, entryTravelersRes]) {
    if (res.error) throw res.error;
  }

  const travelerById = new Map(travelersRes.data.map((t) => [t.id, toTraveler(t)]));

  const travelersByGroup = new Map();
  travelersRes.data.forEach((t) => {
    if (!travelersByGroup.has(t.group_id)) travelersByGroup.set(t.group_id, []);
    travelersByGroup.get(t.group_id).push(travelerById.get(t.id));
  });

  const travelersByEntry = new Map();
  entryTravelersRes.data.forEach((et) => {
    if (!travelersByEntry.has(et.entry_id)) travelersByEntry.set(et.entry_id, []);
    const traveler = travelerById.get(et.traveler_id);
    if (traveler) travelersByEntry.get(et.entry_id).push(traveler);
  });

  const entriesByGroup = new Map();
  entriesRes.data.forEach((e) => {
    const entry = toEntry(e, travelersByEntry.get(e.id));
    if (!entriesByGroup.has(e.group_id)) entriesByGroup.set(e.group_id, []);
    entriesByGroup.get(e.group_id).push(entry);
  });

  return groupsRes.data.map((g) => ({
    id: g.id,
    travelers: travelersByGroup.get(g.id) || [],
    entries: entriesByGroup.get(g.id) || [],
    assignee: g.assignee || "",
    memo: g.memo || "",
    ownerEmail: emailById.get(g.user_id) || "",
  }));
}

// 예전 개인용 버전에서 쓰던 localStorage에 데이터가 남아있으면(같은 브라우저 출처인 경우) 계정으로 옮길지 물어봄
async function maybeImportLocalData() {
  let raw;
  try {
    raw = localStorage.getItem(LOCAL_IMPORT_KEY);
  } catch (e) {
    return;
  }
  if (!raw) return;

  let localGroups;
  try {
    localGroups = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (!Array.isArray(localGroups) || localGroups.length === 0) return;

  const ok = confirm(
    `이 브라우저에 저장된 예전 일정 ${localGroups.length}건을 내 계정으로 가져올까요?\n가져온 뒤에는 이 브라우저의 예전 데이터는 정리돼요.`
  );
  if (!ok) return;

  for (const g of localGroups) {
    const parsed = {
      travelers: g.travelers.map((t) => ({ name: t.name, title: t.title || "", note: t.note || "" })),
      entries: g.entries.map((e) => ({
        date: e.date,
        flightNo: e.flightNo,
        depTime: e.depTime,
        arrTime: e.arrTime,
        seatClass: e.seatClass,
        status: e.status,
        memo: e.memo || "",
        travelers: (e.travelers || g.travelers).map((t) => ({ name: t.name })),
      })),
      assignee: g.assignee || "",
    };
    const { group: importedGroup } = await Store.addFromParsed(parsed);
    if (g.memo) await Store.updateGroupMemo(importedGroup.id, g.memo);
  }

  try {
    localStorage.removeItem(LOCAL_IMPORT_KEY);
  } catch (e) {
    /* 무시 */
  }
}
