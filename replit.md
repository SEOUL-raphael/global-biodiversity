# GBIF Biodiversity Knowledge Platform

## Overview

pnpm workspace monorepo — GBIF(Global Biodiversity Information Facility) 데이터 기반 생물다양성 지식 그래프 플랫폼.
생물종 데이터를 GBIF API에서 수집해 PostgreSQL에 저장하고, 지식 그래프와 인사이트 API를 제공한다.
Cognee KG 엔진(LanceDB 벡터 스토어 + Kuzu 그래프 DB + FastEmbed 임베딩) + MCP 서버 운영 중.

## Architecture

```
artifacts/api-server/     Express API 서버 (포트: PORT env) — /api/* + /mcp
artifacts/cognee-service/ Cognee KG + MCP 서비스 (Python FastAPI, 포트 5000)
artifacts/mockup-sandbox/ Canvas 목업 샌드박스
lib/db/                   Drizzle ORM 스키마 + 마이그레이션 + 그래프 쿼리 헬퍼
lib/gbif-client/          GBIF REST API 클라이언트 (rate-limited)
lib/api-spec/             OpenAPI 3.1 스펙 (orval codegen 소스)
lib/api-client-react/     React Query hooks (codegen 생성)
lib/api-zod/              Zod validation schemas (codegen 생성 + 수동 추가)
scripts/                  CLI 스크립트 (seed-gbif, seed-occurrences, build-knowledge-graph 등)
```

## Database Schema

### GBIF 수집 테이블
- `gbif_taxa` — 분류군(kingdom→species 계층, self-referencing parent_key), IUCN status, num_occurrences
- `gbif_occurrences` — 발생 레코드(위경도·국가·연도)
- `gbif_regions` — 국가별 발생·종 통계
- `gbif_sync_log` — 수집 작업 로그 + checkpoint

### 지식 그래프 테이블
- `gbif_kg_nodes` — KG 노드 (TAXON|REGION|THREAT|HABITAT, properties JSONB)
- `gbif_kg_edges` — KG 엣지 (CLASSIFIED_AS|CO_OCCURS_WITH|INHABITS|THREATENED_BY, weight)

## API Endpoints

### GBIF 데이터
- `GET /api/gbif/status` — 수집 상태 + 통계
- `GET /api/gbif/taxa` — 분류군 검색 (q, rank, kingdom, iucnStatus 필터)
- `GET /api/gbif/taxa/:taxonKey` — 분류군 상세
- `GET /api/gbif/occurrences` — 발생 레코드 검색
- `GET /api/gbif/regions` — 지역별 통계

### 지식 그래프 인사이트 (PostgreSQL 기반)
- `GET /api/kg/stats` — KG 노드/엣지 수 통계
- `GET /api/kg/species/:taxonKey/context` — n-hop 그래프 컨텍스트
- `GET /api/kg/insights/cooccurrence` — 공존 종 클러스터 (Jaccard 유사도)
- `GET /api/kg/insights/endangered-hotspots` — 멸종위기 종 핫스팟 지역
- `GET /api/kg/insights/taxonomy-gap` — 발생 데이터 공백 분류군

### Cognee KG (LanceDB + Kuzu 기반, FastEmbed 임베딩)
- `GET /api/cognee/status` — 적재 상태 + 노드/엣지 수 (21k+ nodes, 61k+ edges)
- `GET /api/cognee/search?q=` — 시맨틱 벡터 검색 (BAAI/bge-small-en-v1.5)
- `GET /api/cognee/graph/species/{taxonKey}` — 분류군 그래프 컨텍스트

### MCP (Model Context Protocol)
- `GET /mcp` — MCP 서버 메타데이터 + 툴 목록
- `POST /mcp` — JSON-RPC 2.0 엔드포인트
  - `initialize` — 핸드셰이크
  - `tools/list` — 툴 목록 (search_species, get_relationships, find_hotspots)
  - `tools/call` — 툴 실행

### AI 자연어 질의 (MiniMax-M2.7)
- `POST /api/ai/ask` — 자연어 질문 → MCP 툴 자동 호출 → 자연어 답변
- `GET /api/ai/status` — AI 서비스 구성 상태

## Cognee KG Service (artifacts/cognee-service/)

### 파일 구조
```
main.py       FastAPI 앱 + 엔드포인트 + _cognee_search()
loader.py     GbifCogneeLoader — GBIF API 12k+ taxa fetch → Cognee ingestion
models.py     GBIFTaxon + TaxonomicRankNode DataPoint 서브클래스
mcp_server.py MCP JSON-RPC 라우터 (search_species, get_relationships, find_hotspots)
```

### Cognee 설정
- 임베딩: FastEmbed BAAI/bge-small-en-v1.5 (384-dim, 로컬, API 키 불필요)
- 벡터 스토어: LanceDB (로컬 파일, /tmp/cognee_system)
- 그래프 DB: Kuzu (임베디드, /tmp/cognee_system)
- 인제스천: `add_data_points()` (LLM 없음)

### 적재 데이터 (서비스 시작 시 ~9분 소요)
- GBIF backbone 12,099개 분류군
- TaxonomicRankNode 9,292개 (kingdom/phylum/class/order/family/genus)
- 총 21,391 노드, 61,280 엣지
- 벡터 컬렉션: GBIFTaxon_description, TaxonomicRankNode_description

