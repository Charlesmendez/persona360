import { describe, expect, it } from "vitest";
import { extractProposalFromText, planQueryFromText } from "./index";

describe("extractProposalFromText", () => {
  it("extracts a basic person and company from plain text", async () => {
    const proposal = await extractProposalFromText(
      "Met Jane Doe from ExampleCo. She runs partnerships and wants a pilot next quarter. jane@example.com"
    );

    expect(proposal.people[0]?.first_name).toBe("Jane");
    expect(proposal.people[0]?.last_name).toBe("Doe");
    expect(proposal.companies[0]?.name).toBe("Exampleco");
    expect(proposal.opportunities[0]?.title).toContain("Pilot");
  });
});

describe("planQueryFromText", () => {
  it("falls back to search for general questions", () => {
    const plan = planQueryFromText("find Acme");
    expect(plan.action).toBe("search");
  });
});
