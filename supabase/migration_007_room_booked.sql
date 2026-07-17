-- "방 예약" 완료 여부를 그룹(예약) 단위로 저장하는 칸 추가.
-- SQL Editor에서 이 파일 내용만 한 번 실행하세요.

alter table groups add column if not exists room_booked boolean not null default false;