## Stack

- **Monorepo**: pnpm workspaces
- **Runtime**: Node.js 24 (API), Python 3.11 (Cognee)
- **API**: Express 5 + pino 로깅
- **Cognee KG**: FastAPI + cognee==1.0.3 + fastembed + lancedb + kuzu
- **DB**: PostgreSQL + Drizzle ORM
- **Validation**: Zod v4, drizzle-zod
- **Codegen**: Orval (OpenAPI → React Query hooks + Zod schemas)
  - **알려진 이슈**: orval codegen이 @scalar/json-magic YAML 로더 실패로 동작하지 않음.
    generated 파일들은 git에서 복원 또는 수동 작성. api-server 빌드 자체는 정상 동작.
- **Build**: esbuild
- **MCP**: HTTP JSON-RPC 2.0 (Express + Python FastAPI 이중 구조)
- **AI**: MiniMax-M2.7 (OpenAI-compatible API, baseURL: https://api.minimaxi.chat/v1, OPENAI_API_KEY + OPENAI_BASE_URL 환경변수)

## Deployment (프로덕션)

- **방식**: Autoscale (min 0 → 요청 없을 때 슬립, 요청 시 자동 기동)
- **머신**: 1 vCPU / 0.5 GiB RAM (19 compute units/sec)
- **URL**: https://global-biodiversity.replit.app/dashboard/
- **예상 비용**: ~$1~5/월 (트래픽 기반 과금)

### 백그라운드 수집 (프로덕션 환경변수)

| 변수 | 값 | 의미 |
|---|---|---|
| `BG_INGEST_MAX_TICKS_PER_DAY` | `200` | 하루 최대 200틱(~600종) 발생 레코드 수집 |
| `BG_ENRICH_MAX_PER_DAY` | `500` | 하루 최대 500종 Wikipedia 설명·임베딩 보강 |

- 서버가 Autoscale 슬립 상태일 때는 수집 중단, 요청 유입 시 재개
- 수집 자체는 무료 (GBIF 공개 API + 로컬 임베딩 모델)

### DB 커넥션 풀

- `max: 3`, `idleTimeoutMillis: 5_000` — 유휴 연결 빠르게 해제 → Neon DB 컴퓨팅 슬립 촉진

## Key Commands

```bash
# 개발
pnpm run typecheck                              # 전체 타입체크
pnpm --filter @workspace/api-spec run codegen  # API 코드 재생성 (현재 비동작)
pnpm --filter @workspace/db run push           # DB 스키마 적용 (dev)

# 수동 데이터 적재 (필요 시)
pnpm --filter @workspace/scripts run seed-gbif-targeted  # GBIF 핵심 종 데이터 수집
pnpm --filter @workspace/scripts run seed-occurrences    # 발생 레코드 수집
pnpm --filter @workspace/scripts run update-regions      # 국가별 통계 업데이트
pnpm --filter @workspace/scripts run build-knowledge-graph # KG 노드/엣지 구축

# Cognee 서비스 (dev 전용, 프로덕션 미배포)
cd artifacts/cognee-service && PORT=5000 python3 main.py

# 유틸리티
pnpm --filter @workspace/scripts run fix-sync-logs       # stale 동기화 로그 정리
```

## Data Status (마지막 수집 — 2026-05-03, 초기 수집 완료)

- taxa: 89,891개 (Animalia + Plantae + Fungi 등 다계) — 초기 수집 완료
- occurrences: 42,795개 (Animalia 종 발생 레코드, 좌표 포함) — 증분 수집 진행 중
- regions: 164개 국가/지역 (Occurrence Trends 필터: 152개국 연도별 데이터 보유)
- Cognee KG: 21,391 노드, 61,280 엣지 (LanceDB + Kuzu, dev 전용)
- PostgreSQL KG nodes: 90,064개 (TAXON 89,891 + REGION 164 + THREAT 9)
- KG edges: 21,261개 (THREATENED_BY 8,831 + INHABITS 6,835 + CO_OCCURS_WITH 5,595)

## AI Notes

- MiniMax-M2.7 tool_call 사이클은 Round1(~16s) + Round2(~9s) ≈ 총 25초 소요
- OpenAI 클라이언트에 `timeout: 90_000` (90s) 설정 필수
- `/api/ai/ask` 요청 시 클라이언트도 90초 이상 대기해야 함

## Roadmap

- **완료**: 지식 그래프 API (nHopNeighbors, co-occurrence, endangered hotspots, taxonomy gaps)
- **완료**: GBIF 데이터 적재 스크립트 (seed-gbif-targeted, seed-occurrences, update-regions)
- **완료**: MCP 서버 (TypeScript, Express 통합, JSON-RPC 2.0) + Cognee KG + MCP Python 서비스
- **완료**: AI 자연어 질의 (MiniMax-M2.7, tool-call 루프, 90s 타임아웃)
- **완료**: React 프론트엔드 (종 검색, KG 시각화, 인사이트 대시보드, 7개 언어)
- **완료**: Autoscale 배포 전환 + 비용 최적화 (DB 풀 축소, 수집 캡 조정)
