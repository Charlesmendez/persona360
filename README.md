# persona360

The open source AI-native CRM built on relationships, not fields

A CLI-first, open source CRM that turns conversations, intros, and activity into structured relationship intelligence.

It captures people, companies, interactions, intros, and opportunities as a living graph.

- It turns real interactions into structured relationship intelligence.
- It updates contact and company context from conversations, not manual data entry.
- It helps you manage who knows who, what matters, and what should happen next.
- It stores your network the way it actually works: connected, dynamic, and contextual.

## Visuals

![Persona360 graph view](./persona1.png)

![Persona360 profile view](./persona2.png)

![Persona360 node detail](./persona%203.png)

![Persona360 graph explorer](./persona%204.png)

The product shape is:

- source-backed records
- graph relationships with weighted edges
- stage definitions and audited stage transitions
- local viewer for graph and card visualization
- optional local AI extraction from notes and transcripts

## Quickstart

```bash
pnpm install
pnpm setup:native
pnpm build
pnpm persona init --json
```

Why `setup:native` exists:

- `better-sqlite3` is the default local database driver
- pnpm 10 may require explicit approval for native build scripts

If your `pnpm` is older and complains about `approve-builds --all`, use one of these fixes:

```bash
pnpm add -g pnpm@latest
pnpm setup:native
```

Or:

```bash
pnpm install --dangerously-allow-all-builds
pnpm rebuild better-sqlite3 esbuild
```

The default database is a local SQLite file at `.persona360/persona.db`.

To use Postgres instead:

```bash
export DATABASE_URL="postgres://user:password@host:5432/persona360"
pnpm persona init --json
pnpm persona db test --json
```

## Agent Skill

`persona360` ships with a ready-made Claude Code skill in `.claude/skills/persona360-crm/`.

It is tuned for:

- sales workflow updates
- founder / investor / partner relationship memory
- account and opportunity maintenance

What it gives the agent:

- use `pnpm persona ... --json` by default
- prefer idempotent `upsert` flows
- validate payloads before risky writes
- list stages before setting stages
- default extraction to review mode unless writes are explicitly requested

If you use Claude Code inside this repo, the project skill is already in the standard `.claude/skills/` location.

To install it globally for your own agent:

```bash
mkdir -p ~/.claude/skills
cp -R .claude/skills/persona360-crm ~/.claude/skills/persona360-crm
```

Or symlink it:

```bash
mkdir -p ~/.claude/skills
ln -s "$(pwd)/.claude/skills/persona360-crm" ~/.claude/skills/persona360-crm
```

The actual skill file is:

```text
.claude/skills/persona360-crm/SKILL.md
```

## Common Commands

Define opportunity stages:

```bash
pnpm persona stage define opportunity --file examples/opportunity-stages.json --json
```

Upsert a company from JSON:

```bash
cat examples/company.json | pnpm persona upsert company --stdin --json --apply --non-interactive
```

Upsert a person:

```bash
cat examples/person.json | pnpm persona upsert person --stdin --json --apply --non-interactive
```

Add an interaction:

```bash
pnpm persona add interaction --file examples/interaction.json --json
```

Add an opportunity:

```bash
pnpm persona add opportunity --file examples/opportunity.json --json
```

Show a company card payload:

```bash
pnpm persona show company <company_id> --json
```

Open the graph viewer:

```bash
pnpm persona graph company <company_id> --open --json
```

Get the best relationship paths:

```bash
pnpm persona graph path <from_id> <to_id> --json
```

Extract a proposal from raw text:

```bash
pnpm persona extract /path/to/note.txt --review --json
```

## Agent-First Contract

The CLI is intentionally usable as a machine interface.

Important patterns:

- JSON in through `--stdin` or `--file`
- JSON out through `--json`
- explicit stage definitions via `stage define`
- explicit stage transitions via `stage set`
- safe retries through `external_id` on upsert flows
- audit-friendly `--actor`, `--source`, and `--reason`

Example:

```bash
printf '%s' '{
  "external_id": "company:acme.com",
  "name": "Acme Inc",
  "domain": "acme.com",
  "contact_points": [],
  "source_urls": [],
  "custom_properties": {}
}' | pnpm persona upsert company --stdin --json --apply --non-interactive
```

## Viewer

The graph/card viewer is a local React + Cytoscape app that the CLI bundles into a temporary self-contained HTML file.

The viewer supports:

- graph neighborhood exploration
- card rendering for person/company detail
- evidence panel
- local-only rendering with no remote scripts

## Security Defaults

Built-in defaults:

- imported text is always treated as data, not instructions
- stage changes must use declared stage keys
- writes are schema-validated before persistence
- graph/card viewer output is local and self-contained
- AI and agent writes are audited
- SQLite is local-first; Postgres is user-managed

## Project Layout

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

`AGENTS.md` has the architecture walkthrough and the important files.
