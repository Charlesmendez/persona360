# Persona360 Skill Examples

## Sales update after a call

```bash
pnpm persona query "Acme" --json
pnpm persona add interaction --file examples/interaction.json --json
cat examples/person.json | pnpm persona upsert person --stdin --json --apply --non-interactive
pnpm persona stages list opportunity --json
pnpm persona stage set opportunity <id> --stage qualified --reason "Champion confirmed next step" --source ai --json
pnpm persona add task --title "Send follow-up" --due-at 2026-03-20T17:00:00.000Z --person-id <person_id> --company-id <company_id> --json
```

## Founder relationship memory

```bash
cat examples/person.json | pnpm persona upsert person --stdin --json --apply --non-interactive
pnpm persona add interaction --type note --summary "Investor coffee" --raw-text "Discussed fundraising timing, warm intros, and partner appetite." --happened-at 2026-03-15T18:00:00.000Z --person-id <person_id> --company-id <company_id> --json
pnpm persona add task --title "Follow up with investor update" --due-at 2026-03-22T16:00:00.000Z --person-id <person_id> --json
pnpm persona graph path <from_id> <to_id> --json
```

## Account and opportunity maintenance

```bash
pnpm persona show company <company_id> --json
pnpm persona show person <person_id> --json
pnpm persona graph company <company_id> --json
cat examples/opportunity.json | pnpm persona add opportunity --file /dev/stdin --json
pnpm persona stage set opportunity <opportunity_id> --stage proposal --reason "Pricing sent" --source ai --json
```

## Review an extracted proposal before writing

```bash
pnpm persona extract ./notes/meeting.txt --review --json
```
