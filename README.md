# 공대 분배 도우미 & 실시간 멀티플레이 윷놀이

공대 분배 계산, 타이머, Discord 알림과 더불어 **브라우저 기반 실시간 멀티플레이 윷놀이**를 제공하는 올인원 툴입니다.

## 1. 전체 프로젝트 구조
```
├─ server.js                # Express API + Socket.IO 서버 엔트리
├─ discordBot.js            # Discord 연동
├─ public/                  # 정적 자원 (배포 대상)
│  ├─ index.html            # 랜딩(카스공대) 페이지
│  ├─ distribution.html     # 분배표 페이지
│  ├─ timers.html           # 타이머 페이지
│  ├─ yut.html / yut.js     # 실시간 윷놀이 클라이언트
│  └─ style.css / yut.css   # 공통/윷 스타일
├─ yut/                     # 서버 측 윷놀이 모듈
│  ├─ gameLogic.js          # 말 이동/윷 결과/경로 계산
│  └─ roomManager.js        # 방, 플레이어, 턴/동기화 관리
└─ timer_overlay/           # Python 멀티 타이머 오버레이
```

## 2. 서버 코드 개요
- **Express REST API**: 분배표/공대원/타이머 CRUD, 로그인 세션 관리, SSE 기반 타이머 동기화.
- **MySQL 연동**: `raid_distribution` DB 자동 생성 및 마이그레이션. `members`, `distributions`, `timers`, `timer_settings`, `admins` 테이블 사용.
- **Socket.IO (실시간)**: `/yut.html`에서 사용하는 방 생성/입장, 턴 처리, 채팅, 더미(봇) 플레이어 자동 진행.
- **Discord Bot**: `DISCORD_TOKEN` 설정 시 타이머/분배 알림 전송.

## 3. 클라이언트 코드 개요
- **랜딩 페이지(`index.html`)**: 분배표/타이머/윷놀이로 이동하는 진입점.
- **분배/타이머 페이지**: 기존 기능 유지, SSE로 타이머 실시간 갱신.
- **윷놀이(`yut.html`, `yut.js`, `yut.css`)**
  - 방 목록/생성/입장(비밀번호/관전자), 준비/시작/재시작, 더미 플레이어 추가.
  - 보드 렌더링(SVG 경로 + 토큰 레이어), 대각선 우선 이동 토글, 빽도 옵션 표시.
  - 채팅, 시스템 로그, 현재 턴/잔여 던지기 횟수 표시, 사운드 온/오프.
  - 모바일 대응(반응형 레이아웃) 및 말 클릭/터치 이동.

## 4. 윷 로직 알고리즘
- **던지기**: 도/개/걸/윷/모/빽도(옵션) 무작위, 윷/모/잡기 성공 시 추가 던지기 기회 부여.
- **보드 그래프**: `START → O1~O19 → END`, 5·10 지점 분기(`D1/D3` 경로→CENTER→O15 이후 합류), `advancePosition`가 분기/역주행(빽도) 유효성 체크.
- **이동 규칙**:
  - 말 4개 기본(설정 가능), 같은 칸에 모이면 업기 이동.
  - END는 초과 이동 불가(정확히 도착해야 완주).
  - 잡기 시 상대 말 START로 복귀 + 추가 던지기.
  - 이동 불가 결과는 서버가 검증하며, 필요 시 결과 소진(`yut:skip`).
- **서버 권한**: 모든 주사위(윷) 결과/이동 검증/승리 판정은 서버가 수행, 클라이언트는 요청만 전송.

## 5. 멀티 동기화 흐름
1. **방 생성/입장** → Socket.IO room join, 전체 클라이언트에 방 목록 갱신.
2. **준비/시작** → 호스트가 모든 인원 준비 확인 후 게임 시작, 턴 순서/말 초기화 브로드캐스트.
3. **턴 진행**
   - `yut:roll` → 서버가 윷 결과 생성, 보너스 처리, pending 결과 큐를 전체에 전파.
   - `yut:move` → 서버가 경로/충돌/업기/잡기/완주 판정 후 상태 업데이트.
   - `yut:skip` → 이동 불가 검증 후 결과 소진.
4. **재접속** → 저장된 playerId/roomId로 `yut:join` 시 동일 좌석 복구.
5. **봇(더미)** → 현재 턴이 봇이면 서버가 자동으로 던지기/이동 수행.

## 6. 실행 방법
1. 패키지 설치
   ```bash
   npm install
   ```
   - 네트워크 제약으로 설치가 실패할 수 있으니, 필요시 `socket.io`, `express`, `mysql2`, `dotenv`, `discord.js`를 수동으로 설치합니다.
2. 데이터베이스 준비 (기본값)
   - `DB_HOST=localhost`, `DB_USER=root`, `DB_PASSWORD=dito1121!`, `DB_PORT=3306`, `DB_NAME=raid_distribution`
3. 서버 실행
   ```bash
   npm start
   ```
4. 브라우저 접속
   - 랜딩: `http://localhost:47984/`
   - 윷놀이: `http://localhost:47984/yut.html`
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
