import {
  ActorSchema,
  CardViewPayloadSchema,
  commandSchemas,
  type CompanyInput,
  CompanyInputSchema,
  type EdgeInput,
  EdgeInputSchema,
  type ExtractedProposal,
  GraphViewPayloadSchema,
  type IntroInput,
  IntroInputSchema,
  type InteractionInput,
  InteractionInputSchema,
  type LeadInput,
  LeadInputSchema,
  type ObservationInput,
  ObservationInputSchema,
  type OpportunityInput,
  OpportunityInputSchema,
  PathResultSchema,
  type PersonInput,
  PersonInputSchema,
  StageDefinitionSchema,
  StageSetInputSchema,
  type TaskInput,
  TaskInputSchema,
  ValidationResultSchema
} from "@persona360/contracts";
import { buildCardViewPayload, buildGraphViewPayload, rankPaths } from "@persona360/graph";
import { PersonaDatabase, createDefaultProjectConfig } from "@persona360/db";

type ActorInput = {
  actor?: string;
  source?: string;
  reason?: string;
};

type EntityName =
  | "person"
  | "company"
  | "interaction"
  | "task"
  | "intro"
  | "opportunity"
  | "lead";

const ENTITY_TABLES: Record<Exclude<EntityName, "lead"> | "lead", string> = {
  person: "people",
  company: "companies",
  interaction: "interactions",
  task: "tasks",
  intro: "intros",
  opportunity: "opportunities",
  lead: "leads"
};

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeActor(actor?: ActorInput) {
  return ActorSchema.parse(actor ?? {});
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function audit(
  db: PersonaDatabase,
  entityType: string | null,
  entityId: string | null,
  action: string,
  actor: ActorInput,
  payload?: unknown
): Promise<void> {
  const resolvedActor = normalizeActor(actor);
  await db.recordAudit({
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor: resolvedActor.actor,
    source: resolvedActor.source,
    reason: resolvedActor.reason,
    payload
  });
}

async function createEvidenceFromText(
  db: PersonaDatabase,
  title: string,
  rawText: string,
  sourceUrl?: string
): Promise<string> {
  const id = makeId("evidence");
  await db.insert("evidence", {
    id,
    title,
    source_type: "import",
    source_url: sourceUrl ?? null,
    raw_text: rawText,
    snippet: rawText.slice(0, 280),
    happened_at: nowIso(),
    never_send_to_model: 0,
    created_at: nowIso(),
    updated_at: nowIso()
  });
  return id;
}

async function applyEdge(
  db: PersonaDatabase,
  edge: Omit<
    EdgeInput,
    "direction" | "status" | "is_current" | "is_inferred" | "evidence_count" | "path_score_hint"
  > &
    Partial<
      Pick<
        EdgeInput,
        "direction" | "status" | "is_current" | "is_inferred" | "evidence_count" | "path_score_hint"
      >
    >,
  actor?: ActorInput
): Promise<string> {
  const parsed = EdgeInputSchema.parse({
    direction: "forward",
    status: "active",
    is_current: true,
    is_inferred: false,
    evidence_count: 1,
    path_score_hint: 0,
    ...edge
  });
  const edgeId = await db.upsertEdge({
    id: makeId("edge"),
    from_type: parsed.from_type,
    from_id: parsed.from_id,
    edge_type: parsed.edge_type,
    to_type: parsed.to_type,
    to_id: parsed.to_id,
    label: parsed.label ?? null,
    direction: parsed.direction,
    status: parsed.status,
    valid_from: parsed.valid_from ?? null,
    valid_to: parsed.valid_to ?? null,
    last_seen_at: parsed.last_seen_at ?? null,
    last_confirmed_at: parsed.last_confirmed_at ?? null,
    is_current: parsed.is_current ? 1 : 0,
    is_inferred: parsed.is_inferred ? 1 : 0,
    strength: parsed.strength,
    confidence: parsed.confidence,
    evidence_count: parsed.evidence_count,
    path_score_hint: parsed.path_score_hint
  });

  if (parsed.source_evidence_id) {
    await db.addEdgeEvidence({
      id: makeId("edge_evidence"),
      edge_id: edgeId,
      evidence_id: parsed.source_evidence_id
    });
  }

  if (actor) {
    await audit(db, parsed.from_type, parsed.from_id, "edge.upsert", actor, {
      edge_id: edgeId,
      edge_type: parsed.edge_type,
      to_id: parsed.to_id
    });
  }

  return edgeId;
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== "" && v !== "{}"));
}

