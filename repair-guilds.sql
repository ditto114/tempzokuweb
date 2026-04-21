-- 데이터 무결성 점검 + 복구 (안전하게 여러 번 실행 가능)
--
-- 사용 맥락: setup-guilds.sql 이 부분적으로만 적용되었거나
-- 기존 rows 에 guild 값이 채워지지 않은 경우를 되살리기 위함.
--
-- Supabase SQL Editor에서 실행하세요.

BEGIN;

-- (A) 점검: 현재 상태 확인용 조회
-- 실행 후 결과 탭에서 분포를 한 번 눈으로 확인하세요.
SELECT 'admins_before' AS label, username, guild FROM admins ORDER BY username;
SELECT 'distributions_before' AS label, guild, COUNT(*) AS n
  FROM distributions GROUP BY guild ORDER BY guild NULLS FIRST;
SELECT 'members_before' AS label, guild, COUNT(*) AS n
  FROM members GROUP BY guild ORDER BY guild NULLS FIRST;

-- (B) admins.guild 보정
-- cass 계정은 반드시 guild='cass' 여야 함
UPDATE admins SET guild = 'cass'
 WHERE username = 'cass' AND (guild IS NULL OR guild <> 'cass');

-- healing 계정이 있다면 guild='healing' 로 보정 (있을 때만)
UPDATE admins SET guild = 'healing'
 WHERE username = 'healing' AND (guild IS NULL OR guild <> 'healing');

-- guild 컬럼이 아직 NOT NULL 이 아닐 경우 강제 NOT NULL 로
ALTER TABLE admins ALTER COLUMN guild SET NOT NULL;

-- (C) distributions 보정
-- NULL guild 는 모두 기존 카스공대 소속으로 간주 (힐링공대 도입 이전 데이터)
UPDATE distributions SET guild = 'cass' WHERE guild IS NULL;

-- 혹시 컬럼이 NULL 허용으로 잘못 만들어져 있으면 NOT NULL 로 교정
ALTER TABLE distributions ALTER COLUMN guild SET NOT NULL;

-- 기본값도 재확인 (향후 수동 INSERT 시 안전망)
ALTER TABLE distributions ALTER COLUMN guild SET DEFAULT 'cass';

-- (D) members 보정
UPDATE members SET guild = 'cass' WHERE guild IS NULL;
ALTER TABLE members ALTER COLUMN guild SET NOT NULL;
ALTER TABLE members ALTER COLUMN guild SET DEFAULT 'cass';

-- (E) sessions 는 진행 중 세션들이 guild 가 없을 수 있으므로 일괄 삭제 → 재로그인 유도
--     (서비스 중단 없이 세션만 끊음)
DELETE FROM sessions WHERE guild IS NULL OR guild = '';

-- (F) 인덱스 보장
CREATE INDEX IF NOT EXISTS distributions_guild_idx ON distributions(guild);
CREATE INDEX IF NOT EXISTS members_guild_idx ON members(guild);

-- (G) 최종 확인
SELECT 'admins_after' AS label, username, guild FROM admins ORDER BY username;
SELECT 'distributions_after' AS label, guild, COUNT(*) AS n
  FROM distributions GROUP BY guild ORDER BY guild;
SELECT 'members_after' AS label, guild, COUNT(*) AS n
  FROM members GROUP BY guild ORDER BY guild;

COMMIT;
