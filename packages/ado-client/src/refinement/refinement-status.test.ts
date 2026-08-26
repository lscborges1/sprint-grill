import { describe, expect, it } from "vitest";
import { codeChip, codeTag, dumpCompletionMarker } from "../index";
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
        `${codeChip(INVESTIGATION_MARKER)}\n## Impacto\n\`core-api/src/report.ts\` monta o payload.`,
      ],
    });

    expect(status).toBe("investigada");
  });

  it("should report a US as investigada from an orphaned Investigation that lost its marker", () => {
    // Investigações publicadas antes do chip existir perderam o comentário
    // HTML na sanitização do ADO — o título do relatório é o que sobrou delas.
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: ["\n\n# Investigação — US #4211: TTL configurável\n\nO TTL é fixo."],
    });

    expect(status).toBe("investigada");
  });

  it("should report a US as refinada only when ADO has the final dump marker", () => {
    const status = inferRefinementStatus({
      description: "Como PO, quero exportar o relatório em CSV.",
      comments: [
        `${codeChip(INVESTIGATION_MARKER)}\n## Impacto`,
        `${codeTag(SPEC_MARKER)}\n## Decisões\n- CSV com separador ";" (PO, 06/08)\n${codeTag(dumpCompletionMarker("abc123"))}`,
      ],
    });

    expect(status).toBe("refinada");
  });

  it("should report a US as refinada when the final marker lives in its description", () => {
    const status = inferRefinementStatus({
      description: `Como PO, quero exportar o relatório em CSV.\n\n${codeTag(SPEC_MARKER)}\n## Decisões\n${codeChip(dumpCompletionMarker("abc123"))}`,
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