async function collectEntitySummaries(
  db: PersonaDatabase,
  refs: Array<{ entity_type: string; id: string }>
): Promise<Array<{ id: string; entity_type: string; label: string; subtitle?: string; meta?: Record<string, unknown> }>> {
  const uniqueRefs = [...new Map(refs.map((ref) => [`${ref.entity_type}:${ref.id}`, ref])).values()];
  const summaries: Array<{ id: string; entity_type: string; label: string; subtitle?: string; meta?: Record<string, unknown> }> = [];

  for (const ref of uniqueRefs) {
    const table =
      ref.entity_type === "person"
        ? "people"
        : ref.entity_type === "company"
          ? "companies"
          : ref.entity_type === "interaction"
            ? "interactions"
            : ref.entity_type === "task"
              ? "tasks"
              : ref.entity_type === "opportunity"
                ? "opportunities"
                : ref.entity_type === "lead"
                  ? "leads"
                  : null;

    if (!table) {
      continue;
    }

    const row = await db.findById(table, ref.id);
    if (!row) {
      continue;
    }

    if (ref.entity_type === "person") {
      const contactPoints = await db.listContactPoints("person", ref.id);
      const customProps = parseJsonField<Record<string, unknown>>(row.custom_properties_json, {});
      summaries.push({
        id: ref.id,
        entity_type: "person",
        label: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        subtitle: row.current_role ? String(row.current_role) : undefined,
        meta: compact({
          role: row.current_role,
          company_id: row.current_company_id,
          lifecycle_stage: row.lifecycle_stage,
          lead_status: row.lead_status,
          owner: row.owner_id,
          last_activity: row.last_activity_at,
          notes: row.notes,
          contact_points: contactPoints.length > 0
            ? contactPoints.map((cp) => `${cp.type}: ${cp.value}`)
            : undefined,
          ...customProps
        })
      });
      continue;
    }

    if (ref.entity_type === "company") {
      const contactPoints = await db.listContactPoints("company", ref.id);
      const customProps = parseJsonField<Record<string, unknown>>(row.custom_properties_json, {});
      summaries.push({
        id: ref.id,
        entity_type: "company",
        label: String(row.name),
        subtitle: row.domain ? String(row.domain) : undefined,
        meta: compact({
          domain: row.domain,
          lifecycle_stage: row.lifecycle_stage,
          owner: row.owner_id,
          last_activity: row.last_activity_at,
          notes: row.notes,
          contact_points: contactPoints.length > 0
            ? contactPoints.map((cp) => `${cp.type}: ${cp.value}`)
            : undefined,
          ...customProps
        })
      });
      continue;
    }

    if (ref.entity_type === "interaction") {
      summaries.push({
        id: ref.id,
        entity_type: "interaction",
        label: String(row.summary),
        subtitle: String(row.type),
        meta: compact({
          type: row.type,
          happened_at: row.happened_at,
          outcome: row.outcome,
          next_step: row.next_step,
          snippet: String(row.raw_text ?? "").slice(0, 300) || undefined
        })
      });
      continue;
    }

    if (ref.entity_type === "task") {
      summaries.push({
        id: ref.id,
        entity_type: "task",
        label: String(row.title),
        subtitle: String(row.status),
        meta: compact({
          status: row.status,
          priority: row.priority,
          due_at: row.due_at,
          body: row.body
        })
      });
      continue;
    }

    if (ref.entity_type === "opportunity") {
      summaries.push({
        id: ref.id,
        entity_type: "opportunity",
        label: String(row.title),
        subtitle: String(row.stage),
        meta: compact({
          stage: row.stage,
          status: row.status,
          value: row.value,
          company_id: row.company_id,
          notes: row.notes
        })
      });
      continue;
    }

    summaries.push({
      id: ref.id,
      entity_type: "lead",
      label: String(row.source_name),
      subtitle: String(row.source_type),
      meta: compact({
        source_type: row.source_type,
        source_url: row.source_url,
        utm_source: row.utm_source,
        utm_campaign: row.utm_campaign,
        captured_at: row.captured_at
      })
    });
  }

  return summaries;
}

async function collectNeighborhood(
  db: PersonaDatabase,
  entityType: "person" | "company",
  id: string,
  depth: number
) {
  const visited = new Set<string>([`${entityType}:${id}`]);
  const queue: Array<{ entity_type: string; id: string; depth: number }> = [{ entity_type: entityType, id, depth: 0 }];
  const edgeMap = new Map<string, Record<string, unknown>>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > depth) {
      continue;
    }

    const edges = await db.listEdgesForEntity(current.entity_type, current.id);
    for (const edge of edges) {
      edgeMap.set(String(edge.id), edge);
      const refs = [
        { entity_type: String(edge.from_type), id: String(edge.from_id) },
        { entity_type: String(edge.to_type), id: String(edge.to_id) }
      ];

      for (const ref of refs) {
        const key = `${ref.entity_type}:${ref.id}`;
        if (visited.has(key) || current.depth >= depth) {
          continue;
        }

        visited.add(key);
        queue.push({
          ...ref,
          depth: current.depth + 1
        });
      }
    }
  }

  const refs = [...visited].map((value) => {
    const [refType, refId] = value.split(":");
    return { entity_type: refType, id: refId };
  });

  return {
    edges: [...edgeMap.values()],
    refs
  };
}

