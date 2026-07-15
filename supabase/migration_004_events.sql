-- Bboggl-Team 마이그레이션 004 — 공용 이벤트(주말 행사 등) 기능
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다.

-- 이벤트는 고객 일정과 달리 "직원 전체가 공통으로 보는" 정보라 user_id로 분리하지 않음
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  memo text default '',
  created_at timestamptz not null default now()
);

alter table events enable row level security;

-- 로그인한 직원이면 누구나 조회/추가/수정/삭제 가능 (공용 정보이므로 user_id 제한 없음)
drop policy if exists "events_select_all" on events;
create policy "events_select_all" on events for select
  using (true);

drop policy if exists "events_insert_authenticated" on events;
create policy "events_insert_authenticated" on events for insert
  with check (auth.uid() is not null);

drop policy if exists "events_update_authenticated" on events;
create policy "events_update_authenticated" on events for update
  using (auth.uid() is not null);

drop policy if exists "events_delete_authenticated" on events;
create policy "events_delete_authenticated" on events for delete
  using (auth.uid() is not null);

create index if not exists idx_events_date on events(date);
