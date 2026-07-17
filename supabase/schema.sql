-- Bboggl-Team 스키마
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요.
-- (테이블 생성 + Row Level Security로 "내 데이터만 보임"을 DB 레벨에서 강제)

create extension if not exists pgcrypto;

-- 예약 그룹(파티) — 대표 고객 + 동행자들 + 담당자
create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignee text default '',
  memo text default '',
  room_booked boolean not null default false,
  created_at timestamptz not null default now()
);

-- 동행자(고객) — 한 그룹에 여러 명
create table if not exists travelers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  title text default '',
  note text default '',
  sort_order int not null default 0
);

-- 항공편 일정 — 한 그룹에 여러 건
create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  flight_no text not null,
  dep_time text not null,
  arr_time text not null,
  seat_class text not null,
  status text not null,
  memo text default '',
  created_at timestamptz not null default now()
);

-- 항공편 하나에 실제로 타는 동행자 조합 (그룹 전체가 아니라 일부만 타는 경우가 있어서 필요)
create table if not exists entry_travelers (
  entry_id uuid not null references entries(id) on delete cascade,
  traveler_id uuid not null references travelers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (entry_id, traveler_id)
);

alter table groups enable row level security;
alter table travelers enable row level security;
alter table entries enable row level security;
alter table entry_travelers enable row level security;

-- groups
create policy "groups_select_own" on groups for select using (auth.uid() = user_id);
create policy "groups_insert_own" on groups for insert with check (auth.uid() = user_id);
create policy "groups_update_own" on groups for update using (auth.uid() = user_id);
create policy "groups_delete_own" on groups for delete using (auth.uid() = user_id);

-- travelers
create policy "travelers_select_own" on travelers for select using (auth.uid() = user_id);
create policy "travelers_insert_own" on travelers for insert with check (auth.uid() = user_id);
create policy "travelers_update_own" on travelers for update using (auth.uid() = user_id);
create policy "travelers_delete_own" on travelers for delete using (auth.uid() = user_id);

-- entries
create policy "entries_select_own" on entries for select using (auth.uid() = user_id);
create policy "entries_insert_own" on entries for insert with check (auth.uid() = user_id);
create policy "entries_update_own" on entries for update using (auth.uid() = user_id);
create policy "entries_delete_own" on entries for delete using (auth.uid() = user_id);

-- entry_travelers
create policy "entry_travelers_select_own" on entry_travelers for select using (auth.uid() = user_id);
create policy "entry_travelers_insert_own" on entry_travelers for insert with check (auth.uid() = user_id);
create policy "entry_travelers_update_own" on entry_travelers for update using (auth.uid() = user_id);
create policy "entry_travelers_delete_own" on entry_travelers for delete using (auth.uid() = user_id);

-- 조회 성능용 인덱스
create index if not exists idx_groups_user on groups(user_id);
create index if not exists idx_travelers_group on travelers(group_id);
create index if not exists idx_entries_group on entries(group_id);
create index if not exists idx_entries_user_date on entries(user_id, date);
create index if not exists idx_entry_travelers_entry on entry_travelers(entry_id);
