/* ============================================
   Supabase 연결 설정
   Supabase 프로젝트를 만든 뒤 아래 두 값을 채워주세요.
   (Supabase 대시보드 → Project Settings → API 에서 확인 가능)
   ============================================ */

const SUPABASE_URL = "https://omiehytvfgfyebllpjbc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9taWVoeXR2ZmdmeWVibGxwamJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NTkyMzcsImV4cCI6MjA5OTUzNTIzN30.HHudCLoUXgv73xKTDuTuUXzp68DmtAxwr8d4uLqRMtE";

let supabaseClient = null;

if (
  typeof window.supabase !== "undefined" &&
  SUPABASE_URL.startsWith("http") &&
  SUPABASE_ANON_KEY &&
  SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY"
) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} else {
  console.warn("Supabase 설정이 비어있어요. js/supabaseClient.js에 URL과 anon key를 입력해주세요.");
}
