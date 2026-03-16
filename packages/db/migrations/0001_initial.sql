CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  current_company_id TEXT,
  current_role TEXT,
  notes TEXT,
  lifecycle_stage TEXT,
  lead_status TEXT,
  owner_id TEXT,
  last_activity_at TEXT,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  custom_properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  domain TEXT,
  notes TEXT,
  lifecycle_stage TEXT,
  owner_id TEXT,
  last_activity_at TEXT,
  source_urls_json TEXT NOT NULL DEFAULT '[]',
  custom_properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_points (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  type TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  source_url TEXT,
  outcome TEXT,
  next_step TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  due_at TEXT,
  reminder_at TEXT,
  assigned_to TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intros (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  from_person_id TEXT NOT NULL,
  to_person_id TEXT NOT NULL,
  target_person_id TEXT NOT NULL,
  interaction_id TEXT,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  title TEXT NOT NULL,
  company_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  value REAL,
  notes TEXT,
  owner_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  captured_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  raw_text TEXT,
  snippet TEXT,
  happened_at TEXT,
  never_send_to_model INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  observation_type TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  value_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL,
  evidence_id TEXT NOT NULL,
  observed_at TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_id TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  label TEXT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_from TEXT,
  valid_to TEXT,
  last_seen_at TEXT,
  last_confirmed_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  is_inferred INTEGER NOT NULL DEFAULT 0,
  strength REAL NOT NULL,
  confidence REAL NOT NULL,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  path_score_hint REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_evidence (
  id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL,
  evidence_id TEXT,
  observation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS property_definitions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  data_type TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, key)
);

CREATE TABLE IF NOT EXISTS property_values (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id, key)
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  alias_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, alias_type, alias_value)
);

CREATE TABLE IF NOT EXISTS stage_definitions (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, key)
);

CREATE TABLE IF NOT EXISTS stage_history (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_source TEXT NOT NULL,
  reason TEXT,
  source_evidence_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  source TEXT NOT NULL,
  reason TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_points_owner ON contact_points(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_type, to_id);
CREATE INDEX IF NOT EXISTS idx_stage_history_entity ON stage_history(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_lookup ON entity_aliases(entity_type, alias_type, alias_value);
