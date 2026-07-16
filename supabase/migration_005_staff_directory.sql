-- Bboggl-Team 마이그레이션 005 — 담당자 사번/전화번호 디렉터리
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요. (스키마만 — 실제 데이터는 별도 INSERT로 넣습니다)
-- 이 저장소는 공개(public) GitHub 저장소라, 직원 이름/전화번호 같은 개인정보는
-- git에 올라가는 파일에 절대 넣지 않고 이렇게 DB에만 저장합니다.

create table if not exists staff_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text not null,
  employee_id text not null,
  phone text not null
);

alter table staff_directory enable row level security;

-- 로그인한 직원이면 누구나 조회 가능 (예약 텍스트 생성 시 담당자 조회용)
drop policy if exists "staff_directory_select_authenticated" on staff_directory;
create policy "staff_directory_select_authenticated" on staff_directory for select
  using (auth.uid() is not null);

-- 수정/삭제/추가는 관리자만 (개인정보라 조회보다 더 좁게 제한)
drop policy if exists "staff_directory_insert_admin" on staff_directory;
create policy "staff_directory_insert_admin" on staff_directory for insert
  with check (public.is_admin());

drop policy if exists "staff_directory_update_admin" on staff_directory;
create policy "staff_directory_update_admin" on staff_directory for update
  using (public.is_admin());

drop policy if exists "staff_directory_delete_admin" on staff_directory;
create policy "staff_directory_delete_admin" on staff_directory for delete
  using (public.is_admin());
