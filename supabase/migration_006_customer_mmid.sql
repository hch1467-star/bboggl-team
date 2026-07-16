-- Bboggl-Team 마이그레이션 006 — 고객명 ↔ MMID(고객번호) 매핑
-- Supabase 프로젝트의 SQL Editor에서 이 파일 전체를 한 번 실행하세요. (스키마만 — 실제 데이터는 CSV로 임포트)
-- 고객 이름/고객번호도 개인정보라, 이 공개 저장소에는 데이터를 넣지 않고 DB에만 저장합니다.

create table if not exists customer_mmid (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mmid text not null
);

alter table customer_mmid enable row level security;

-- 로그인한 직원이면 누구나 조회 가능 (예약 텍스트 생성 시 MMID 자동 조회용)
drop policy if exists "customer_mmid_select_authenticated" on customer_mmid;
create policy "customer_mmid_select_authenticated" on customer_mmid for select
  using (auth.uid() is not null);

-- 추가/수정/삭제는 관리자만 (고객 마스터 데이터라 조회보다 더 좁게 제한)
drop policy if exists "customer_mmid_insert_admin" on customer_mmid;
create policy "customer_mmid_insert_admin" on customer_mmid for insert
  with check (public.is_admin());

drop policy if exists "customer_mmid_update_admin" on customer_mmid;
create policy "customer_mmid_update_admin" on customer_mmid for update
  using (public.is_admin());

drop policy if exists "customer_mmid_delete_admin" on customer_mmid;
create policy "customer_mmid_delete_admin" on customer_mmid for delete
  using (public.is_admin());

create index if not exists idx_customer_mmid_name on customer_mmid(name);
