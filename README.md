# 공대 분배 도우미

공대 분배 계산, 타이머, Discord 알림을 제공하는 툴입니다.

## 1. 전체 프로젝트 구조
```
├─ server.js                # Express API + Socket.IO 서버 엔트리
├─ discordBot.js            # Discord 연동
├─ public/                  # 정적 자원 (배포 대상)
│  ├─ index.html            # 랜딩(카스공대) 페이지
│  └─ timers.html/js        # 타이머 페이지와 로직
│  └─ style.css             # 공통 스타일
└─ timer_overlay/           # Python 멀티 타이머 오버레이
```

## 2. 서버 코드 개요
- **Express REST API**: 분배표/공대원/타이머 CRUD, 로그인 세션 관리, SSE 기반 타이머 동기화.
- **PostgreSQL 연동 (Supabase)**: `raid_distribution` DB 연동. `members`, `distributions`, `timers`, `timer_settings`, `admins` 테이블 사용.
- **Discord Bot**: `DISCORD_TOKEN` 설정 시 타이머/분배 알림 전송.

## 3. 클라이언트 코드 개요
- **랜딩 페이지(`index.html`)**: 분배표/타이머로 이동하는 진입점.
- **분배/타이머 페이지**: 기존 기능 유지, SSE로 타이머 실시간 갱신.

## 6. 실행 방법
1. 패키지 설치
   ```bash
   npm install
   ```
   - 네트워크 제약으로 설치가 실패할 수 있으니, 필요시 `socket.io`, `express`, `mysql2`, `dotenv`, `discord.js`를 수동으로 설치합니다.
2. 데이터베이스 준비 (기본값)
   - `.env` 파일을 생성하여 `DATABASE_URL` 등 설정
3. 서버 실행
   ```bash
   npm start
   ```
4. 브라우저 접속
   - 랜딩: `http://localhost:47984/`

   - 타이머: `http://localhost:47984/timers.html?channelCode=ca01` (예시)

## 7. 확장 아이디어
- 랭킹/전적 저장: 게임 종료 시 DB에 결과 기록 후 프로필/방 목록에 통계 표시.
- 관전자 상호작용: 실시간 리액션, 관전 채팅 분리, 진행 현황 미니맵.
- AI 플레이어 고도화: 위험도 기반 경로 선택, 잡기 우선 전략 등 알고리즘 교체 가능하도록 `gameLogic` 확장.
- 방 비밀번호/초대코드 강화: 일회용 초대 토큰, 대기열, 재접속 만료 시간 설정.
- 리플레이/로그 저장: 턴 로그를 JSON으로 내려받아 추후 검증/분석/리플레이 지원.

## 환경 변수

| 변수 | 설명 | 기본값 |
| ---- | ---- | ---- |
| `DB_HOST` | 데이터베이스 호스트 | `localhost` |
| `DB_PORT` | 데이터베이스 포트 | `3306` |
| `DB_USER` | 데이터베이스 사용자 | `root` |
| `DB_PASSWORD` | 데이터베이스 비밀번호 | `dito1121!` |
| `DB_NAME` | 데이터베이스 이름 | `raid_distribution` |
| `PORT` | 웹 서버 포트 | `47984` |
| `DISCORD_TOKEN` | Discord Bot 토큰 | 없음 |

## 멀티 타이머 오버레이 (Python)
Windows/macOS에서 동작하는 파이썬 기반 멀티 타이머 오버레이입니다. 글로벌 단축키로 타이머를 제어하고, 설정에서 서버 호스트/포트를 지정해 타이머 이벤트를 외부 서버로 전송할 수 있습니다.

### 설치
```bash
pip install -r requirements.txt
```

### 실행
```bash
python -m timer_overlay.main
```

최초 실행 시 `~/timer_overlay_config.json`이 생성되며, 서버 접속 정보와 타이머 정보를 백업/수정할 수 있습니다.
