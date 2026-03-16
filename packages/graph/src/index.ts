import type { CardViewPayload, GraphViewPayload, PathResult } from "@persona360/contracts";

type GraphEdgeRecord = {
  id: string;
  from_type: string;
  from_id: string;
  edge_type: string;
  to_type: string;
  to_id: string;
  label?: string | null;
  confidence?: number | null;
  strength?: number | null;
  last_seen_at?: string | null;
  last_confirmed_at?: string | null;
  is_current?: number | boolean | null;
};

type EntitySummary = {
  id: string;
  entity_type: string;
  label: string;
  subtitle?: string;
  meta?: Record<string, unknown>;
};

type EvidenceSummary = {
  id: string;
  title: string;
  snippet?: string;
  happened_at?: string;
  source_url?: string;
};

function normalizeBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return fallback;
}

function timestampAgeDays(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - ms) / 86_400_000));
}

export function isEdgeStale(edge: GraphEdgeRecord): boolean {
  const age = timestampAgeDays(edge.last_seen_at ?? edge.last_confirmed_at);
  return age !== null && age > 90;
}

export function edgeWeight(edge: GraphEdgeRecord): number {
  const confidence = edge.confidence ?? 0.5;
  const strength = edge.strength ?? 0.5;
  const recencyAge = timestampAgeDays(edge.last_seen_at ?? edge.last_confirmed_at) ?? 0;
  const recencyFactor = Math.max(0.1, 1 - recencyAge / 365);
  const currentFactor = normalizeBoolean(edge.is_current, true) ? 1 : 0.5;
  return confidence * 0.4 + strength * 0.4 + recencyFactor * 0.2 * currentFactor;
}

type AdjacencyHop = {
  edge: GraphEdgeRecord;
  nextId: string;
};

function buildAdjacency(edges: GraphEdgeRecord[]): Map<string, AdjacencyHop[]> {
  const adjacency = new Map<string, AdjacencyHop[]>();

  for (const edge of edges) {
    const forward = adjacency.get(edge.from_id) ?? [];
    forward.push({
      edge,
      nextId: edge.to_id
    });
    adjacency.set(edge.from_id, forward);

    const reverse = adjacency.get(edge.to_id) ?? [];
    reverse.push({
      edge,
      nextId: edge.from_id
    });
    adjacency.set(edge.to_id, reverse);
  }

  return adjacency;
}

export function rankPaths(
  edges: GraphEdgeRecord[],
  fromId: string,
  toId: string,
  maxDepth = 4
): PathResult[] {
  const adjacency = buildAdjacency(edges);
  const queue: Array<{ nodeId: string; depth: number; path: GraphEdgeRecord[]; visited: Set<string> }> = [
    {
      nodeId: fromId,
      depth: 0,
      path: [],
      visited: new Set([fromId])
    }
  ];

  const results: PathResult[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    for (const hop of adjacency.get(current.nodeId) ?? []) {
      if (current.visited.has(hop.nextId)) {
        continue;
      }

      const nextPath = [...current.path, hop.edge];
      if (hop.nextId === toId) {
        const score =
          nextPath.reduce((sum, edge) => sum + edgeWeight(edge), 0) / nextPath.length -
          (nextPath.length - 1) * 0.05;
        results.push({
          score,
          hops: nextPath.map((edge) => ({
            edge_id: edge.id,
            from_id: edge.from_id,
            to_id: edge.to_id,
            edge_type: edge.edge_type,
            strength: edge.strength ?? 0.5,
            confidence: edge.confidence ?? 0.5
          })),
          evidence_ids: []
        });
        continue;
      }

      queue.push({
        nodeId: hop.nextId,
        depth: current.depth + 1,
        path: nextPath,
        visited: new Set([...current.visited, hop.nextId])
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function buildGraphViewPayload(input: {
  title: string;
  focusId: string;
  entities: EntitySummary[];
  edges: GraphEdgeRecord[];
  evidence: EvidenceSummary[];
}): GraphViewPayload {
  return {
    title: input.title,
    focus_id: input.focusId,
    nodes: input.entities.map((entity) => ({
      id: entity.id,
      type: entity.entity_type as GraphViewPayload["nodes"][number]["type"],
      label: entity.label,
      subtitle: entity.subtitle,
      stale: false,
      meta: entity.meta ?? {}
    })),
    edges: input.edges.map((edge) => ({
      id: edge.id,
      from: edge.from_id,
      to: edge.to_id,
      type: edge.edge_type,
      label: edge.label ?? edge.edge_type,
      confidence: edge.confidence ?? 0.5,
      strength: edge.strength ?? 0.5,
      stale: isEdgeStale(edge),
      evidence_ids: []
    })),
    evidence: input.evidence,
    meta: {}
  };
}

export function buildCardViewPayload(input: {
  title: string;
  entity: Record<string, unknown>;
  edges: GraphEdgeRecord[];
  labelLookup: Record<string, string>;
  timeline: Array<{ id: string; summary: string; happened_at: string; type?: string }>;
}): CardViewPayload {
  return {
    title: input.title,
    entity: input.entity,
    relationships: input.edges.map((edge) => ({
      edge_type: edge.edge_type,
      target_label: input.labelLookup[edge.from_id === input.entity.id ? edge.to_id : edge.from_id] ?? "Unknown",
      strength: edge.strength ?? 0.5,
      confidence: edge.confidence ?? 0.5
    })),
    timeline: input.timeline.map((entry) => ({
      id: entry.id,
      label: entry.type ? `${entry.type}: ${entry.summary}` : entry.summary,
      happened_at: entry.happened_at,
      summary: entry.summary
    })),
    meta: {}
  };
}

