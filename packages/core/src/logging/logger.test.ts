import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Captura as linhas JSON emitidas pelo logger, uma por chamada. */
function captureLines() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return { lines, destination };
}

describe("createLogger", () => {
  it("should emit one structured line per call with level, message and fields", () => {
    const { lines, destination } = captureLines();
    const logger = createLogger({ destination });

    logger.info({ workItemId: 4321 }, "investigação disparada");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      msg: "investigação disparada",
      workItemId: 4321,
    });
  });

  it("should tag every line with the boundary name so logs are attributable", () => {
    const { lines, destination } = captureLines();
    const logger = createLogger({ name: "ado-client", destination });

    logger.info("work item atualizado");

    expect(lines[0]).toMatchObject({ name: "ado-client" });
  });

  it("should carry parent bindings into child logger lines", () => {
    const { lines, destination } = captureLines();
    const child = createLogger({ name: "agent-runtime", destination }).child({
      sessionId: "s-1",
    });

    child.warn("turno reiniciado");

    expect(lines[0]).toMatchObject({
      name: "agent-runtime",
      sessionId: "s-1",
      level: "warn",
    });
  });

  it("should redact secrets instead of writing them out", () => {
    const { lines, destination } = captureLines();
    const logger = createLogger({ destination });

    logger.info(
      { pat: "super-secreto", request: { authorization: "Bearer xyz" } },
      "escrita no ADO",
    );

    expect(JSON.stringify(lines[0])).not.toContain("super-secreto");
    expect(JSON.stringify(lines[0])).not.toContain("Bearer xyz");
  });

  it("should drop lines below the configured level", () => {
    const { lines, destination } = captureLines();
    const logger = createLogger({ level: "warn", destination });

    logger.debug("ruído");
    logger.error("falha na escrita");

    expect(lines.map((line) => line.msg)).toEqual(["falha na escrita"]);
  });

  it("should take the level from LOG_LEVEL when none is passed", () => {
    const { lines, destination } = captureLines();
    vi.stubEnv("LOG_LEVEL", "error");
    const logger = createLogger({ destination });

    logger.warn("aviso");
    logger.error("falha");

    expect(lines.map((line) => line.msg)).toEqual(["falha"]);
  });

  it("should refuse to start with an unknown LOG_LEVEL instead of degrading", () => {
    vi.stubEnv("LOG_LEVEL", "verboso");

    expect(() => createLogger()).toThrowError(/LOG_LEVEL/);
  });
});
