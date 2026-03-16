import { describe, expect, it } from "vitest";
import { rankPaths } from "./index";

describe("rankPaths", () => {
  it("ranks stronger paths ahead of weaker alternatives", () => {
    const paths = rankPaths(
      [
        {
          id: "edge-1",
          from_type: "person",
          from_id: "a",
          edge_type: "INTRODUCED",
          to_type: "person",
          to_id: "b",
          strength: 0.9,
          confidence: 0.95,
          last_seen_at: new Date().toISOString(),
          last_confirmed_at: new Date().toISOString(),
          is_current: 1
        },
        {
          id: "edge-2",
          from_type: "person",
          from_id: "b",
          edge_type: "INTRODUCED",
          to_type: "person",
          to_id: "c",
          strength: 0.8,
          confidence: 0.85,
          last_seen_at: new Date().toISOString(),
          last_confirmed_at: new Date().toISOString(),
          is_current: 1
        },
        {
          id: "edge-3",
          from_type: "person",
          from_id: "a",
          edge_type: "INTRODUCED",
          to_type: "person",
          to_id: "c",
          strength: 0.6,
          confidence: 0.7,
          last_seen_at: new Date().toISOString(),
          last_confirmed_at: new Date().toISOString(),
          is_current: 1
        }
      ],
      "a",
      "c"
    );

    expect(paths).toHaveLength(2);
    expect(paths[0]?.score).toBeGreaterThan(paths[1]?.score ?? 0);
    expect(paths[0]?.hops.map((hop) => hop.edge_id)).toEqual(["edge-1", "edge-2"]);
    expect(paths[1]?.hops.map((hop) => hop.edge_id)).toEqual(["edge-3"]);
  });
});