export class PersonaService {
  private constructor(private readonly db: PersonaDatabase, private readonly cwd: string) {}

  static async connect(cwd: string, options?: { databaseUrl?: string }): Promise<PersonaService> {
    const db = await PersonaDatabase.connect(cwd, options);
    return new PersonaService(db, cwd);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  async initProject(options?: { databaseUrl?: string }): Promise<{ config_path: string; dialect: string }> {
    let configPath = "";
    if (!options?.databaseUrl && !process.env.DATABASE_URL && !process.env.PERSONA360_DATABASE_URL) {
      configPath = createDefaultProjectConfig(this.cwd);
    }

    await this.db.migrate();
    return {
      config_path: configPath,
      dialect: this.db.config.dialect
    };
  }

  async dbTest(): Promise<{ ok: true; dialect: string }> {
    return this.db.testConnection();
  }

  validate(entityName: keyof typeof commandSchemas, data: unknown) {
    try {
      const schema = commandSchemas[entityName];
      const parsed = schema.parse(data);
      return ValidationResultSchema.parse({
        ok: true,
        data: parsed,
        errors: []
      });
    } catch (error) {
      return ValidationResultSchema.parse({
        ok: false,
        errors: [error instanceof Error ? error.message : "Unknown validation error"]
      });
    }
  }

  async upsertPerson(input: PersonInput, actor?: ActorInput) {
    const parsed = PersonInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const existing =
      parsed.external_id ? await this.db.findByExternalId("people", parsed.external_id) : null;
    const id = existing?.id ? String(existing.id) : makeId("person");
    const timestamp = nowIso();

    if (existing) {
      await this.db.updateById("people", id, {
        first_name: parsed.first_name,
        middle_name: parsed.middle_name ?? null,
        last_name: parsed.last_name,
        current_company_id: parsed.current_company_id ?? null,
        current_role: parsed.current_role ?? null,
        notes: parsed.notes ?? null,
        lifecycle_stage: parsed.lifecycle_stage ?? null,
        lead_status: parsed.lead_status ?? null,
        owner_id: parsed.owner_id ?? null,
        last_activity_at: parsed.last_activity_at ?? null,
        source_urls_json: serializeJson(parsed.source_urls),
        custom_properties_json: serializeJson(parsed.custom_properties),
        updated_at: timestamp
      });
    } else {
      await this.db.insert("people", {
        id,
        external_id: parsed.external_id ?? null,
        first_name: parsed.first_name,
        middle_name: parsed.middle_name ?? null,
        last_name: parsed.last_name,
        current_company_id: parsed.current_company_id ?? null,
        current_role: parsed.current_role ?? null,
        notes: parsed.notes ?? null,
        lifecycle_stage: parsed.lifecycle_stage ?? null,
        lead_status: parsed.lead_status ?? null,
        owner_id: parsed.owner_id ?? null,
        last_activity_at: parsed.last_activity_at ?? null,
        source_urls_json: serializeJson(parsed.source_urls),
        custom_properties_json: serializeJson(parsed.custom_properties),
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    await this.db.replaceContactPoints(
      "person",
      id,
      parsed.contact_points.map((point) => ({
        id: makeId("contact_point"),
        type: point.type,
        value: point.value,
        label: point.label ?? null
      }))
    );
    await this.db.replacePropertyValues("person", id, parsed.custom_properties);
    await this.db.addAliases(
      "person",
      id,
      parsed.contact_points
        .filter((point) => point.type === "email")
        .map((point) => ({
          alias_type: "email",
          alias_value: point.value.toLowerCase()
        }))
    );

    if (parsed.current_company_id) {
      await applyEdge(
        this.db,
        {
          from_type: "person",
          from_id: id,
          edge_type: "WORKS_AT",
          to_type: "company",
          to_id: parsed.current_company_id,
          strength: 0.9,
          confidence: 0.95,
          last_seen_at: timestamp,
          last_confirmed_at: timestamp
        },
        resolvedActor
      );
    }

    await audit(this.db, "person", id, existing ? "person.update" : "person.create", resolvedActor, parsed);
    return this.db.hydrateEntity("people", id);
  }

  async upsertCompany(input: CompanyInput, actor?: ActorInput) {
    const parsed = CompanyInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const existing =
      parsed.external_id ? await this.db.findByExternalId("companies", parsed.external_id) : null;
    const id = existing?.id ? String(existing.id) : makeId("company");
    const timestamp = nowIso();

    if (existing) {
      await this.db.updateById("companies", id, {
        name: parsed.name,
        domain: parsed.domain ?? null,
        notes: parsed.notes ?? null,
        lifecycle_stage: parsed.lifecycle_stage ?? null,
        owner_id: parsed.owner_id ?? null,
        last_activity_at: parsed.last_activity_at ?? null,
        source_urls_json: serializeJson(parsed.source_urls),
        custom_properties_json: serializeJson(parsed.custom_properties),
        updated_at: timestamp
      });
    } else {
      await this.db.insert("companies", {
        id,
        external_id: parsed.external_id ?? null,
        name: parsed.name,
        domain: parsed.domain ?? null,
        notes: parsed.notes ?? null,
        lifecycle_stage: parsed.lifecycle_stage ?? null,
        owner_id: parsed.owner_id ?? null,
        last_activity_at: parsed.last_activity_at ?? null,
        source_urls_json: serializeJson(parsed.source_urls),
        custom_properties_json: serializeJson(parsed.custom_properties),
        created_at: timestamp,
        updated_at: timestamp
      });
    }

    await this.db.replaceContactPoints(
      "company",
      id,
      parsed.contact_points.map((point) => ({
        id: makeId("contact_point"),
        type: point.type,
        value: point.value,
        label: point.label ?? null
      }))
    );
    await this.db.replacePropertyValues("company", id, parsed.custom_properties);

    if (parsed.domain) {
      await this.db.addAliases("company", id, [
        {
          alias_type: "domain",
          alias_value: parsed.domain.toLowerCase()
        }
      ]);
    }

    await audit(this.db, "company", id, existing ? "company.update" : "company.create", resolvedActor, parsed);
    return this.db.hydrateEntity("companies", id);
  }

  async addInteraction(input: InteractionInput, actor?: ActorInput) {
    const parsed = InteractionInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("interaction");
    await this.db.insert("interactions", {
      id,
      external_id: parsed.external_id ?? null,
      type: parsed.type,
      happened_at: parsed.happened_at,
      summary: parsed.summary,
      raw_text: parsed.raw_text,
      source_url: parsed.source_url ?? null,
      outcome: parsed.outcome ?? null,
      next_step: parsed.next_step ?? null,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    const evidenceId = await createEvidenceFromText(this.db, parsed.summary, parsed.raw_text, parsed.source_url);

    for (const personId of parsed.person_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "person",
          from_id: personId,
          edge_type: "PARTICIPATED_IN",
          to_type: "interaction",
          to_id: id,
          confidence: 0.95,
          strength: 0.7,
          last_seen_at: parsed.happened_at,
          last_confirmed_at: parsed.happened_at,
          source_evidence_id: evidenceId
        },
        resolvedActor
      );
    }

    for (const companyId of parsed.company_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "company",
          from_id: companyId,
          edge_type: "PARTICIPATED_IN",
          to_type: "interaction",
          to_id: id,
          confidence: 0.9,
          strength: 0.6,
          last_seen_at: parsed.happened_at,
          last_confirmed_at: parsed.happened_at,
          source_evidence_id: evidenceId
        },
        resolvedActor
      );
    }

    for (const opportunityId of parsed.opportunity_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "opportunity",
          from_id: opportunityId,
          edge_type: "ASSOCIATED_WITH_OPPORTUNITY",
          to_type: "interaction",
          to_id: id,
          confidence: 0.9,
          strength: 0.65,
          last_seen_at: parsed.happened_at,
          last_confirmed_at: parsed.happened_at,
          source_evidence_id: evidenceId
        },
        resolvedActor
      );
    }

    await audit(this.db, "interaction", id, "interaction.create", resolvedActor, parsed);
    return this.db.findById("interactions", id);
  }

