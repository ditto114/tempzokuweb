-- Supabase에서 1회 실행: 공대(guild) 단위 데이터 분리 + 비밀번호 갱신 + 힐링공대 계정 추가
-- 주의: setup-sessions.sql 이 이미 실행된 상태여야 합니다.

BEGIN;

-- 1) admins 에 guild 컬럼 추가, 기존 cass는 'cass' 길드로 지정
ALTER TABLE admins ADD COLUMN IF NOT EXISTS guild TEXT;
UPDATE admins SET guild = 'cass' WHERE username = 'cass' AND guild IS NULL;
ALTER TABLE admins ALTER COLUMN guild SET NOT NULL;

-- 2) 기존 데이터는 전부 카스공대 소속으로 태그 (DEFAULT 'cass' 로 기존 row 채움)
ALTER TABLE distributions ADD COLUMN IF NOT EXISTS guild TEXT NOT NULL DEFAULT 'cass';
ALTER TABLE members ADD COLUMN IF NOT EXISTS guild TEXT NOT NULL DEFAULT 'cass';

CREATE INDEX IF NOT EXISTS distributions_guild_idx ON distributions(guild);
CREATE INDEX IF NOT EXISTS members_guild_idx ON members(guild);

-- 3) sessions 에도 guild 캐싱 (매 요청 admins 조인 없이 바로 스코프 결정)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS guild TEXT;

-- 4) 카스공대 비밀번호 9799 → 1121 (sha256)
UPDATE admins
   SET password_hash = '3958de59a1ae60b4330e99d6a5b791897717cdd2347260d0f71df22d60b01062'
 WHERE username = 'cass';

-- 5) 힐링공대 계정 신규 생성 (비밀번호 9799, guild = 'healing')
INSERT INTO admins (username, password_hash, guild)
VALUES ('healing', '7a2f77d66990586ab9e7b587f35732acef3c399700976be689dfe354123a2d14', 'healing')
ON CONFLICT (username) DO NOTHING;

COMMIT;
