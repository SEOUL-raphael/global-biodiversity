# Global Biodiversity

[대시보드 바로가기](https://seoul-raphael.github.io/global-biodiversity/)

GBIF 자료를 수집해 분류군, 관측 기록, 지역 통계와 지식 그래프를 탐색하는 대시보드입니다. React 대시보드, Express API, PostgreSQL 저장소, 선택적 Python Cognee 서비스가 pnpm workspace에 들어 있습니다.

## 구성

| 경로 | 역할 |
| --- | --- |
| `artifacts/dashboard` | 검색, 지도, 추세, 그래프와 AI 질의 화면 |
| `artifacts/api-server` | 데이터 조회, 수집 작업, MCP 및 AI API |
| `artifacts/cognee-service` | 선택적 Cognee 지식 그래프 서비스 |
| `lib/db` | Drizzle 스키마와 마이그레이션 |
| `lib/gbif-client` | GBIF REST API 클라이언트 |
| `scripts` | 데이터 적재 및 그래프 구축 도구 |

## 로컬 실행

Node.js 24, Corepack으로 제공되는 pnpm 10.28.2, PostgreSQL이 필요합니다. 데이터베이스 주소는 환경 변수로 전달하며 자격 증명을 저장소에 넣지 마세요.

```sh
pnpm install --frozen-lockfile
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DB'
export PORT=3000
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/api-server start
```

다른 터미널에서 화면을 실행합니다.

```sh
pnpm --filter @workspace/dashboard dev
```

대시보드 개발 서버의 기본 포트는 5173입니다. API가 다른 출처에 있으면 `VITE_API_ORIGIN`을 API 주소로 설정하세요. API 서버는 시작 후 DB 마이그레이션과 백그라운드 데이터 작업을 시도합니다. 기존 데이터베이스를 사용할 때는 작업 범위와 연결 대상을 확인하세요. Cognee 기능을 사용하려면 별도 Python 서비스를 실행하고 `COGNEE_SERVICE_URL`을 설정해야 합니다. 서비스가 없으면 해당 프록시 경로는 503을 반환합니다.

Windows PowerShell에서는 `export` 대신 `$env:DATABASE_URL = '...'`, `$env:PORT = '3000'` 형식을 사용합니다.
`pnpm` 명령을 찾지 못하면 `corepack enable pnpm`을 먼저 실행하세요.

## 확인

```sh
pnpm typecheck
pnpm build
```

API가 실행 중일 때 `GET /api`로 기본 응답을, `GET /api/gbif/status`로 저장된 자료의 수집 상태를 확인할 수 있습니다. 분류군 검색은 `GET /api/gbif/taxa?q=Panthera&limit=20`입니다. 검색 결과는 로컬 DB의 적재 상태에 따라 달라집니다.

## 데이터와 해석

원천 분류 및 관측 자료는 [GBIF](https://www.gbif.org/)에서 옵니다. 관측 건수는 조사 노력, 공개 범위, 중복과 위치 정확도의 영향을 받으므로 생물 개체수나 지역별 생물다양성의 직접적인 추정치로 해석하면 안 됩니다. 화면의 결과를 인용할 때는 원천 GBIF 기록과 해당 데이터셋의 인용·라이선스 조건을 확인하세요. AI 설명과 그래프 관계는 별도의 가공 결과이며 원천 기록을 대체하지 않습니다.

배포 및 기존 서비스 구성에 관한 메모는 [`replit.md`](replit.md)와 [`artifacts/api-server/CLOUDFLARE_WORKER.md`](artifacts/api-server/CLOUDFLARE_WORKER.md)를 참고하세요.
