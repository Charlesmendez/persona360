import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { type Core, type Position } from "cytoscape";
import type { CardViewPayload, GraphViewPayload } from "@persona360/contracts";

export type BootPayload =
  | { mode: "graph"; payload: GraphViewPayload }
  | { mode: "card"; payload: CardViewPayload };

function formatEdgeLabel(raw: string): string {
  return raw.replace(/_/g, " ").toLowerCase();
}

function typeIcon(type: string): string {
  switch (type) {
    case "person": return "P";
    case "company": return "C";
    case "opportunity": return "O";
    case "interaction": return "I";
    case "task": return "T";
    default: return "·";
  }
}

function EntityCard({ payload }: { payload: CardViewPayload }) {
  return (
    <div className="shell card-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">persona360</p>
          <h1>{payload.title}</h1>
        </div>
      </header>
      <main className="card-grid">
        <section className="panel">
          <h2>Identity</h2>
          <pre>{JSON.stringify(payload.entity, null, 2)}</pre>
        </section>
        <section className="panel">
          <h2>Relationships</h2>
          <ul className="rel-list">
            {payload.relationships.map((r) => (
              <li key={`${r.edge_type}:${r.target_label}`}>
                <span className="rel-type">{formatEdgeLabel(r.edge_type)}</span>
                <span className="rel-target">{r.target_label}</span>
                <span className="rel-score">{r.strength.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel panel-wide">
          <h2>Timeline</h2>
          <ul className="tl-list">
            {payload.timeline.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.summary}</p>
                </div>
                <time>{new Date(item.happened_at).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

type NodeOverlay = {
  id: string;
  label: string;
  subtitle?: string;
  type: string;
  x: number;
  y: number;
  selected: boolean;
  focus: boolean;
};

function GraphExplorer({ payload }: { payload: GraphViewPayload }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<NodeOverlay[]>([]);

  const filteredPayload = useMemo(() => {
    if (!search.trim()) return payload;
    const l = search.toLowerCase();
    const matchNodes = payload.nodes.filter((n) =>
      `${n.label} ${n.subtitle ?? ""}`.toLowerCase().includes(l)
    );
    const ids = new Set(matchNodes.map((n) => n.id));
    return {
      ...payload,
      nodes: payload.nodes.filter((n) => ids.has(n.id)),
      edges: payload.edges.filter((e) => ids.has(e.from) || ids.has(e.to))
    };
  }, [payload, search]);

  const syncOverlays = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const pan = cy.pan();
    const zoom = cy.zoom();
    const newOverlays: NodeOverlay[] = [];
    cy.nodes().forEach((node) => {
      const pos: Position = node.position();
      newOverlays.push({
        id: node.id(),
        label: node.data("label"),
        subtitle: node.data("subtitle"),
        type: node.data("type"),
        x: pos.x * zoom + pan.x,
        y: pos.y * zoom + pan.y,
        selected: node.id() === selectedNodeId,
        focus: node.id() === payload.focus_id
      });
    });
    setOverlays(newOverlays);
  }, [selectedNodeId, payload.focus_id]);

  useEffect(() => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy_ = rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * 0.35;
    const nodeCount = filteredPayload.nodes.length;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...filteredPayload.nodes.map((n, i) => {
          const angle = (2 * Math.PI * i) / Math.max(nodeCount, 1);
          return {
            data: { id: n.id, label: n.label, subtitle: n.subtitle, type: n.type },
            position: { x: cx + radius * Math.cos(angle), y: cy_ + radius * Math.sin(angle) }
          };
        }),
        ...filteredPayload.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.from,
            target: e.to,
            strength: e.strength,
            confidence: e.confidence
          }
        }))
      ],
      style: [
        {
          selector: "node",
          style: {
            width: 1,
            height: 1,
            "background-color": "transparent",
            "border-width": 0,
            label: ""
          }
        },
        {
          selector: "edge",
          style: {
            width: (ele: any) => 0.6 + Number(ele.data("strength") ?? 0.5) * 1,
            "curve-style": "straight",
            "line-color": "rgba(255,255,255,0.06)",
            "target-arrow-color": "rgba(255,255,255,0.09)",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.45,
            opacity: (ele: any) => 0.25 + Number(ele.data("confidence") ?? 0.5) * 0.45
          }
        }
      ],
      layout: { name: "preset" },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.2,
      maxZoom: 4
    });

    cy.on("tap", (event) => {
      if (event.target === cy) {
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
      }
    });

    cy.on("tap", "edge", (event) => {
      setSelectedEdgeId(String(event.target.id()));
      setSelectedNodeId(null);
    });

    cy.on("render viewport", () => syncOverlays());

    cyRef.current = cy;

    cy.fit(undefined, 40);
    syncOverlays();

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [filteredPayload, syncOverlays]);

  useEffect(() => {
    syncOverlays();
  }, [selectedNodeId, syncOverlays]);

  const handleNodeClick = (id: string) => {
    setSelectedNodeId((prev) => (prev === id ? null : id));
    setSelectedEdgeId(null);
  };

  const selectedNode = payload.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = payload.edges.find((e) => e.id === selectedEdgeId) ?? null;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">persona360</p>
          <h1>{payload.title}</h1>
        </div>
        <div className="toolbar">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
          />
          <button type="button" onClick={() => { cyRef.current?.fit(undefined, 100); syncOverlays(); }}>
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              const c = cyRef.current;
              if (!c) return;
              const container = c.container();
              if (!container) return;
              const r = container.getBoundingClientRect();
              const cxR = r.width / 2;
              const cyR = r.height / 2;
              const rad = Math.min(r.width, r.height) * 0.35;
              const nodes = c.nodes();
              const total = nodes.length;
              nodes.forEach((node, i) => {
                const angle = (2 * Math.PI * i) / Math.max(total, 1);
                node.position({ x: cxR + rad * Math.cos(angle), y: cyR + rad * Math.sin(angle) });
              });
              c.fit(undefined, 40);
              syncOverlays();
            }}
          >
            Relayout
          </button>
        </div>
      </header>

      <main className="graph-layout">
        <aside className="panel sidebar">
          <h2>Legend</h2>
          <ul className="legend-list">
            <li><span className="lg-icon lg-person">P</span> Person</li>
            <li><span className="lg-icon lg-company">C</span> Company</li>
            <li><span className="lg-icon lg-opportunity">O</span> Opportunity</li>
            <li><span className="lg-icon lg-interaction">I</span> Interaction</li>
            <li><span className="lg-icon lg-task">T</span> Task</li>
          </ul>
          <div className="stats">
            <div><strong>{payload.nodes.length}</strong><span>Nodes</span></div>
            <div><strong>{payload.edges.length}</strong><span>Edges</span></div>
            <div><strong>{payload.evidence.length}</strong><span>Evidence</span></div>
          </div>
        </aside>

        <section className="graph-panel" ref={wrapRef}>
          <div ref={containerRef} className="graph-canvas" />
          <div className="node-overlays">
            {overlays.map((o) => (
              <button
                key={o.id}
                className={`node-pill ${o.type}${o.selected ? " selected" : ""}${o.focus ? " focus" : ""}`}
                style={{ transform: `translate(${o.x}px, ${o.y}px)` }}
                onClick={() => handleNodeClick(o.id)}
                type="button"
              >
                <span className="node-icon">{typeIcon(o.type)}</span>
                <span className="node-label">{o.label}</span>
                {o.subtitle && <span className="node-sub">{o.subtitle}</span>}
              </button>
            ))}
          </div>
        </section>

        <aside className="panel detail-panel">
          {selectedNode ? (
            <>
              <div className="detail-header">
                <span className={`detail-icon ${selectedNode.type}`}>{typeIcon(selectedNode.type)}</span>
                <div>
                  <h2>{selectedNode.label}</h2>
                  <p className="muted">{selectedNode.subtitle ?? selectedNode.type}</p>
                </div>
              </div>
              {Object.keys(selectedNode.meta ?? {}).length > 0 && (
                <pre>{JSON.stringify(selectedNode.meta, null, 2)}</pre>
              )}
            </>
          ) : selectedEdge ? (
            <>
              <h2>{formatEdgeLabel(selectedEdge.label ?? selectedEdge.type)}</h2>
              <p className="muted">
                strength {selectedEdge.strength.toFixed(2)} &middot; confidence{" "}
                {selectedEdge.confidence.toFixed(2)}
              </p>
            </>
          ) : (
            <>
              <h2>Evidence</h2>
              {payload.evidence.length === 0 && <p className="muted">No evidence yet.</p>}
              <ul className="tl-list">
                {payload.evidence.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.snippet ?? ""}</p>
                    </div>
                    <time>
                      {item.happened_at ? new Date(item.happened_at).toLocaleDateString() : "—"}
                    </time>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}

export function App({ boot }: { boot: BootPayload }) {
  return boot.mode === "graph" ? (
    <GraphExplorer payload={boot.payload} />
  ) : (
    <EntityCard payload={boot.payload} />
  );
}
