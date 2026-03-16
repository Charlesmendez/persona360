import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const entityTypes = [
  "person",
  "company",
  "interaction",
  "task",
  "intro",
  "opportunity",
  "lead",
  "evidence",
  "observation"
] as const;

export const relationshipEdgeTypes = [
  "WORKS_AT",
  "WORKED_AT",
  "KNOWS",
  "REPORTS_TO",
  "PARTICIPATED_IN",
  "INTRODUCED",
  "REFERRED_BY",
  "ASSIGNED_TO",
  "ASSOCIATED_WITH_OPPORTUNITY",
  "INFLUENCES",
  "BLOCKS",
  "LEAD_SOURCE_FOR",
  "CHAMPION_FOR",
  "DECISION_MAKER_FOR",
  "INFLUENCER_ON",
  "BLOCKER_ON",
  "PROCUREMENT_OWNER_FOR",
  "LEGAL_REVIEWER_FOR",
  "LEFT_COMPANY",
  "DO_NOT_CONTACT",
  "LOST_TO_COMPETITOR",
  "NO_LONGER_REPORTS_TO",
  "PARENT_OF",
  "SUBSIDIARY_OF",
  "PARTNER_OF",
  "CUSTOMER_OF",
  "VENDOR_OF",
  "INVESTOR_IN"
] as const;

export const interactionTypes = [
  "call",
  "meeting",
  "email",
  "note",
  "dm",
  "event"
] as const;

export const stageEntityTypes = ["person", "company", "opportunity", "lead"] as const;

export const leadSourceTypes = [
  "referral",
  "website",
  "event",
  "outbound",
  "inbound",
  "partner",
  "manual"
] as const;

export const taskStatuses = [
  "not_started",
  "in_progress",
  "completed",
  "cancelled"
] as const;

export const taskPriorities = ["low", "medium", "high"] as const;

export const EntityTypeSchema = z.enum(entityTypes);
export const StageEntityTypeSchema = z.enum(stageEntityTypes);
export const RelationshipEdgeTypeSchema = z.enum(relationshipEdgeTypes);
export const InteractionTypeSchema = z.enum(interactionTypes);
export const LeadSourceTypeSchema = z.enum(leadSourceTypes);
export const TaskStatusSchema = z.enum(taskStatuses);
export const TaskPrioritySchema = z.enum(taskPriorities);

export const TimestampSchema = z.string().datetime({ offset: true });

export const BaseRecordSchema = z.object({
  id: z.string().min(1),
  created_at: TimestampSchema,
  updated_at: TimestampSchema
});

export const ContactPointSchema = z.object({
  type: z.enum(["email", "phone", "address", "url"]),
  value: z.string().min(1),
  label: z.string().min(1).optional()
});

export const CustomPropertyValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.record(z.string(), z.unknown()),
  z.null()
]);

export const ActorSchema = z.object({
  actor: z.string().min(1).default("system"),
  source: z.string().min(1).default("cli"),
  reason: z.string().min(1).optional()
});

export const PersonInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  first_name: z.string().min(1),
  middle_name: z.string().min(1).optional(),
  last_name: z.string().min(1),
  current_company_id: z.string().min(1).optional(),
  current_role: z.string().min(1).optional(),
  notes: z.string().optional(),
  lifecycle_stage: z.string().min(1).optional(),
  lead_status: z.string().min(1).optional(),
  owner_id: z.string().min(1).optional(),
  last_activity_at: TimestampSchema.optional(),
  contact_points: z.array(ContactPointSchema).default([]),
  source_urls: z.array(z.string().url()).default([]),
  custom_properties: z.record(z.string(), CustomPropertyValueSchema).default({})
});

export const CompanyInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  name: z.string().min(1),
  domain: z.string().min(1).optional(),
  notes: z.string().optional(),
  lifecycle_stage: z.string().min(1).optional(),
  owner_id: z.string().min(1).optional(),
  last_activity_at: TimestampSchema.optional(),
  contact_points: z.array(ContactPointSchema).default([]),
  source_urls: z.array(z.string().url()).default([]),
  custom_properties: z.record(z.string(), CustomPropertyValueSchema).default({})
});

