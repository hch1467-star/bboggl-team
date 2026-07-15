-- Bboggl-Team 마이그레이션 003 — 관리자(슈퍼 계정) 기능
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.

-- 계정별 프로필(이메일 캐시 + 관리자 여부). auth.users는 anon key로 직접 조회할 수 없어서
-- 관리자가 "가입된 직원 목록"을 볼 수 있으려면 이 테이블이 필요함.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false
);

alter table profiles enable row level security;

-- 신규 가입 시 auth.users에 자동으로 맞춰 profiles 행을 만들어줌
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 이미 가입되어 있던 계정들도 profiles에 채워넣기 (1회성 백필)
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;

-- 현재 로그인한 사용자가 관리자인지 확인하는 함수.
-- security definer로 만들어서 profiles의 RLS를 우회해 재귀 없이 체크할 수 있게 함.
create or replace function public.is_admin()
returns boolean as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$ language sql security definer stable;

-- profiles: 본인 행만 보임 + 관리자는 전체 조회 가능. 수정은 대시보드에서 직접(관리자 지정용).
create policy "profiles_select_own_or_admin" on profiles for select
  using (auth.uid() = id or public.is_admin());

-- groups/travelers/entries/entry_travelers: 기존 "본인 것만" select 정책에 관리자 예외 추가
-- (조회만 허용 — 다른 직원 데이터를 수정/삭제하는 건 여전히 막혀 있음)
drop policy if exists "groups_select_own" on groups;
create policy "groups_select_own_or_admin" on groups for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "travelers_select_own" on travelers;
create policy "travelers_select_own_or_admin" on travelers for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "entries_select_own" on entries;
create policy "entries_select_own_or_admin" on entries for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "entry_travelers_select_own" on entry_travelers;
create policy "entry_travelers_select_own_or_admin" on entry_travelers for select
  using (auth.uid() = user_id or public.is_admin());

-- ============================================
-- 이 아래는 관리자 계정을 만든 뒤 직접 실행하세요:
--
-- 1) login.html에서 관리자용 이메일로 회원가입을 한 번 진행
-- 2) 아래 UPDATE의 이메일을 그 계정으로 바꿔서 실행 (is_admin = true 로 승격)
--
-- update public.profiles set is_admin = true where email = '여기에_관리자_이메일';
-- ============================================