  async addTask(input: TaskInput, actor?: ActorInput) {
    const parsed = TaskInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("task");
    await this.db.insert("tasks", {
      id,
      external_id: parsed.external_id ?? null,
      title: parsed.title,
      body: parsed.body ?? null,
      status: parsed.status,
      priority: parsed.priority,
      due_at: parsed.due_at ?? null,
      reminder_at: parsed.reminder_at ?? null,
      assigned_to: parsed.assigned_to ?? null,
      source_url: parsed.source_url ?? null,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    if (parsed.assigned_to) {
      await applyEdge(
        this.db,
        {
          from_type: "person",
          from_id: parsed.assigned_to,
          edge_type: "ASSIGNED_TO",
          to_type: "task",
          to_id: id,
          confidence: 0.95,
          strength: 0.85,
          last_seen_at: parsed.due_at ?? nowIso(),
          last_confirmed_at: nowIso()
        },
        resolvedActor
      );
    }

    for (const personId of parsed.person_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "person",
          from_id: personId,
          edge_type: "PARTICIPATED_IN",
          to_type: "task",
          to_id: id,
          confidence: 0.8,
          strength: 0.5,
          last_seen_at: parsed.due_at ?? nowIso(),
          last_confirmed_at: nowIso()
        },
        resolvedActor
      );
    }

    for (const companyId of parsed.company_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "company",
          from_id: companyId,
          edge_type: "PARTICIPATED_IN",
          to_type: "task",
          to_id: id,
          confidence: 0.8,
          strength: 0.45,
          last_seen_at: parsed.due_at ?? nowIso(),
          last_confirmed_at: nowIso()
        },
        resolvedActor
      );
    }

    for (const opportunityId of parsed.opportunity_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "opportunity",
          from_id: opportunityId,
          edge_type: "ASSOCIATED_WITH_OPPORTUNITY",
          to_type: "task",
          to_id: id,
          confidence: 0.85,
          strength: 0.55,
          last_seen_at: parsed.due_at ?? nowIso(),
          last_confirmed_at: nowIso()
        },
        resolvedActor
      );
    }

    await audit(this.db, "task", id, "task.create", resolvedActor, parsed);
    return this.db.findById("tasks", id);
  }

  async addIntro(input: IntroInput, actor?: ActorInput) {
    const parsed = IntroInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("intro");

    await this.db.insert("intros", {
      id,
      external_id: parsed.external_id ?? null,
      from_person_id: parsed.from_person_id,
      to_person_id: parsed.to_person_id,
      target_person_id: parsed.target_person_id,
      interaction_id: parsed.interaction_id ?? null,
      status: parsed.status,
      notes: parsed.notes ?? null,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await applyEdge(
      this.db,
      {
        from_type: "person",
        from_id: parsed.from_person_id,
        edge_type: "INTRODUCED",
        to_type: "person",
        to_id: parsed.target_person_id,
        confidence: 0.92,
        strength: 0.8,
        last_seen_at: nowIso(),
        last_confirmed_at: nowIso()
      },
      resolvedActor
    );

    await applyEdge(
      this.db,
      {
        from_type: "person",
        from_id: parsed.target_person_id,
        edge_type: "REFERRED_BY",
        to_type: "person",
        to_id: parsed.from_person_id,
        confidence: 0.9,
        strength: 0.75,
        last_seen_at: nowIso(),
        last_confirmed_at: nowIso()
      },
      resolvedActor
    );

    await audit(this.db, "intro", id, "intro.create", resolvedActor, parsed);
    return this.db.findById("intros", id);
  }

  async addOpportunity(input: OpportunityInput, actor?: ActorInput) {
    const parsed = OpportunityInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("opportunity");
    await this.db.insert("opportunities", {
      id,
      external_id: parsed.external_id ?? null,
      title: parsed.title,
      company_id: parsed.company_id,
      stage: parsed.stage,
      status: parsed.status,
      value: parsed.value ?? null,
      notes: parsed.notes ?? null,
      owner_id: parsed.owner_id ?? null,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await applyEdge(
      this.db,
      {
        from_type: "company",
        from_id: parsed.company_id,
        edge_type: "ASSOCIATED_WITH_OPPORTUNITY",
        to_type: "opportunity",
        to_id: id,
        confidence: 0.95,
        strength: 0.9,
        last_seen_at: nowIso(),
        last_confirmed_at: nowIso()
      },
      resolvedActor
    );

    for (const personId of parsed.person_ids) {
      await applyEdge(
        this.db,
        {
          from_type: "person",
          from_id: personId,
          edge_type: "ASSOCIATED_WITH_OPPORTUNITY",
          to_type: "opportunity",
          to_id: id,
          confidence: 0.88,
          strength: 0.75,
          last_seen_at: nowIso(),
          last_confirmed_at: nowIso()
        },
        resolvedActor
      );
    }

    await audit(this.db, "opportunity", id, "opportunity.create", resolvedActor, parsed);
    return this.db.hydrateEntity("opportunities", id);
  }

  async addLead(input: LeadInput, actor?: ActorInput) {
    const parsed = LeadInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("lead");
    await this.db.insert("leads", {
      id,
      external_id: parsed.external_id ?? null,
      entity_type: parsed.entity_type,
      entity_id: parsed.entity_id,
      source_type: parsed.source_type,
      source_name: parsed.source_name,
      source_url: parsed.source_url ?? null,
      utm_source: parsed.utm_source ?? null,
      utm_medium: parsed.utm_medium ?? null,
      utm_campaign: parsed.utm_campaign ?? null,
      utm_term: parsed.utm_term ?? null,
      utm_content: parsed.utm_content ?? null,
      captured_at: parsed.captured_at,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await applyEdge(
      this.db,
      {
        from_type: parsed.entity_type,
        from_id: parsed.entity_id,
        edge_type: "LEAD_SOURCE_FOR",
        to_type: "lead",
        to_id: id,
        confidence: 0.85,
        strength: 0.6,
        last_seen_at: parsed.captured_at,
        last_confirmed_at: parsed.captured_at
      },
      resolvedActor
    );

    await audit(this.db, "lead", id, "lead.create", resolvedActor, parsed);
    return this.db.findById("leads", id);
  }

  async addObservation(input: ObservationInput, actor?: ActorInput) {
    const parsed = ObservationInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const id = makeId("observation");

    await this.db.insert("observations", {
      id,
      subject_type: parsed.subject_type,
      subject_id: parsed.subject_id,
      observation_type: parsed.observation_type,
      object_type: parsed.object_type ?? null,
      object_id: parsed.object_id ?? null,
      value_json: serializeJson(parsed.value_json),
      confidence: parsed.confidence,
      evidence_id: parsed.evidence_id,
      observed_at: parsed.observed_at ?? nowIso(),
      status: parsed.status,
      created_at: nowIso(),
      updated_at: nowIso()
    });

    await audit(this.db, "observation", id, "observation.create", resolvedActor, parsed);
    return this.db.findById("observations", id);
  }

  async defineStages(entityType: "person" | "company" | "opportunity" | "lead", definitions: unknown[], actor?: ActorInput) {
    const resolvedActor = normalizeActor(actor);
    const parsed = definitions.map((definition) =>
      StageDefinitionSchema.parse({
        entity_type: entityType,
        ...(definition as Record<string, unknown>)
      })
    );

    await this.db.upsertStageDefinitions(
      parsed.map((definition) => ({
        id: makeId("stage"),
        entity_type: definition.entity_type,
        key: definition.key,
        label: definition.label,
        description: definition.description,
        sort_order: definition.sort_order,
        metadata_json: serializeJson(definition.metadata)
      }))
    );

    await audit(this.db, entityType, null, "stage.define", resolvedActor, parsed);
    return this.listStages(entityType);
  }

  async listStages(entityType: "person" | "company" | "opportunity" | "lead") {
    const rows = await this.db.listStageDefinitions(entityType);
    return rows.map((row) => ({
      ...row,
      key: String(row.key),
      metadata: parseJson(row.metadata_json, {})
    })) as Array<{ key: string; [key: string]: unknown }>;
  }

  async setStage(
    input: { entity_type: "person" | "company" | "opportunity" | "lead"; entity_id: string; stage: string; source_evidence_id?: string },
    actor?: ActorInput
  ) {
    const parsed = StageSetInputSchema.parse(input);
    const resolvedActor = normalizeActor(actor);
    const stages = await this.listStages(parsed.entity_type);
    const exists = stages.some((stage) => stage.key === parsed.stage);
    if (!exists) {
      throw new Error(`Stage "${parsed.stage}" is not defined for ${parsed.entity_type}.`);
    }

    let table = "";
    let fromStage: string | null = null;
    if (parsed.entity_type === "opportunity") {
      table = "opportunities";
      const row = await this.db.findById(table, parsed.entity_id);
      fromStage = row?.stage ? String(row.stage) : null;
      await this.db.updateById(table, parsed.entity_id, {
        stage: parsed.stage,
        updated_at: nowIso()
      });
    } else if (parsed.entity_type === "person") {
      table = "people";
      const row = await this.db.findById(table, parsed.entity_id);
      fromStage = row?.lifecycle_stage ? String(row.lifecycle_stage) : null;
      await this.db.updateById(table, parsed.entity_id, {
        lifecycle_stage: parsed.stage,
        updated_at: nowIso()
      });
    } else if (parsed.entity_type === "company") {
      table = "companies";
      const row = await this.db.findById(table, parsed.entity_id);
      fromStage = row?.lifecycle_stage ? String(row.lifecycle_stage) : null;
      await this.db.updateById(table, parsed.entity_id, {
        lifecycle_stage: parsed.stage,
        updated_at: nowIso()
      });
    } else {
      table = "leads";
      fromStage = null;
    }

    await this.db.insertStageHistory({
      id: makeId("stage_history"),
      entity_type: parsed.entity_type,
      entity_id: parsed.entity_id,
      from_stage: fromStage,
      to_stage: parsed.stage,
      changed_by: resolvedActor.actor,
      change_source: resolvedActor.source,
      reason: resolvedActor.reason ?? null,
      source_evidence_id: parsed.source_evidence_id ?? null
    });

    await audit(this.db, parsed.entity_type, parsed.entity_id, "stage.set", resolvedActor, parsed);
    return {
      entity_type: parsed.entity_type,
      entity_id: parsed.entity_id,
      from_stage: fromStage,
      to_stage: parsed.stage
    };
  }

  async showPerson(id: string) {
    const entity = await this.db.hydrateEntity("people", id);
    if (!entity) {
      throw new Error(`Person "${id}" not found.`);
    }

    const edges = await this.db.listEdgesForEntity("person", id);
    const timeline = await this.db.listTimeline("person", id);
    const refs = edges.flatMap((edge) => [
      { entity_type: String(edge.from_type), id: String(edge.from_id) },
      { entity_type: String(edge.to_type), id: String(edge.to_id) }
    ]);
    const summaries = await collectEntitySummaries(this.db, refs);
    const labelLookup = Object.fromEntries(summaries.map((summary) => [summary.id, summary.label]));

    return {
      entity,
      relationships: edges,
      timeline,
      card: CardViewPayloadSchema.parse(
        buildCardViewPayload({
          title: `${entity.first_name} ${entity.last_name}`,
          entity,
          edges: edges as never[],
          labelLookup,
          timeline: timeline.map((entry) => ({
            id: String(entry.id),
            summary: String(entry.summary),
            happened_at: String(entry.happened_at),
            type: entry.timeline_type ? String(entry.timeline_type) : undefined
          }))
        })
      )
    };
  }

  async showCompany(id: string) {
    const entity = await this.db.hydrateEntity("companies", id);
    if (!entity) {
      throw new Error(`Company "${id}" not found.`);
    }

    const edges = await this.db.listEdgesForEntity("company", id);
    const timeline = await this.db.listTimeline("company", id);
    const refs = edges.flatMap((edge) => [
      { entity_type: String(edge.from_type), id: String(edge.from_id) },
      { entity_type: String(edge.to_type), id: String(edge.to_id) }
    ]);
    const summaries = await collectEntitySummaries(this.db, refs);
    const labelLookup = Object.fromEntries(summaries.map((summary) => [summary.id, summary.label]));

    return {
      entity,
      relationships: edges,
      timeline,
      card: CardViewPayloadSchema.parse(
        buildCardViewPayload({
          title: String(entity.name),
          entity,
          edges: edges as never[],
          labelLookup,
          timeline: timeline.map((entry) => ({
            id: String(entry.id),
            summary: String(entry.summary),
            happened_at: String(entry.happened_at),
            type: entry.timeline_type ? String(entry.timeline_type) : undefined
          }))
        })
      )
    };
  }

  async graphEntity(entityType: "person" | "company", id: string, depth = 2) {
    const entity =
      entityType === "person"
        ? await this.db.hydrateEntity("people", id)
        : await this.db.hydrateEntity("companies", id);

    if (!entity) {
      throw new Error(`${entityType} "${id}" not found.`);
    }

    const neighborhood = await collectNeighborhood(this.db, entityType, id, depth);
    const summaries = await collectEntitySummaries(this.db, neighborhood.refs);
    const edgeEvidence = await this.db.listEdgeEvidence(neighborhood.edges.map((edge) => String(edge.id)));
    const evidenceIds = [...new Set(edgeEvidence.flatMap((item) => [item.evidence_id]).filter(Boolean).map(String))];
    const evidence = await this.db.listEvidenceByIds(evidenceIds);

    return GraphViewPayloadSchema.parse(
      buildGraphViewPayload({
        title: entityType === "person" ? `${entity.first_name} ${entity.last_name}` : String(entity.name),
        focusId: id,
        entities: summaries.map((summary) => ({
          ...summary,
          meta: summary.meta ?? {}
        })),
        edges: neighborhood.edges as never[],
        evidence: evidence.map((item) => ({
          id: String(item.id),
          title: String(item.title),
          snippet: item.snippet ? String(item.snippet) : undefined,
          happened_at: item.happened_at ? String(item.happened_at) : undefined,
          source_url: item.source_url ? String(item.source_url) : undefined
        }))
      })
    );
  }

  async graphPath(fromId: string, toId: string) {
    const edges = await this.db.listWhere<Record<string, unknown>>("edges");
    return rankPaths(edges as never[], fromId, toId).map((path) => PathResultSchema.parse(path));
  }

  async query(text: string) {
    return this.db.searchAcrossEntities(text);
  }

  async importRows(entityName: EntityName, rows: unknown[], actor?: ActorInput) {
    const results: unknown[] = [];
    for (const row of rows) {
      if (entityName === "person") {
        results.push(await this.upsertPerson(row as PersonInput, actor));
        continue;
      }
      if (entityName === "company") {
        results.push(await this.upsertCompany(row as CompanyInput, actor));
        continue;
      }
      if (entityName === "interaction") {
        results.push(await this.addInteraction(row as InteractionInput, actor));
        continue;
      }
      if (entityName === "task") {
        results.push(await this.addTask(row as TaskInput, actor));
        continue;
      }
      if (entityName === "intro") {
        results.push(await this.addIntro(row as IntroInput, actor));
        continue;
      }
      if (entityName === "opportunity") {
        results.push(await this.addOpportunity(row as OpportunityInput, actor));
        continue;
      }
      results.push(await this.addLead(row as LeadInput, actor));
    }

    return results;
  }

  async applyProposal(
    proposal: ExtractedProposal,
    actor?: ActorInput
  ): Promise<{
    people: unknown[];
    companies: unknown[];
    interactions: unknown[];
    opportunities: unknown[];
    leads: unknown[];
    observations: unknown[];
    stage_updates: unknown[];
  }> {
    const people = [];
    const companies = [];
    const interactions = [];
    const opportunities = [];
    const leads = [];
    const observations = [];
    const stageUpdates = [];
    const personIds: string[] = [];
    const companyIds: string[] = [];

    for (const company of proposal.companies) {
      const created = await this.upsertCompany(company, actor);
      companies.push(created);
      if (created?.id) {
        companyIds.push(String(created.id));
      }
    }

    for (const person of proposal.people) {
      const enriched = {
        ...person,
        current_company_id: person.current_company_id ?? companyIds[0]
      };
      const created = await this.upsertPerson(enriched, actor);
      people.push(created);
      if (created?.id) {
        personIds.push(String(created.id));
      }
    }

    for (const interaction of proposal.interactions) {
      interactions.push(
        await this.addInteraction(
          {
            ...interaction,
            person_ids: interaction.person_ids.length > 0 ? interaction.person_ids : personIds,
            company_ids: interaction.company_ids.length > 0 ? interaction.company_ids : companyIds
          },
          actor
        )
      );
    }

    for (const opportunity of proposal.opportunities) {
      opportunities.push(
        await this.addOpportunity(
          {
            ...opportunity,
            company_id:
              opportunity.company_id === "pending_company" ? companyIds[0] ?? opportunity.company_id : opportunity.company_id,
            person_ids: opportunity.person_ids.length > 0 ? opportunity.person_ids : personIds
          },
          actor
        )
      );
    }

    for (const lead of proposal.leads) {
      leads.push(await this.addLead(lead, actor));
    }

    const evidenceRow = interactions[0]
      ? await this.db.listWhere<Record<string, unknown>>("evidence", "title = ?", [String((interactions[0] as Record<string, unknown>).summary ?? "")])
      : [];
    const fallbackEvidenceId = evidenceRow[0]?.id ? String(evidenceRow[0].id) : undefined;

    for (const observation of proposal.observations) {
      observations.push(
        await this.addObservation(
          {
            ...observation,
            subject_id:
              observation.subject_id === "pending_interaction"
                ? String((interactions[0] as Record<string, unknown>)?.id ?? observation.subject_id)
                : observation.subject_id,
            evidence_id: fallbackEvidenceId ?? observation.evidence_id
          },
          actor
        )
      );
    }

    for (const stageUpdate of proposal.stage_updates) {
      stageUpdates.push(
        await this.setStage(
          {
            ...stageUpdate,
            entity_id:
              stageUpdate.entity_id === "pending_company"
                ? companyIds[0] ?? stageUpdate.entity_id
                : stageUpdate.entity_id
          },
          actor
        )
      );
    }

    return {
      people,
      companies,
      interactions,
      opportunities,
      leads,
      observations,
      stage_updates: stageUpdates
    };
  }

  async mergePeople(sourceId: string, targetId: string, actor?: ActorInput) {
    const source = await this.db.hydrateEntity("people", sourceId);
    const target = await this.db.hydrateEntity("people", targetId);
    if (!source || !target) {
      throw new Error("Both source and target people must exist to merge.");
    }

    const mergedNotes = [target.notes, source.notes].filter(Boolean).join("\n\n");
    const mergedSourceUrls = [...new Set([...(target.source_urls as string[]), ...(source.source_urls as string[])])];
    await this.db.updateById("people", targetId, {
      notes: mergedNotes || null,
      source_urls_json: serializeJson(mergedSourceUrls),
      updated_at: nowIso()
    });

    await this.db.updateById("edges", sourceId, {});
    await this.db.run("UPDATE edges SET from_id = ? WHERE from_type = 'person' AND from_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE edges SET to_id = ? WHERE to_type = 'person' AND to_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE entity_aliases SET entity_id = ? WHERE entity_type = 'person' AND entity_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE contact_points SET owner_id = ? WHERE owner_type = 'person' AND owner_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE property_values SET entity_id = ? WHERE entity_type = 'person' AND entity_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE observations SET subject_id = ? WHERE subject_type = 'person' AND subject_id = ?", [targetId, sourceId]);
    await this.db.run("UPDATE leads SET entity_id = ? WHERE entity_type = 'person' AND entity_id = ?", [targetId, sourceId]);
    await this.db.deleteWhere("people", "id = ?", [sourceId]);

    await audit(this.db, "person", targetId, "person.merge", actor ?? { actor: "system", source: "cli" }, {
      source_id: sourceId,
      target_id: targetId
    });

    return this.db.hydrateEntity("people", targetId);
  }
}