export const InteractionInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  type: InteractionTypeSchema,
  happened_at: TimestampSchema,
  summary: z.string().min(1),
  raw_text: z.string().min(1),
  source_url: z.string().url().optional(),
  outcome: z.string().optional(),
  next_step: z.string().optional(),
  person_ids: z.array(z.string().min(1)).default([]),
  company_ids: z.array(z.string().min(1)).default([]),
  opportunity_ids: z.array(z.string().min(1)).default([])
});

export const TaskInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  status: TaskStatusSchema.default("not_started"),
  priority: TaskPrioritySchema.default("medium"),
  due_at: TimestampSchema.optional(),
  reminder_at: TimestampSchema.optional(),
  assigned_to: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
  person_ids: z.array(z.string().min(1)).default([]),
  company_ids: z.array(z.string().min(1)).default([]),
  opportunity_ids: z.array(z.string().min(1)).default([])
});

export const IntroInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  from_person_id: z.string().min(1),
  to_person_id: z.string().min(1),
  target_person_id: z.string().min(1),
  interaction_id: z.string().min(1).optional(),
  status: z.string().min(1).default("pending"),
  notes: z.string().optional()
});

export const OpportunityInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  title: z.string().min(1),
  company_id: z.string().min(1),
  person_ids: z.array(z.string().min(1)).default([]),
  stage: z.string().min(1),
  status: z.string().min(1).default("open"),
  value: z.number().finite().optional(),
  notes: z.string().optional(),
  owner_id: z.string().min(1).optional()
});

export const LeadInputSchema = z.object({
  external_id: z.string().min(1).optional(),
  entity_type: z.union([z.literal("person"), z.literal("company")]),
  entity_id: z.string().min(1),
  source_type: LeadSourceTypeSchema,
  source_name: z.string().min(1),
  source_url: z.string().url().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  captured_at: TimestampSchema
});

export const StageDefinitionSchema = z.object({
  entity_type: StageEntityTypeSchema,
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  label: z.string().min(1),
  description: z.string().optional(),
  sort_order: z.number().int().nonnegative(),
  metadata: z.record(z.string(), z.unknown()).default({})
});

export const StageSetInputSchema = z.object({
  entity_type: StageEntityTypeSchema,
  entity_id: z.string().min(1),
  stage: z.string().min(1).regex(/^[a-z0-9_-]+$/),
  source_evidence_id: z.string().min(1).optional()
});

export const ObservationInputSchema = z.object({
  subject_type: EntityTypeSchema,
  subject_id: z.string().min(1),
  observation_type: z.string().min(1),
  object_type: EntityTypeSchema.optional(),
  object_id: z.string().min(1).optional(),
  value_json: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence_id: z.string().min(1),
  observed_at: TimestampSchema.optional(),
  status: z.enum(["pending", "accepted", "rejected"]).default("pending")
});

export const EdgeInputSchema = z.object({
  from_type: EntityTypeSchema,
  from_id: z.string().min(1),
  edge_type: RelationshipEdgeTypeSchema,
  to_type: EntityTypeSchema,
  to_id: z.string().min(1),
  label: z.string().optional(),
  direction: z.enum(["forward", "bidirectional"]).default("forward"),
  status: z.enum(["active", "inactive"]).default("active"),
  valid_from: TimestampSchema.optional(),
  valid_to: TimestampSchema.optional(),
  last_seen_at: TimestampSchema.optional(),
  last_confirmed_at: TimestampSchema.optional(),
  is_current: z.boolean().default(true),
  is_inferred: z.boolean().default(false),
  strength: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence_count: z.number().int().nonnegative().default(1),
  path_score_hint: z.number().min(0).default(0),
  source_evidence_id: z.string().min(1).optional()
});

export const ViewerNodeSchema = z.object({
  id: z.string().min(1),
  type: EntityTypeSchema,
  label: z.string().min(1),
  subtitle: z.string().optional(),
  stale: z.boolean().default(false),
  meta: z.record(z.string(), z.unknown()).default({})
});

