# Go collaboration service

Go 1.24+ and PostgreSQL 15+ are required. This service is the shared source of project state; desktop and host plugins use the same authenticated REST API.

## Run

Set `IO_DATABASE_URL` and `IO_ADMIN_TOKEN` (at least 16 characters) in the environment, then run `go run ./cmd/server`. The root development scripts load the project's `.env`. `IO_ADDR` defaults to `127.0.0.1:17890`.

Startup applies the idempotent initial schema under a transaction-scoped migration lock, then creates/updates the local bootstrap administrator's hashed token. Changing `IO_ADMIN_TOKEN` invalidates its previous token. Never commit `.env` or distribute the administrator credential to member plugins.

`GET /health` checks PostgreSQL readiness. All `/api/*` routes require `Authorization: Bearer <token>`. Member tokens are random, shown once when created and stored as SHA-256 hashes. Deactivation revokes the member, after current responsibilities have been transferred. This pilot uses invitation tokens; enterprise SSO, token rotation UI and recovery are not implemented.

## Modules

- `cmd/server`: environment configuration, HTTP server and graceful shutdown.
- `internal/platform/projects.go`: directory, projects and node membership.
- `tasks.go`, `memories.go`: task transitions, memory baselines and version history.
- `workflows.go`: issues, atomic responsibility handover and clean project reuse.
- `usage.go`: authenticated attribution and idempotent request accounting.
- `conversations.go`, `messages.go`: channels, private chats, chronological cursors, unread counts, monotonic receipts and explicit draft promotion.
- `notifications.go`: transactional recipient-only action notices, filtered by current project access.
- `store.go`: PostgreSQL initial schema, persistence and project transaction boundary.
- `platform_test.go`: real PostgreSQL integration tests with isolated temporary schemas.

The public API contract is `../../docs/api-contract.md`.

## Consistency and authorization

Project mutations lock that project's row before checking versions and writing dependent entities. Memory publication cannot interleave with submission or acceptance in the same project. Task and memory updates use explicit expected versions. Editing review criteria or task content invalidates the current review; syncing a new memory baseline requires resubmission. A designated reviewer can return a submitted task to in_progress without gaining general edit or assignment permissions; this records a task.returned event. Completed task ownership, event authors and usage attribution are retained during handover. Project reuse copies task titles and acceptance templates, clearing descriptions, execution state and people; selected memories become source-cited drafts.

Member assignments lock their member rows, coordinating with deactivation. Request accounting additionally locks a member/host/request key so duplicate reports across projects conflict safely. Input tokens include cached input; do not add cacheReadTokens to inputTokens again. Costs carry a source and currency; aggregators must keep currencies and reported/estimated amounts separate.

Direct/group conversations require participant membership, including for administrators. Public channels use current project access. Messages are ordered by database sequence, and read cursors only advance. Chat is never automatically included in AI context. Promotion creates a source-cited draft; private-chat promotion requires the message author, and formal publication uses ordinary project/node permissions.

Communication clients should poll every 3 seconds while visible and refetch durable history after reconnecting. There is no SSE endpoint, external notification delivery or DingTalk integration in this release. Receipts indicate message reading, not acceptance of a task or decision. Task assignment, submission, return, issue assignment, handover and affected memory changes create durable recipient-only notifications in the same transaction. GET /api/notifications shows the current member’s latest 200 accessible notices. Marking one read never accepts the underlying task, issue or handover.

The first schema stores separately indexed entity payloads as JSONB with relational project keys. This is a pilot schema, not a full enterprise audit/event warehouse; future schema changes should be added as numbered migrations rather than modifying deployed history.

## Verify

`go test ./...` and `go vet ./...` run without external dependencies, but integration tests skip unless `IO_TEST_DATABASE_URL` is set. Run `IO_TEST_DATABASE_URL=<dedicated test DB URL> go test -race -count=1 -v ./...` for the real PostgreSQL checks.

Tests create randomly named `iotest_*` schemas and remove only those schemas on cleanup; they do not truncate production tables. The database role needs schema creation privileges. Covered rules include stale memory rejection at submission/acceptance, concurrency CAS, transfer/reuse invariants, authentication revocation, duplicate accounting across projects, private-chat administrator isolation, scope validation, cursor pagination and monotonic receipts.
