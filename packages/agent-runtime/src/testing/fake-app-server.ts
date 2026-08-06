import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createLogger } from "@sprint-griller/core";
import type { Logger } from "@sprint-griller/core";

/** Roteiro do app-server falso. Ver `app-server-process.mjs` para o formato. */
export interface FakeScript {
  /** Uma reação por método — ou uma lista, respondendo na ordem das chamadas (a última repete). */
  readonly reactions: Readonly<Record<string, FakeReaction | readonly FakeReaction[]>>;
}

export interface FakeReaction {
  readonly result?: unknown;
  readonly error?: { readonly message: string };
  readonly emit?: readonly FakeEmission[];
}

export type FakeEmission =
  | { readonly notify: { readonly method: string; readonly params?: unknown } }
  | { readonly request: { readonly method: string; readonly params?: unknown } }
  | { readonly raw: string }
  | { readonly exit: number };

const FAKE_APP_SERVER = fileURLToPath(new URL("./app-server-process.mjs", import.meta.url));

export function fakeAppServerCommand(
  script: FakeScript,
  transcriptPath?: string,
): readonly [string, ...string[]] {
  const serialized = JSON.stringify(script);
  return transcriptPath
    ? ([process.execPath, FAKE_APP_SERVER, serialized, transcriptPath] as const)
    : ([process.execPath, FAKE_APP_SERVER, serialized] as const);
}

/** Caminho novo a cada chamada; o app-server falso cria o arquivo ao escrever. */
export function transcriptPath(): string {
  return join(mkdtempSync(join(tmpdir(), "sprint-griller-")), "transcript.jsonl");
}

/** Tudo que o cliente enviou, na ordem. Vazio enquanto nada chegou. */
export function readTranscript(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Logger real escrevendo em memória — os testes afirmam sobre as linhas. */
export function createTestLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      done();
    },
  });
  return { logger: createLogger({ name: "agent-runtime", level: "debug", destination }), lines };
}
