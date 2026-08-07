import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { verifyGrounding } from "./grounding";
import type { InvestigationReport } from "./report";

const root = mkdtempSync(path.join(tmpdir(), "sprint-griller-grounding-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const CORE_API = path.join(root, "core-api");
mkdirSync(path.join(CORE_API, "src", "cache"), { recursive: true });
writeFileSync(
  path.join(CORE_API, "src", "cache", "session.ts"),
  "export const SESSION_TTL = 3600;\n",
);

const REPOS = [
  { name: "core-api", path: CORE_API },
  { name: "web-app", path: root },
] as const;

const CLAIM = "O TTL do cache precisa virar configurável.";

function verify(citations: InvestigationReport["impacts"][number]["citations"]) {
  return verifyGrounding([{ claim: CLAIM, citations }], REPOS);
}

describe("verifyGrounding", () => {
  it("should approve a citation whose file exists in a configured repo", () => {
    expect(verify([{ repo: "core-api", path: "src/cache/session.ts" }])).toEqual({
      status: "aprovado",
    });
  });

  it("should approve a citation whose symbol is present in the cited file", () => {
    expect(
      verify([
        { repo: "core-api", path: "src/cache/session.ts", symbol: "SESSION_TTL" },
      ]),
    ).toEqual({ status: "aprovado" });
  });

  it("should approve a report with no impact claims at all", () => {
    expect(verifyGrounding([], REPOS)).toEqual({ status: "aprovado" });
  });

  it("should reject a citation whose path does not exist", () => {
    const result = verify([{ repo: "core-api", path: "src/cache/ttl.ts" }]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ claim: CLAIM, reason: "caminho-inexistente" }],
    });
  });

  it("should reject a citation that points at a directory instead of a file", () => {
    const result = verify([{ repo: "core-api", path: "src/cache" }]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "caminho-inexistente" }],
    });
  });

  it("should reject a citation whose symbol is absent from the cited file", () => {
    const result = verify([
      { repo: "core-api", path: "src/cache/session.ts", symbol: "SESSION_TTL_MS" },
    ]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "simbolo-nao-encontrado" }],
    });
  });

  it("should not blame the agent when the cited file cannot be read", () => {
    const locked = path.join(CORE_API, "src", "cache", "locked.ts");
    writeFileSync(locked, "export const SESSION_TTL = 1;\n");
    chmodSync(locked, 0o000);

    const result = verify([
      { repo: "core-api", path: "src/cache/locked.ts", symbol: "SESSION_TTL" },
    ]);

    chmodSync(locked, 0o600);
    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "arquivo-ilegivel" }],
    });
  });

  it("should reject a citation to a repo that is not in the squad config", () => {
    const result = verify([{ repo: "billing", path: "src/index.ts" }]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "repo-fora-do-config" }],
    });
  });

  it("should reject a citation that escapes the repo root", () => {
    const result = verify([{ repo: "core-api", path: "../web-app/src/index.ts" }]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "caminho-fora-do-repo" }],
    });
  });

  it("should reject an absolute citation path", () => {
    const result = verify([{ repo: "core-api", path: "/etc/hosts" }]);

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ reason: "caminho-fora-do-repo" }],
    });
  });

  it("should report every violation, not just the first", () => {
    const result = verifyGrounding(
      [
        { claim: "a", citations: [{ repo: "core-api", path: "nao-existe.ts" }] },
        { claim: "b", citations: [{ repo: "billing", path: "src/index.ts" }] },
      ],
      REPOS,
    );

    expect(result).toMatchObject({
      status: "reprovado",
      violations: [{ claim: "a" }, { claim: "b" }],
    });
  });

  it("should explain the violation in a message the operator can act on", () => {
    const result = verify([{ repo: "core-api", path: "src/cache/ttl.ts" }]);

    expect(result.status === "reprovado" && result.violations[0]?.detail).toContain(
      "src/cache/ttl.ts",
    );
  });
});
