-- Bboggl-Team 마이그레이션 008 — 이벤트에 계정별 개인 메모 남기기
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다.

-- events는 직원 전체가 공통으로 보는 정보지만, 이 메모는 각자 자기 계정에만 보이는 개인 메모
create table if not exists event_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  memo text default '',
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

alter table event_notes enable row level security;

-- 자기 메모만 보이고/쓰고/고치고/지울 수 있음 (다른 직원의 개인 메모는 안 보임)
drop policy if exists "event_notes_select_own" on event_notes;
create policy "event_notes_select_own" on event_notes for select
  using (user_id = auth.uid());

drop policy if exists "event_notes_insert_own" on event_notes;
create policy "event_notes_insert_own" on event_notes for insert
  with check (user_id = auth.uid());

drop policy if exists "event_notes_update_own" on event_notes;
create policy "event_notes_update_own" on event_notes for update
  using (user_id = auth.uid());

drop policy if exists "event_notes_delete_own" on event_notes;
create policy "event_notes_delete_own" on event_notes for delete
  using (user_id = auth.uid());

create index if not exists idx_event_notes_event on event_notes(event_id);
