#!/usr/bin/env node

import { build } from "esbuild";
import { parse as parseCsv } from "csv-parse/sync";
import { Command, Option } from "commander";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { extractProposalFromText, planQueryFromText } from "@persona360/ai";
import type {
  CardViewPayload,
  CompanyInput,
  GraphViewPayload,
  InteractionInput,
  IntroInput,
  LeadInput,
  OpportunityInput,
  PersonInput,
  TaskInput
} from "@persona360/contracts";
import { getCommandJsonSchemas } from "@persona360/contracts";
import { PersonaService } from "@persona360/domain";

type CommandOptions = {
  databaseUrl?: string;
  json?: boolean;
  file?: string;
  stdin?: boolean;
  actor?: string;
  source?: string;
  reason?: string;
  apply?: boolean;
  review?: boolean;
};

function globalOptions(command: Command): { databaseUrl?: string; json: boolean } {
  const options = command.optsWithGlobals() as { databaseUrl?: string; json?: boolean };
  return {
    databaseUrl: options.databaseUrl,
    json: options.json ?? false
  };
}

function actorFromOptions(options: CommandOptions) {
  return {
    actor: options.actor ?? "cli-user",
    source: options.source ?? "cli",
    reason: options.reason
  };
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonInput<T = unknown>(options: { stdin?: boolean; file?: string }, fallback?: T): Promise<T> {
  if (options.stdin) {
    const content = await readAllStdin();
    return JSON.parse(content) as T;
  }

  if (options.file) {
    return JSON.parse(readFileSync(resolve(options.file), "utf8")) as T;
  }

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error("Expected JSON input via --stdin or --file.");
}

function output(result: unknown, json = false): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${inspect(result, { depth: null, colors: true, compact: false })}\n`);
}

async function withService<T>(command: Command, run: (service: PersonaService) => Promise<T>): Promise<T> {
  const options = globalOptions(command);
  const service = await PersonaService.connect(process.cwd(), {
    databaseUrl: options.databaseUrl
  });

  try {
    return await run(service);
  } finally {
    await service.close();
  }
}

function withActorOptions(command: Command): Command {
  return command
    .option("--actor <actor>", "Actor name for audit trail")
    .option("--source <source>", "Write source for audit trail", "cli")
    .option("--reason <reason>", "Reason for the change");
}

function detectCsvEntity(headers: string[]): string | null {
  const normalized = new Set(headers.map((header) => header.toLowerCase()));
  if (normalized.has("first_name") && normalized.has("last_name")) {
    return "person";
  }
  if (normalized.has("name") && normalized.has("domain")) {
    return "company";
  }
  if (normalized.has("summary") && normalized.has("raw_text")) {
    return "interaction";
  }
  if (normalized.has("title") && normalized.has("company_id") && normalized.has("stage")) {
    return "opportunity";
  }
  return null;
}

async function buildViewerHtml(boot: { mode: "graph" | "card"; payload: GraphViewPayload | CardViewPayload }) {
  const entry = resolve(process.cwd(), "apps/viewer/src/main.tsx");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: "out",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: {
      ".css": "css"
    },
    define: {
      "process.env.NODE_ENV": '"production"'
    }
  });

  const js = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
  const css = result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";

  if (!js) {
    throw new Error("Failed to bundle the viewer.");
  }

  const dir = resolve(process.cwd(), ".persona360", "tmp");
  mkdirSync(dir, { recursive: true });
  const htmlPath = join(dir, `viewer-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  const bootJson = JSON.stringify(boot).replace(/</g, "\\u003c");

  writeFileSync(
    htmlPath,
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' data: blob:; img-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>persona360 viewer</title>
    <style>${css}</style>
  </head>
  <body>
    <div id="root"></div>
    <script>window.__PERSONA360_BOOT__ = ${bootJson};</script>
    <script>${js.replace(/<\/script/gi, "<\\/script")}</script>
  </body>
</html>`,
    "utf8"
  );

  return htmlPath;
}

async function openViewer(
  mode: "graph" | "card",
  payload: GraphViewPayload | CardViewPayload
): Promise<{ html_path: string }> {
  const htmlPath = await buildViewerHtml({ mode, payload });
  openLocalPath(htmlPath);
  return { html_path: htmlPath };
}

function openLocalPath(targetPath: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", "", targetPath] : [targetPath];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false
  });
  child.unref();
}

function personPayloadFromFlags(options: Record<string, unknown>): PersonInput {
  return {
    first_name: String(options.firstName),
    middle_name: options.middleName ? String(options.middleName) : undefined,
    last_name: String(options.lastName),
    current_company_id: options.companyId ? String(options.companyId) : undefined,
    current_role: options.role ? String(options.role) : undefined,
    notes: options.note ? String(options.note) : undefined,
    external_id: options.externalId ? String(options.externalId) : undefined,
    contact_points: (options.email as string[] | undefined)?.map((email) => ({
      type: "email",
      value: email
    })) ?? [],
    source_urls: (options.sourceUrl as string[] | undefined) ?? [],
    custom_properties: {}
  };
}

function companyPayloadFromFlags(options: Record<string, unknown>): CompanyInput {
  return {
    name: String(options.name),
    domain: options.domain ? String(options.domain) : undefined,
    notes: options.note ? String(options.note) : undefined,
    external_id: options.externalId ? String(options.externalId) : undefined,
    contact_points: [],
    source_urls: (options.sourceUrl as string[] | undefined) ?? [],
    custom_properties: {}
  };
}

function interactionPayloadFromFlags(options: Record<string, unknown>): InteractionInput {
  return {
    type: String(options.type) as InteractionInput["type"],
    happened_at: String(options.happenedAt),
    summary: String(options.summary),
    raw_text: String(options.rawText),
    source_url: options.sourceUrl ? String(options.sourceUrl) : undefined,
    outcome: options.outcome ? String(options.outcome) : undefined,
    next_step: options.nextStep ? String(options.nextStep) : undefined,
    person_ids: (options.personId as string[] | undefined) ?? [],
    company_ids: (options.companyId as string[] | undefined) ?? [],
    opportunity_ids: (options.opportunityId as string[] | undefined) ?? []
  };
}

function taskPayloadFromFlags(options: Record<string, unknown>): TaskInput {
  return {
    title: String(options.title),
    body: options.body ? String(options.body) : undefined,
    status: (options.status as TaskInput["status"]) ?? "not_started",
    priority: (options.priority as TaskInput["priority"]) ?? "medium",
    due_at: options.dueAt ? String(options.dueAt) : undefined,
    reminder_at: options.reminderAt ? String(options.reminderAt) : undefined,
    assigned_to: options.assignedTo ? String(options.assignedTo) : undefined,
    source_url: options.sourceUrl ? String(options.sourceUrl) : undefined,
    person_ids: (options.personId as string[] | undefined) ?? [],
    company_ids: (options.companyId as string[] | undefined) ?? [],
    opportunity_ids: (options.opportunityId as string[] | undefined) ?? []
  };
}

function introPayloadFromFlags(options: Record<string, unknown>): IntroInput {
  return {
    from_person_id: String(options.fromPersonId),
    to_person_id: String(options.toPersonId),
    target_person_id: String(options.targetPersonId),
    interaction_id: options.interactionId ? String(options.interactionId) : undefined,
    status: options.status ? String(options.status) : "pending",
    notes: options.note ? String(options.note) : undefined
  };
}

function opportunityPayloadFromFlags(options: Record<string, unknown>): OpportunityInput {
  return {
    title: String(options.title),
    company_id: String(options.companyId),
    person_ids: (options.personId as string[] | undefined) ?? [],
    stage: String(options.stage),
    status: options.status ? String(options.status) : "open",
    value: options.value ? Number(options.value) : undefined,
    notes: options.note ? String(options.note) : undefined,
    owner_id: options.ownerId ? String(options.ownerId) : undefined
  };
}

function leadPayloadFromFlags(options: Record<string, unknown>): LeadInput {
  return {
    entity_type: String(options.entityType) as LeadInput["entity_type"],
    entity_id: String(options.entityId),
    source_type: String(options.sourceType) as LeadInput["source_type"],
    source_name: String(options.sourceName),
    source_url: options.sourceUrl ? String(options.sourceUrl) : undefined,
    utm_source: options.utmSource ? String(options.utmSource) : undefined,
    utm_medium: options.utmMedium ? String(options.utmMedium) : undefined,
    utm_campaign: options.utmCampaign ? String(options.utmCampaign) : undefined,
    utm_term: options.utmTerm ? String(options.utmTerm) : undefined,
    utm_content: options.utmContent ? String(options.utmContent) : undefined,
    captured_at: options.capturedAt ? String(options.capturedAt) : new Date().toISOString()
  };
}

async function run(): Promise<void> {
  const program = new Command();
  program
    .name("persona")
    .description("CLI-first relationship memory graph.")
    .option("--database-url <url>", "Override the configured database URL")
    .option("--json", "Print machine-readable JSON output");

  program
    .command("init")
    .option("--database-url <url>", "Database URL to write to config")
    .action(async (options, command) => {
      const service = await PersonaService.connect(process.cwd(), {
        databaseUrl: options.databaseUrl ?? globalOptions(command).databaseUrl
      });
      try {
        const result = await service.initProject({
          databaseUrl: options.databaseUrl
        });
        output(result, globalOptions(command).json);
      } finally {
        await service.close();
      }
    });

  program
    .command("migrate")
    .action(async (_options, command) => {
      const service = await PersonaService.connect(process.cwd(), {
        databaseUrl: globalOptions(command).databaseUrl
      });
      try {
        const result = await service.initProject({
          databaseUrl: globalOptions(command).databaseUrl
        });
        output({ migrated: true, ...result }, globalOptions(command).json);
      } finally {
        await service.close();
      }
    });

  const dbCommand = program.command("db");
  dbCommand.command("test").action(async (_options, command) => {
    const result = await withService(command, (service) => service.dbTest());
    output(result, globalOptions(command).json);
  });

  const add = program.command("add");

  withActorOptions(
    add
      .command("person")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .option("--first-name <firstName>")
      .option("--middle-name <middleName>")
      .option("--last-name <lastName>")
      .option("--company-id <companyId>")
      .option("--role <role>")
      .option("--note <note>")
      .option("--external-id <externalId>")
      .option("--email <email>", "Add an email contact point", (value, previous: string[] = []) => [...previous, value], [])
      .option("--source-url <url>", "Add a source URL", (value, previous: string[] = []) => [...previous, value], [])
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<PersonInput>(options)
        : personPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.upsertPerson(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("company")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .option("--name <name>")
      .option("--domain <domain>")
      .option("--note <note>")
      .option("--external-id <externalId>")
      .option("--source-url <url>", "Add a source URL", (value, previous: string[] = []) => [...previous, value], [])
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<CompanyInput>(options)
        : companyPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.upsertCompany(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("interaction")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .requiredOption("--type <type>")
      .requiredOption("--summary <summary>")
      .requiredOption("--raw-text <rawText>")
      .requiredOption("--happened-at <happenedAt>")
      .option("--source-url <sourceUrl>")
      .option("--outcome <outcome>")
      .option("--next-step <nextStep>")
      .option("--person-id <id>", "Attach a person", (value, previous: string[] = []) => [...previous, value], [])
      .option("--company-id <id>", "Attach a company", (value, previous: string[] = []) => [...previous, value], [])
      .option("--opportunity-id <id>", "Attach an opportunity", (value, previous: string[] = []) => [...previous, value], [])
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<InteractionInput>(options)
        : interactionPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.addInteraction(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("task")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .requiredOption("--title <title>")
      .option("--body <body>")
      .option("--status <status>")
      .option("--priority <priority>")
      .option("--due-at <dueAt>")
      .option("--reminder-at <reminderAt>")
      .option("--assigned-to <assignedTo>")
      .option("--source-url <sourceUrl>")
      .option("--person-id <id>", "Attach a person", (value, previous: string[] = []) => [...previous, value], [])
      .option("--company-id <id>", "Attach a company", (value, previous: string[] = []) => [...previous, value], [])
      .option("--opportunity-id <id>", "Attach an opportunity", (value, previous: string[] = []) => [...previous, value], [])
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<TaskInput>(options)
        : taskPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.addTask(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("intro")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .requiredOption("--from-person-id <fromPersonId>")
      .requiredOption("--to-person-id <toPersonId>")
      .requiredOption("--target-person-id <targetPersonId>")
      .option("--interaction-id <interactionId>")
      .option("--status <status>")
      .option("--note <note>")
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<IntroInput>(options)
        : introPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.addIntro(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("opportunity")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .requiredOption("--title <title>")
      .requiredOption("--company-id <companyId>")
      .requiredOption("--stage <stage>")
      .option("--status <status>")
      .option("--value <value>")
      .option("--note <note>")
      .option("--owner-id <ownerId>")
      .option("--person-id <id>", "Attach a person", (value, previous: string[] = []) => [...previous, value], [])
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<OpportunityInput>(options)
        : opportunityPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.addOpportunity(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    add
      .command("lead")
      .option("--stdin", "Read JSON payload from stdin")
      .option("--file <path>", "Read JSON payload from file")
      .requiredOption("--entity-type <entityType>")
      .requiredOption("--entity-id <entityId>")
      .requiredOption("--source-type <sourceType>")
      .requiredOption("--source-name <sourceName>")
      .option("--source-url <sourceUrl>")
      .option("--captured-at <capturedAt>")
      .option("--utm-source <utmSource>")
      .option("--utm-medium <utmMedium>")
      .option("--utm-campaign <utmCampaign>")
      .option("--utm-term <utmTerm>")
      .option("--utm-content <utmContent>")
  ).action(async (options, command) => {
    const payload =
      options.stdin || options.file
        ? await readJsonInput<LeadInput>(options)
        : leadPayloadFromFlags(options);
    const result = await withService(command, (service) =>
      service.addLead(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  const upsert = program.command("upsert");

  withActorOptions(
    upsert
      .command("person")
      .requiredOption("--stdin", "Read JSON payload from stdin")
      .option("--apply", "Compatibility flag for agent workflows")
      .option("--non-interactive", "Compatibility flag for agent workflows")
      .option("--dry-run", "Preview validation only")
  ).action(async (options, command) => {
    const payload = await readJsonInput<PersonInput>(options);
    if (options.dryRun) {
      output({ ok: true, dry_run: true, payload }, globalOptions(command).json);
      return;
    }
    const result = await withService(command, (service) =>
      service.upsertPerson(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    upsert
      .command("company")
      .requiredOption("--stdin", "Read JSON payload from stdin")
      .option("--apply", "Compatibility flag for agent workflows")
      .option("--non-interactive", "Compatibility flag for agent workflows")
      .option("--dry-run", "Preview validation only")
  ).action(async (options, command) => {
    const payload = await readJsonInput<CompanyInput>(options);
    if (options.dryRun) {
      output({ ok: true, dry_run: true, payload }, globalOptions(command).json);
      return;
    }
    const result = await withService(command, (service) =>
      service.upsertCompany(payload, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  const stages = program.command("stages");
  stages.command("list <entityType>").action(async (entityType, _options, command) => {
    const result = await withService(command, (service) =>
      service.listStages(entityType)
    );
    output({ entity_type: entityType, stages: result }, globalOptions(command).json);
  });

  const stage = program.command("stage");
  withActorOptions(
    stage
      .command("define <entityType>")
      .requiredOption("--file <path>", "JSON file with stage definitions")
  ).action(async (entityType, options, command) => {
    const definitions = await readJsonInput<unknown[]>(options);
    const result = await withService(command, (service) =>
      service.defineStages(entityType, definitions, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  withActorOptions(
    stage
      .command("set <entityType> <entityId>")
      .requiredOption("--stage <stage>", "Stage key to apply")
      .option("--source-evidence-id <sourceEvidenceId>", "Linked evidence ID")
      .option("--apply", "Compatibility flag for agent workflows")
      .option("--non-interactive", "Compatibility flag for agent workflows")
  ).action(async (entityType, entityId, options, command) => {
    const result = await withService(command, (service) =>
      service.setStage(
        {
          entity_type: entityType,
          entity_id: entityId,
          stage: options.stage,
          source_evidence_id: options.sourceEvidenceId
        },
        actorFromOptions(options)
      )
    );
    output(result, globalOptions(command).json);
  });

  program
    .command("validate <entityType>")
    .requiredOption("--stdin", "Read JSON payload from stdin")
    .action(async (entityType, options, command) => {
      const payload = await readJsonInput(options);
      const result = await withService(command, (service) =>
        Promise.resolve(service.validate(entityType, payload))
      );
      output(result, globalOptions(command).json);
    });

  const show = program.command("show");
  show.command("person <id>").action(async (id, _options, command) => {
    const result = await withService(command, (service) => service.showPerson(id));
    output(result, globalOptions(command).json);
  });
  show.command("company <id>").action(async (id, _options, command) => {
    const result = await withService(command, (service) => service.showCompany(id));
    output(result, globalOptions(command).json);
  });

  const graph = program.command("graph");
  graph
    .command("person <id>")
    .option("--depth <depth>", "Neighborhood depth", "2")
    .option("--open", "Open in the local viewer")
    .action(async (id, options, command) => {
      const payload = await withService(command, (service) =>
        service.graphEntity("person", id, Number(options.depth))
      );
      if (options.open) {
        const result = await openViewer("graph", payload);
        output({ opened: true, ...result }, globalOptions(command).json);
        return;
      }
      output(payload, globalOptions(command).json);
    });

  graph
    .command("company <id>")
    .option("--depth <depth>", "Neighborhood depth", "2")
    .option("--open", "Open in the local viewer")
    .action(async (id, options, command) => {
      const payload = await withService(command, (service) =>
        service.graphEntity("company", id, Number(options.depth))
      );
      if (options.open) {
        const result = await openViewer("graph", payload);
        output({ opened: true, ...result }, globalOptions(command).json);
        return;
      }
      output(payload, globalOptions(command).json);
    });

  graph.command("path <fromId> <toId>").action(async (fromId, toId, _options, command) => {
    const result = await withService(command, (service) => service.graphPath(fromId, toId));
    output(result, true);
  });

  const card = program.command("card");
  card.command("person <id>").option("--open", "Open in the local viewer").action(async (id, options, command) => {
    const result = await withService(command, (service) => service.showPerson(id));
    if (options.open) {
      const opened = await openViewer("card", result.card);
      output({ opened: true, ...opened }, globalOptions(command).json);
      return;
    }
    output(result.card, globalOptions(command).json);
  });
  card.command("company <id>").option("--open", "Open in the local viewer").action(async (id, options, command) => {
    const result = await withService(command, (service) => service.showCompany(id));
    if (options.open) {
      const opened = await openViewer("card", result.card);
      output({ opened: true, ...opened }, globalOptions(command).json);
      return;
    }
    output(result.card, globalOptions(command).json);
  });

  const importCommand = program.command("import");
  withActorOptions(
    importCommand
      .command("csv <file>")
      .option("--entity <entity>", "Entity type. Auto-detected when omitted.")
  ).action(async (file, options, command) => {
    const raw = readFileSync(resolve(file), "utf8");
    const rows = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    }) as Record<string, string>[];
    const entity = options.entity ?? detectCsvEntity(Object.keys(rows[0] ?? {}));
    if (!entity) {
      throw new Error("Could not detect the CSV entity type. Pass --entity explicitly.");
    }
    const result = await withService(command, (service) =>
      service.importRows(entity, rows, actorFromOptions(options))
    );
    output({ entity, count: result.length, results: result }, globalOptions(command).json);
  });

  withActorOptions(
    importCommand
      .command("text <file>")
      .option("--review", "Preview the extracted proposal", true)
      .option("--apply", "Apply the extracted proposal")
  ).action(async (file, options, command) => {
    const text = readFileSync(resolve(file), "utf8");
    const proposal = await extractProposalFromText(text);
    if (!options.apply || options.review) {
      output(proposal, globalOptions(command).json || true);
      return;
    }
    const result = await withService(command, (service) =>
      service.applyProposal(proposal, actorFromOptions(options))
    );
    output(result, globalOptions(command).json);
  });

  program
    .command("extract <file>")
    .option("--review", "Preview the extracted proposal", true)
    .option("--apply", "Apply the proposal")
    .option("--json", "Force JSON output", true)
    .option("--actor <actor>", "Actor name for audit trail")
    .option("--source <source>", "Write source for audit trail", "ai")
    .option("--reason <reason>", "Reason for the change", "AI extraction")
    .action(async (file, options, command) => {
      const text = readFileSync(resolve(file), "utf8");
      const proposal = await extractProposalFromText(text);
      if (!options.apply || options.review) {
        output(proposal, true);
        return;
      }
      const result = await withService(command, (service) =>
        service.applyProposal(proposal, actorFromOptions(options))
      );
      output(result, true);
    });

  program.command("query <text...>").action(async (parts, _options, command) => {
    const question = parts.join(" ");
    const plan = planQueryFromText(question);

    if (plan.action === "show_person" && plan.query) {
      const id = plan.query.split(/\s+/).pop();
      if (id) {
        const result = await withService(command, (service) => service.showPerson(id));
        output({ plan, result }, globalOptions(command).json);
        return;
      }
    }

    if (plan.action === "show_company" && plan.query) {
      const id = plan.query.split(/\s+/).pop();
      if (id) {
        const result = await withService(command, (service) => service.showCompany(id));
        output({ plan, result }, globalOptions(command).json);
        return;
      }
    }

    const result = await withService(command, (service) => service.query(question));
    output({ plan, result }, globalOptions(command).json);
  });

  const merge = program.command("merge");
  withActorOptions(merge.command("person <sourceId> <targetId>")).action(
    async (sourceId, targetId, options, command) => {
      const result = await withService(command, (service) =>
        service.mergePeople(sourceId, targetId, actorFromOptions(options))
      );
      output(result, globalOptions(command).json);
    }
  );

  program.command("schemas").action((_options, command) => {
    output(getCommandJsonSchemas(), true || globalOptions(command).json);
  });

  await program.parseAsync(process.argv);
}

run().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error"
      },
      null,
      2
    )}\n`
  );
  process.exitCode = 1;
});

