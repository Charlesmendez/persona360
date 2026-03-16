import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Pool } from "pg";

export type DatabaseDialect = "sqlite" | "postgres";

export interface DatabaseConfig {
  dialect: DatabaseDialect;
  connectionString: string;
  storagePath?: string;
}

export interface ProjectConfigFile {
  databaseUrl?: string;
  sqlitePath?: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

interface Adapter {
  dialect: DatabaseDialect;
  run(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

const CONFIG_FILE = "persona360.config.json";
const DEFAULT_SQLITE_DIR = ".persona360";
const DEFAULT_SQLITE_PATH = ".persona360/persona.db";

function nowIso(): string {
  return new Date().toISOString();
}

function toPostgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function readStatements(migrationSql: string): string[] {
  return migrationSql
    .split(/;\s*\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function normalizeDatabaseUrl(raw: string): DatabaseConfig {
  if (raw.startsWith("postgres://") || raw.startsWith("postgresql://")) {
    return {
      dialect: "postgres",
      connectionString: raw
    };
  }

  if (raw.startsWith("sqlite://")) {
    const storagePath = raw.replace("sqlite://", "");
    return {
      dialect: "sqlite",
      connectionString: raw,
      storagePath
    };
  }

  return {
    dialect: "sqlite",
    connectionString: `sqlite://${raw}`,
    storagePath: raw
  };
}

export function readProjectConfig(cwd: string): ProjectConfigFile | null {
  const filePath = join(cwd, CONFIG_FILE);
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as ProjectConfigFile;
}

export function writeProjectConfig(cwd: string, config: ProjectConfigFile): string {
  const filePath = join(cwd, CONFIG_FILE);
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return filePath;
}

export function resolveDatabaseConfig(cwd: string, overrides?: { databaseUrl?: string }): DatabaseConfig {
  const envDatabaseUrl =
    overrides?.databaseUrl ??
    process.env.PERSONA360_DATABASE_URL ??
    process.env.DATABASE_URL;

  if (envDatabaseUrl) {
    return normalizeDatabaseUrl(envDatabaseUrl);
  }

  const fileConfig = readProjectConfig(cwd);
  if (fileConfig?.databaseUrl) {
    return normalizeDatabaseUrl(fileConfig.databaseUrl);
  }

  const sqlitePath = fileConfig?.sqlitePath ?? DEFAULT_SQLITE_PATH;
  const absoluteSqlitePath = resolve(cwd, sqlitePath);

  return {
    dialect: "sqlite",
    connectionString: `sqlite://${absoluteSqlitePath}`,
    storagePath: absoluteSqlitePath
  };
}

function ensureSqliteStorage(config: DatabaseConfig): void {
  if (config.dialect !== "sqlite" || !config.storagePath) {
    return;
  }

  mkdirSync(dirname(config.storagePath), { recursive: true });
}

class SQLiteAdapter implements Adapter {
  public readonly dialect = "sqlite" as const;
  private readonly db: Database.Database;

  constructor(storagePath: string) {
    ensureSqliteStorage({
      dialect: "sqlite",
      connectionString: `sqlite://${storagePath}`,
      storagePath
    });
    this.db = new Database(storagePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...params);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const rows = this.db.prepare(sql).all(...params) as T[];
    return {
      rows,
      rowCount: rows.length
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class PostgresAdapter implements Adapter {
  public readonly dialect = "postgres" as const;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.pool.query(toPostgresSql(sql), params);
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = (await this.pool.query(toPostgresSql(sql), params)) as unknown as {
      rows: T[];
      rowCount?: number;
    };
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class PersonaDatabase {
  public readonly config: DatabaseConfig;
  private readonly adapter: Adapter;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.adapter =
      config.dialect === "sqlite"
        ? new SQLiteAdapter(config.storagePath ?? DEFAULT_SQLITE_PATH)
        : new PostgresAdapter(config.connectionString);
  }

  static async connect(cwd: string, overrides?: { databaseUrl?: string }): Promise<PersonaDatabase> {
    const config = resolveDatabaseConfig(cwd, overrides);
    return new PersonaDatabase(config);
  }

  async close(): Promise<void> {
    await this.adapter.close();
  }

  async testConnection(): Promise<{ ok: true; dialect: DatabaseDialect }> {
    await this.adapter.query("SELECT 1 AS ok");
    return {
      ok: true,
      dialect: this.adapter.dialect
    };
  }

  async migrate(): Promise<void> {
    const migrationPath = join(__dirname, "..", "migrations", "0001_initial.sql");
    const sql = readFileSync(migrationPath, "utf8");
    const statements = readStatements(sql);

    for (const statement of statements) {
      await this.adapter.run(statement);
    }
  }

  async transaction<T>(callback: (db: PersonaDatabase) => Promise<T>): Promise<T> {
    await this.adapter.run("BEGIN");
    try {
      const result = await callback(this);
      await this.adapter.run("COMMIT");
      return result;
    } catch (error) {
      await this.adapter.run("ROLLBACK");
      throw error;
    }
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    await this.adapter.run(sql, params);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.adapter.query<T>(sql, params);
  }

  async findById(table: string, id: string): Promise<Record<string, unknown> | null> {
    const result = await this.adapter.query(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`, [id]);
    return result.rows[0] ?? null;
  }

  async findByExternalId(table: string, externalId: string): Promise<Record<string, unknown> | null> {
    const result = await this.adapter.query(
      `SELECT * FROM ${table} WHERE external_id = ? LIMIT 1`,
      [externalId]
    );
    return result.rows[0] ?? null;
  }

  async insert(table: string, record: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(record);
    const columns = entries.map(([key]) => key).join(", ");
    const placeholders = entries.map(() => "?").join(", ");
    const values = entries.map(([, value]) => value);
    await this.adapter.run(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders})`,
      values
    );
  }

  async updateById(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(patch);
    if (entries.length === 0) {
      return;
    }

    const sets = entries.map(([key]) => `${key} = ?`).join(", ");
    const values = entries.map(([, value]) => value);
    await this.adapter.run(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...values, id]);
  }

  async deleteWhere(table: string, clause: string, params: unknown[] = []): Promise<void> {
    await this.adapter.run(`DELETE FROM ${table} WHERE ${clause}`, params);
  }

  async listWhere<T = Record<string, unknown>>(
    table: string,
    clause = "1 = 1",
    params: unknown[] = [],
    orderBy?: string
  ): Promise<T[]> {
    const order = orderBy ? ` ORDER BY ${orderBy}` : "";
    const result = await this.adapter.query<T>(
      `SELECT * FROM ${table} WHERE ${clause}${order}`,
      params
    );
    return result.rows;
  }

  async replaceContactPoints(
    ownerType: string,
    ownerId: string,
    points: Array<{ id: string; type: string; value: string; label?: string | null }>
  ): Promise<void> {
    await this.deleteWhere("contact_points", "owner_type = ? AND owner_id = ?", [ownerType, ownerId]);

    for (const point of points) {
      await this.insert("contact_points", {
        id: point.id,
        owner_type: ownerType,
        owner_id: ownerId,
        type: point.type,
        value: point.value,
        label: point.label ?? null,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }

  async replacePropertyValues(
    entityType: string,
    entityId: string,
    values: Record<string, unknown>
  ): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      const existing = await this.adapter.query(
        "SELECT id FROM property_values WHERE entity_type = ? AND entity_id = ? AND key = ? LIMIT 1",
        [entityType, entityId, key]
      );

      if (existing.rows[0]?.id) {
        await this.updateById("property_values", String(existing.rows[0].id), {
          value_json: serializeJson(value),
          updated_at: nowIso()
        });
        continue;
      }

      await this.insert("property_values", {
        id: `${entityType}_property_${crypto.randomUUID()}`,
        entity_type: entityType,
        entity_id: entityId,
        key,
        value_json: serializeJson(value),
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }

  async addAliases(
    entityType: string,
    entityId: string,
    aliases: Array<{ alias_type: string; alias_value: string }>
  ): Promise<void> {
    for (const alias of aliases) {
      try {
        await this.insert("entity_aliases", {
          id: `alias_${crypto.randomUUID()}`,
          entity_type: entityType,
          entity_id: entityId,
          alias_type: alias.alias_type,
          alias_value: alias.alias_value,
          created_at: nowIso(),
          updated_at: nowIso()
        });
      } catch {
        // Ignore duplicate aliases.
      }
    }
  }

  async listContactPoints(ownerType: string, ownerId: string): Promise<Array<Record<string, unknown>>> {
    return this.listWhere("contact_points", "owner_type = ? AND owner_id = ?", [ownerType, ownerId], "type ASC, value ASC");
  }

  async listPropertyValues(entityType: string, entityId: string): Promise<Record<string, unknown>> {
    const rows = await this.listWhere<Record<string, unknown>>(
      "property_values",
      "entity_type = ? AND entity_id = ?",
      [entityType, entityId]
    );

    return Object.fromEntries(
      rows.map((row) => [String(row.key), parseJson(row.value_json, null)])
    );
  }

  async listStageDefinitions(entityType: string): Promise<Array<Record<string, unknown>>> {
    return this.listWhere(
      "stage_definitions",
      "entity_type = ?",
      [entityType],
      "sort_order ASC, label ASC"
    );
  }

  async upsertStageDefinitions(
    definitions: Array<{
      id: string;
      entity_type: string;
      key: string;
      label: string;
      description?: string;
      sort_order: number;
      metadata_json: string;
    }>
  ): Promise<void> {
    for (const definition of definitions) {
      const existing = await this.adapter.query(
        "SELECT id FROM stage_definitions WHERE entity_type = ? AND key = ? LIMIT 1",
        [definition.entity_type, definition.key]
      );

      if (existing.rows[0]?.id) {
        await this.updateById("stage_definitions", String(existing.rows[0].id), {
          label: definition.label,
          description: definition.description ?? null,
          sort_order: definition.sort_order,
          metadata_json: definition.metadata_json,
          updated_at: nowIso()
        });
        continue;
      }

      await this.insert("stage_definitions", {
        ...definition,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }

  async insertStageHistory(record: {
    id: string;
    entity_type: string;
    entity_id: string;
    from_stage?: string | null;
    to_stage: string;
    changed_by: string;
    change_source: string;
    reason?: string | null;
    source_evidence_id?: string | null;
  }): Promise<void> {
    await this.insert("stage_history", {
      ...record,
      created_at: nowIso()
    });
  }

  async recordAudit(input: {
    entity_type?: string | null;
    entity_id?: string | null;
    action: string;
    actor: string;
    source: string;
    reason?: string | null;
    payload?: unknown;
  }): Promise<void> {
    await this.insert("audit_events", {
      id: `audit_${crypto.randomUUID()}`,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      action: input.action,
      actor: input.actor,
      source: input.source,
      reason: input.reason ?? null,
      payload_json: serializeJson(input.payload ?? {}),
      created_at: nowIso()
    });
  }

  async listEdgesForEntity(entityType: string, entityId: string): Promise<Array<Record<string, unknown>>> {
    return this.listWhere(
      "edges",
      "(from_type = ? AND from_id = ?) OR (to_type = ? AND to_id = ?)",
      [entityType, entityId, entityType, entityId]
    );
  }

  async listEdgesByIds(ids: string[]): Promise<Array<Record<string, unknown>>> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    return this.listWhere("edges", `id IN (${placeholders})`, ids);
  }

  async findExistingEdge(input: {
    from_type: string;
    from_id: string;
    edge_type: string;
    to_type: string;
    to_id: string;
  }): Promise<Record<string, unknown> | null> {
    const rows = await this.listWhere(
      "edges",
      "from_type = ? AND from_id = ? AND edge_type = ? AND to_type = ? AND to_id = ?",
      [input.from_type, input.from_id, input.edge_type, input.to_type, input.to_id]
    );
    return rows[0] ?? null;
  }

  async upsertEdge(record: Record<string, unknown>): Promise<string> {
    const existing = await this.findExistingEdge({
      from_type: String(record.from_type),
      from_id: String(record.from_id),
      edge_type: String(record.edge_type),
      to_type: String(record.to_type),
      to_id: String(record.to_id)
    });

    if (existing?.id) {
      await this.updateById("edges", String(existing.id), {
        label: record.label ?? existing.label ?? null,
        direction: record.direction ?? existing.direction,
        status: record.status ?? existing.status,
        valid_from: record.valid_from ?? existing.valid_from ?? null,
        valid_to: record.valid_to ?? existing.valid_to ?? null,
        last_seen_at: record.last_seen_at ?? existing.last_seen_at ?? null,
        last_confirmed_at: record.last_confirmed_at ?? existing.last_confirmed_at ?? null,
        is_current: record.is_current ?? existing.is_current ?? 1,
        is_inferred: record.is_inferred ?? existing.is_inferred ?? 0,
        strength: record.strength ?? existing.strength ?? 0.5,
        confidence: record.confidence ?? existing.confidence ?? 0.5,
        evidence_count:
          Number(existing.evidence_count ?? 0) + Number(record.evidence_count ?? 1),
        path_score_hint: record.path_score_hint ?? existing.path_score_hint ?? 0,
        updated_at: nowIso()
      });
      return String(existing.id);
    }

    const id = String(record.id);
    await this.insert("edges", {
      ...record,
      created_at: nowIso(),
      updated_at: nowIso()
    });
    return id;
  }

  async addEdgeEvidence(record: {
    id: string;
    edge_id: string;
    evidence_id?: string | null;
    observation_id?: string | null;
  }): Promise<void> {
    await this.insert("edge_evidence", {
      ...record,
      created_at: nowIso()
    });
  }

  async listEdgeEvidence(edgeIds: string[]): Promise<Array<Record<string, unknown>>> {
    if (edgeIds.length === 0) {
      return [];
    }

    const placeholders = edgeIds.map(() => "?").join(", ");
    return this.listWhere("edge_evidence", `edge_id IN (${placeholders})`, edgeIds);
  }

  async listEvidenceByIds(ids: string[]): Promise<Array<Record<string, unknown>>> {
    if (ids.length === 0) {
      return [];
    }

    const placeholders = ids.map(() => "?").join(", ");
    return this.listWhere("evidence", `id IN (${placeholders})`, ids);
  }

  async searchAcrossEntities(query: string): Promise<Array<Record<string, unknown>>> {
    const search = `%${query.toLowerCase()}%`;
    const sql = `
      SELECT 'person' AS entity_type, id, first_name || ' ' || last_name AS label, current_role AS subtitle
      FROM people
      WHERE LOWER(first_name || ' ' || last_name || ' ' || COALESCE(notes, '')) LIKE ?
      UNION ALL
      SELECT 'company' AS entity_type, id, name AS label, domain AS subtitle
      FROM companies
      WHERE LOWER(name || ' ' || COALESCE(domain, '') || ' ' || COALESCE(notes, '')) LIKE ?
      UNION ALL
      SELECT 'opportunity' AS entity_type, id, title AS label, stage AS subtitle
      FROM opportunities
      WHERE LOWER(title || ' ' || COALESCE(notes, '')) LIKE ?
      UNION ALL
      SELECT 'interaction' AS entity_type, id, summary AS label, type AS subtitle
      FROM interactions
      WHERE LOWER(summary || ' ' || raw_text) LIKE ?
    `;

    const result = await this.adapter.query(sql, [search, search, search, search]);
    return result.rows;
  }

  async listTimeline(entityType: string, entityId: string): Promise<Array<Record<string, unknown>>> {
    const interactionTimeline = await this.adapter.query(
      `
        SELECT i.id, i.happened_at, i.summary, i.type, 'interaction' AS timeline_type
        FROM interactions i
        INNER JOIN edges e
          ON e.edge_type = 'PARTICIPATED_IN'
         AND e.to_type = 'interaction'
         AND e.to_id = i.id
        WHERE e.from_type = ? AND e.from_id = ?
      `,
      [entityType, entityId]
    );

    const taskTimeline = await this.adapter.query(
      `
        SELECT t.id, COALESCE(t.due_at, t.created_at) AS happened_at, t.title AS summary, t.status AS type, 'task' AS timeline_type
        FROM tasks t
        INNER JOIN edges e
          ON e.to_type = 'task'
         AND e.to_id = t.id
        WHERE e.from_type = ? AND e.from_id = ?
      `,
      [entityType, entityId]
    );

    return [...interactionTimeline.rows, ...taskTimeline.rows].sort((a, b) =>
      String(b.happened_at).localeCompare(String(a.happened_at))
    );
  }

  async hydrateEntity(table: "people" | "companies" | "opportunities", id: string): Promise<Record<string, unknown> | null> {
    const row = await this.findById(table, id);
    if (!row) {
      return null;
    }

    const entityType =
      table === "people" ? "person" : table === "companies" ? "company" : "opportunity";

    return {
      ...row,
      source_urls: parseJson(row.source_urls_json, []),
      custom_properties: {
        ...parseJson(row.custom_properties_json, {}),
        ...(await this.listPropertyValues(entityType, id))
      },
      contact_points:
        table === "opportunities"
          ? []
          : await this.listContactPoints(entityType, id)
    };
  }
}

export function createDefaultProjectConfig(cwd: string): string {
  const absoluteSqlitePath = resolve(cwd, DEFAULT_SQLITE_PATH);
  mkdirSync(join(cwd, DEFAULT_SQLITE_DIR), { recursive: true });
  return writeProjectConfig(cwd, {
    sqlitePath: DEFAULT_SQLITE_PATH,
    databaseUrl: `sqlite://${absoluteSqlitePath}`
  });
}

