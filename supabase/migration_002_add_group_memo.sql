-- 이미 schema.sql을 실행하신 기존 프로젝트에 memo 칸을 추가하는 마이그레이션.
-- SQL Editor에서 이 파일 내용만 한 번 실행하세요 (새 프로젝트라면 schema.sql만 실행해도 이미 포함되어 있어요).

alter table groups add column if not exists memo text default '';
