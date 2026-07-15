/* ============================================
   인증 가드 — 로그인 안 되어 있으면 login.html로 이동
   ============================================ */

let CurrentUser = null; // { id, email }

async function requireSession() {
  if (!supabaseClient) {
    console.warn("Supabase 연동이 아직 설정되지 않았어요. js/supabaseClient.js에 URL/anon key를 입력해주세요.");
    window.location.href = "login.html";
    return null;
  }

  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  CurrentUser = { id: session.user.id, email: session.user.email };
  return session;
}

async function checkIsAdmin(userId) {
  const { data, error } = await supabaseClient.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (error) {
    console.warn("관리자 여부를 확인하지 못했어요:", error);
    return false;
  }
  return !!(data && data.is_admin);
}

async function logout() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  window.location.href = "login.html";
}

function wireLogoutButton() {
  const btn = document.getElementById("logout-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (confirm("로그아웃할까요?")) logout();
  });
  const emailEl = document.getElementById("current-user-email");
  if (emailEl && CurrentUser) emailEl.textContent = CurrentUser.email;
}