export const ViewerEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.string().min(1),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  strength: z.number().min(0).max(1).default(0.5),
  stale: z.boolean().default(false),
  evidence_ids: z.array(z.string()).default([])
});

export const GraphViewPayloadSchema = z.object({
  title: z.string().min(1),
  focus_id: z.string().min(1),
  nodes: z.array(ViewerNodeSchema),
  edges: z.array(ViewerEdgeSchema),
  evidence: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      snippet: z.string().optional(),
      happened_at: TimestampSchema.optional(),
      source_url: z.string().url().optional()
    })
  ),
  meta: z.record(z.string(), z.unknown()).default({})
});

export const CardViewPayloadSchema = z.object({
  title: z.string().min(1),
  entity: z.record(z.string(), z.unknown()),
  relationships: z.array(
    z.object({
      edge_type: z.string().min(1),
      target_label: z.string().min(1),
      strength: z.number().min(0).max(1).default(0.5),
      confidence: z.number().min(0).max(1).default(0.5)
    })
  ),
  timeline: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      happened_at: TimestampSchema,
      summary: z.string().min(1)
    })
  ),
  meta: z.record(z.string(), z.unknown()).default({})
});

export const PathResultSchema = z.object({
  score: z.number(),
  hops: z.array(
    z.object({
      edge_id: z.string().min(1),
      from_id: z.string().min(1),
      to_id: z.string().min(1),
      edge_type: z.string().min(1),
      strength: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1)
    })
  ),
  evidence_ids: z.array(z.string()).default([])
});

export const ExtractedProposalSchema = z.object({
  people: z.array(PersonInputSchema).default([]),
  companies: z.array(CompanyInputSchema).default([]),
  interactions: z.array(InteractionInputSchema).default([]),
  opportunities: z.array(OpportunityInputSchema).default([]),
  leads: z.array(LeadInputSchema).default([]),
  observations: z.array(ObservationInputSchema).default([]),
  stage_updates: z.array(StageSetInputSchema).default([])
});

export const QueryPlanSchema = z.object({
  action: z.enum(["search", "graph_person", "graph_company", "path", "show_person", "show_company"]),
  query: z.string().optional(),
  entity_id: z.string().optional(),
  from_id: z.string().optional(),
  to_id: z.string().optional()
});

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string()).default([]),
  data: z.record(z.string(), z.unknown()).optional()
});

export type EntityType = z.infer<typeof EntityTypeSchema>;
export type StageEntityType = z.infer<typeof StageEntityTypeSchema>;
export type RelationshipEdgeType = z.infer<typeof RelationshipEdgeTypeSchema>;
export type PersonInput = z.infer<typeof PersonInputSchema>;
export type CompanyInput = z.infer<typeof CompanyInputSchema>;
export type InteractionInput = z.infer<typeof InteractionInputSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type IntroInput = z.infer<typeof IntroInputSchema>;
export type OpportunityInput = z.infer<typeof OpportunityInputSchema>;
export type LeadInput = z.infer<typeof LeadInputSchema>;
export type StageDefinition = z.infer<typeof StageDefinitionSchema>;
export type StageSetInput = z.infer<typeof StageSetInputSchema>;
export type ObservationInput = z.infer<typeof ObservationInputSchema>;
export type EdgeInput = z.infer<typeof EdgeInputSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type ExtractedProposal = z.infer<typeof ExtractedProposalSchema>;
export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type GraphViewPayload = z.infer<typeof GraphViewPayloadSchema>;
export type CardViewPayload = z.infer<typeof CardViewPayloadSchema>;
export type PathResult = z.infer<typeof PathResultSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;

export const commandSchemas = {
  person: PersonInputSchema,
  company: CompanyInputSchema,
  interaction: InteractionInputSchema,
  task: TaskInputSchema,
  intro: IntroInputSchema,
  opportunity: OpportunityInputSchema,
  lead: LeadInputSchema,
  observation: ObservationInputSchema,
  edge: EdgeInputSchema,
  stageDefinition: StageDefinitionSchema,
  stageSet: StageSetInputSchema
} as const;

export function getCommandJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(commandSchemas).map(([name, schema]) => [
      name,
      zodToJsonSchema(schema as any, name)
    ])
  );
}

