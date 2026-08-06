import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_MARKER,
  SPEC_MARKER,
  inferRefinementStatus,
} from "./refinement-status";

describe("inferRefinementStatus", () => {
  it("should report a US with none of the tool's artifacts as sem-investigacao", () => {
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: ["combinei com o time que isso entra na próxima sprint"],
    });

    expect(status).toBe("sem-investigacao");
  });

  it("should report a US as investigada when the Investigação comment is published", () => {
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: [
        `${INVESTIGATION_MARKER}\n## Impacto\n\`core-api/src/report.ts\` monta o payload.`,
      ],
    });

    expect(status).toBe("investigada");
  });

  it("should report a US as refinada when the despejo already wrote the Spec da US", () => {
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: [
        `${INVESTIGATION_MARKER}\n## Impacto`,
        `${SPEC_MARKER}\n## Decisões\n- CSV com separador ";" (PO, 06/08)`,
      ],
    });

    expect(status).toBe("refinada");
  });

  it("should report a US as refinada when the Spec lives in the description instead of a comment", () => {
    const status = inferRefinementStatus({
      description: `Como PO, quero exportar o relatório em CSV.\n\n${SPEC_MARKER}\n## Decisões`,
      comments: [],
    });

    expect(status).toBe("refinada");
  });

  it("should ignore prose that only talks about the Investigação, so a human comment never fakes the status", () => {
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: [
        "sprint-griller: fiz a investigação na mão e a spec já está combinada",
      ],
    });

    expect(status).toBe("sem-investigacao");
  });
});
