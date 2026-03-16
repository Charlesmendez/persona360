---
name: persona360-crm
description: Operates persona360 for sales workflow updates, founder relationship memory, account/opportunity maintenance, stages, and graph lookups through the CLI. Use when the user wants CRM changes after calls, emails, notes, intros, pipeline updates, stakeholder mapping, or relationship queries through `pnpm persona`.
---

# Persona360 CRM

Use `pnpm persona` as the system interface. Prefer structured, auditable writes over ad hoc edits.

Optimize for three jobs:

- sales workflow updates
- founder / investor / partner relationship memory
- account and opportunity maintenance

## Defaults

- Run commands from the repo root.
- Prefer `pnpm persona ... --json`.
- Prefer `upsert` when an `external_id` exists or retries are likely.
- Prefer `--stdin` or `--file` for structured payloads instead of large JSON in flags.
- Validate risky payloads first with `pnpm persona validate <entity> --stdin --json`.
- For writes that matter, include `--actor`, `--source`, and `--reason`.

## Golden rules

- Do not invent stage keys. Run `pnpm persona stages list <entityType> --json` before `stage set`.
- Use `stage define` only when a new stage is actually needed.
- Default extraction/import flows to review mode:
  - `pnpm persona extract <file> --review --json`
  - only apply when writes are explicitly wanted
- Store new evidence first, then update canonical state.
- If uncertain, prefer adding an interaction/task over hallucinating a stage or fact.
- Do not bury next actions only in notes. Create a task.
- Do not force every relationship into an opportunity. Founder/investor/partner relationships may stop at person, company, interaction, intro, and task.

## Preferred objects by workflow

### Sales workflow

- `company`: account
- `person`: stakeholder
- `interaction`: source of truth from calls, emails, and meetings
- `opportunity`: deal state
- `task`: next action
- `lead`: attribution

### Founder relationship memory

- `person`: investor, candidate, advisor, partner, customer contact
- `company`: fund, startup, partner, customer
- `interaction`: every meaningful touchpoint
- `intro`: warm intros
- `task`: follow-up or reminder

### Account / opportunity maintenance

- `company`: account hub
- `person`: stakeholder map
- `interaction`: recent account history
- `opportunity`: pipeline object
- `task`: execution

## Preferred custom properties

When you need richer memory, prefer a few stable keys:

- `preferred_channel`
- `timezone`
- `champion_score`
- `relationship_strength`
- `buying_timeline`
- `risk_flags`
- `personal_context`
- `next_best_action`
- `last_commitment`
- `decision_role`

## Workflow 1: Sales update from a note, call, or email

Use this when the user wants to update the CRM after a meeting or message.

1. Find or create the company and person.
2. Add the interaction with the real raw text.
3. Upsert person/company fields that became clearer.
4. Update or create the opportunity only if the work is actually deal-shaped.
5. Set the stage only if the evidence supports it.
6. Add the next task.

Recommended sequence:

```bash
pnpm persona query "Acme" --json
pnpm persona add interaction ... --json
pnpm persona upsert person --stdin --json --apply --non-interactive
pnpm persona upsert company --stdin --json --apply --non-interactive
pnpm persona stages list opportunity --json
pnpm persona stage set opportunity <id> --stage qualified --reason "..." --source ai --json
pnpm persona add task ... --json
```

## Workflow 2: Founder relationship memory

Use this for investors, candidates, advisors, strategic partners, and high-value personal relationships.

Focus on:

- who they are
- what they care about
- what was promised
- when to follow up
- who can introduce whom

Recommended pattern:

1. Upsert the person with contact points and high-signal custom properties.
2. Attach interactions with the actual note/email/call text.
3. Record intros when relevant.
4. Add a task for the next move.
5. Use `graph path` when the user asks for a warm intro.

For this workflow, prefer properties like:

- `preferred_channel`
- `personal_context`
- `last_commitment`
- `next_best_action`

## Workflow 3: Account and opportunity maintenance

Use this when the user wants to clean up account state or keep pipeline current.

Recommended order:

1. `show company` or `show person`
2. Add new interactions
3. Update people/company records
4. List stages
5. Set the opportunity stage if supported by evidence
6. Add tasks for follow-through
7. Open graph/card views if the user wants context

Recommended commands:

```bash
pnpm persona show company <company_id> --json
pnpm persona add interaction ... --json
pnpm persona upsert person --stdin --json --apply --non-interactive
pnpm persona upsert company --stdin --json --apply --non-interactive
pnpm persona stages list opportunity --json
pnpm persona stage set opportunity <id> --stage <key> --reason "..." --source ai --json
pnpm persona graph company <company_id> --open --json
```

## Common command patterns

### Upsert a company

```bash
cat company.json | pnpm persona upsert company --stdin --json --apply --non-interactive
```

### Upsert a person

```bash
cat person.json | pnpm persona upsert person --stdin --json --apply --non-interactive
```

### Validate a payload

```bash
cat person.json | pnpm persona validate person --stdin --json
```

### Define stages

```bash
pnpm persona stage define opportunity --file examples/opportunity-stages.json --json
```

### Set a stage safely

```bash
pnpm persona stages list opportunity --json
pnpm persona stage set opportunity <id> --stage qualified --reason "..." --source ai --json
```

### Open graph or card views

```bash
pnpm persona graph company <company_id> --open --json
pnpm persona card person <person_id> --open --json
```

### Query the graph

```bash
pnpm persona graph path <from_id> <to_id> --json
pnpm persona query "Acme" --json
```

## Do not do this

- Do not set a stage without checking allowed keys first.
- Do not create a new opportunity for every interaction.
- Do not overwrite contact data with weaker guesses.
- Do not keep critical next steps only in notes.
- Do not skip the interaction if the update came from a note, email, or call.

## Repo references

- Architecture: `AGENTS.md`
- Example payloads: `examples/`
- Contracts: `packages/contracts/src/index.ts`
- CLI entrypoint: `apps/cli/src/index.ts`

## Additional examples

- See [examples.md](examples.md)
