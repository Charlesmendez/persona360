# AGENTS.md

This file is for humans or coding agents landing in the repository and needing a fast, accurate map of the system.

## What This Project Is

`persona360` is a monorepo for a CLI-first relationship memory graph.

Core idea:

- store people, companies, interactions, intros, opportunities, and leads
- keep graph relationships as first-class data
- make the CLI safe for AI agents through JSON I/O and explicit stage commands
- open graph/card visualizations from the CLI

## Monorepo Layout

```text
apps/
  cli/
  viewer/
packages/
  contracts/
  domain/
  db/
  graph/
  ai/
docs/
examples/
scripts/
```

Rules of the repo:

- `apps/*` are runnable entrypoints only
- `packages/*` are reusable libraries
- `packages/contracts` is the source of truth for data shapes
- `packages/domain` owns business rules
- `packages/db` owns persistence
- `packages/graph` owns path ranking and neighborhood logic
- `packages/ai` is optional intelligence, not the authority on correctness

## How It Works

### 1. CLI

Main file:

- `apps/cli/src/index.ts`

What it does:

- parses commands with `commander`
- reads JSON from `--stdin` or `--file`
- calls `PersonaService`
- prints structured JSON with `--json`
- bundles and opens the local viewer for `graph --open` or `card --open`

Important implementation detail:

- viewer opening is done by bundling `apps/viewer/src/main.tsx` with `esbuild` into a self-contained HTML file under `.persona360/tmp`

### 2. Contracts

Main file:

- `packages/contracts/src/index.ts`

What it contains:

- Zod schemas for core entity inputs
- stage definition and stage transition schemas
- graph viewer payload schemas
- extracted proposal schema for AI
- JSON schema export helper via `getCommandJsonSchemas()`

If a command or package needs a payload shape, it should come from here first.

### 3. Domain

Main file:

- `packages/domain/src/index.ts`

This is the application layer.

Important class:

- `PersonaService`

Key responsibilities:

- initialize the project and run migrations
- upsert people and companies
- add interactions, tasks, intros, opportunities, leads, and observations
- define and list stages
- set stages with audit trail + stage history
- build person/company card responses
- build graph neighborhood payloads
- merge people
- apply extracted AI proposals safely

This is where the business rules live.

Examples:

- when a person gets a `current_company_id`, domain creates a `WORKS_AT` edge
- when an opportunity is created, domain creates the company/opportunity edge
- when a stage changes, domain validates it against `stage_definitions` first

### 4. Database

Main files:

- `packages/db/src/index.ts`
- `packages/db/migrations/0001_initial.sql`

Key responsibilities:

- resolve DB config from env or `persona360.config.json`
- default to local SQLite
- support Postgres via `DATABASE_URL`
- create the database adapter
- run migrations
- expose persistence primitives used by the domain layer

Important tables:

- `people`
- `companies`
- `contact_points`
- `interactions`
- `tasks`
- `intros`
- `opportunities`
- `leads`
- `evidence`
- `observations`
- `facts`
- `edges`
- `edge_evidence`
- `stage_definitions`
- `stage_history`
- `audit_events`

Why the schema is shaped this way:

- records are stored as normal entities
- graph relationships are stored in `edges`
- explainability is stored in `evidence`, `observations`, and `edge_evidence`
- stage control is stored separately through `stage_definitions` and `stage_history`

### 5. Graph Package

Main file:

- `packages/graph/src/index.ts`

Responsibilities:

- edge weighting
- staleness detection
- path ranking
- graph payload building
- card payload building

Important functions:

- `edgeWeight()`
- `rankPaths()`
- `buildGraphViewPayload()`
- `buildCardViewPayload()`

Path ranking uses:

- confidence
- strength
- recency
- hop penalty

### 6. AI Package

Main file:

- `packages/ai/src/index.ts`

Responsibilities:

- extract structured proposals from messy text
- optionally use Ollama if configured
- fall back to deterministic heuristics when no model is present
- build simple query plans from natural-language input

Important functions:

- `extractProposalFromText()`
- `planQueryFromText()`

The AI package should not directly write to the DB.
It only produces structured proposals or plans.
The domain layer decides what is valid and how it gets applied.

### 7. Viewer

Main files:

- `apps/viewer/src/main.tsx`
- `apps/viewer/src/App.tsx`
- `apps/viewer/src/styles.css`

What it does:

- renders graph explorer mode
- renders person/company card mode
- uses `cytoscape` for graph drawing
- uses local boot payload injected by the CLI

Important viewer behavior:

- graph mode shows a searchable neighborhood
- card mode shows identity, relationships, and timeline
- the viewer is local and self-contained

## Security Model

Important defaults already built into the code or the flow:

- imported text is treated as untrusted evidence
- AI output is structured before apply
- stage changes must use known stage keys
- agent writes can be audited with actor/source/reason
- the viewer does not depend on remote scripts
- the CLI uses explicit args instead of shell interpolation for local opening

If you extend this project, preserve these rules.

## Important Runtime Files

- `persona360.config.json`
  - local config written by `persona init`
- `.persona360/persona.db`
  - default SQLite database
- `.persona360/tmp/*.html`
  - temporary viewer artifacts created by `--open`

## Useful Commands

Install and build:

```bash
pnpm install
pnpm setup:native
pnpm build
```

Initialize local DB:

```bash
pnpm persona init --json
```

Run tests:

```bash
pnpm test
```

Typecheck:

```bash
pnpm typecheck
```

Open a graph:

```bash
pnpm persona graph company <company_id> --open --json
```

## Where To Start If You Need To Change Something

If you need to change data shape:

- start in `packages/contracts/src/index.ts`
- then update `packages/domain/src/index.ts`
- then update persistence in `packages/db/src/index.ts` if needed

If you need to change graph behavior:

- start in `packages/graph/src/index.ts`
- then update domain neighborhood or path use sites

If you need to change CLI behavior:

- start in `apps/cli/src/index.ts`

If you need to change viewer behavior:

- start in `apps/viewer/src/App.tsx`

If you need to change extraction behavior:

- start in `packages/ai/src/index.ts`

## Current Constraints

Things intentionally simplified in v1:

- no Gmail/calendar sync yet
- no hosted cloud deployment layer
- no team auth or multi-user permissions
- no automatic stage invention
- no huge-network optimization path yet

This repo is meant to stay easy for both humans and coding agents to navigate. When in doubt, keep logic explicit and keep responsibilities separated.
