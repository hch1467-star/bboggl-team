-- "리무진 예약" 완료 여부를 그룹(예약) 단위로 저장하는 칸 추가. (방 예약 room_booked와 같은 방식)
-- Supabase 대시보드 > SQL Editor 에서 이 파일 내용만 한 번 실행하세요.
-- 여러 번 실행해도 안전합니다.

alter table groups add column if not exists limo_booked boolean not null default false;
