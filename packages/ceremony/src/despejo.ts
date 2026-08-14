import { createHash } from "node:crypto";
import {
  publishChildTasks,
  publishDecisionRecord,
  publishDumpCompletion,
  publishStorySpec,
  readDumpCompletion,
  readIncompleteDumps,
} from "@sprint-griller/ado-client";
import type { AdoClientOptions } from "@sprint-griller/ado-client";
import type { Logger } from "@sprint-griller/core";
import { CeremonyError } from "./ceremony-error";
import { reservePublication } from "./despejo-publication";
import { readDossie } from "./dossie";
import { appendDecisionTraceability } from "./spec";
import type { CeremonyStore } from "./store";

export interface CreateCeremonyDumpOptions {
  readonly store: CeremonyStore;
  readonly adoOptions: () => AdoClientOptions;
  readonly logger: Logger;
  readonly onChange?: (sessionId: string) => void;
}

export interface AssertCanStartCeremonyInput {
  readonly storyId: number;
  readonly investigationApproved: boolean;
}

export interface CeremonyDumpInput {
  readonly sessionId: string;
  readonly markdown: string;
  readonly base: string;
  readonly tasksMarkdown: string;
  readonly estimate: number;
  readonly confirmPending: boolean;
}

export interface CeremonyDump {
  assertCanStartCeremony(input: AssertCanStartCeremonyInput): Promise<void>;
  publish(input: CeremonyDumpInput): Promise<void>;
}

export function createCeremonyDump(options: CreateCeremonyDumpOptions): CeremonyDump {
  const { store } = options;
  const inFlightByStory = new Map<number, {
    readonly sessionId: string;
    readonly signature: string;
    readonly promise: Promise<void>;
  }>();

  function changed(sessionId: string): void {
    try {
      options.onChange?.(sessionId);
    } catch (error) {
      options.logger.warn(
        { err: error, sessionId },
        "falha ao notificar mudança no despejo",
      );
    }
  }

  return {
    async assertCanStartCeremony({ storyId, investigationApproved }) {
      const incompleteLocal = store.findIncompleteDumpByStory(storyId);
      if (incompleteLocal) {
        throw new CeremonyError(
          `A US #${storyId} tem um despejo incompleto na cerimônia anterior. ` +
            `Abra o Dossiê dessa cerimônia e conclua o retry antes de grelhar de novo.`,
        );
      }
      if (!investigationApproved) {
        throw new CeremonyError(
          `A US #${storyId} ainda não tem Investigação aprovada — investigue antes de grelhar.`,
        );
      }
      const ado = options.adoOptions();
      const incompleteRemote = await readIncompleteDumps(ado, storyId);
      if (incompleteRemote.length > 0) {
        throw new CeremonyError(
          `A US #${storyId} tem um despejo incompleto no Azure DevOps. ` +
            `Conclua o retry desse despejo antes de abrir outra cerimônia.`,
        );
      }
    },

    publish(input) {
      const initial = readDossie(store, input.sessionId);
      if (!initial) {
        return Promise.reject(new CeremonyError(`cerimônia ${input.sessionId} não existe.`));
      }

      const open = store.findOpenSessionByStory(initial.story.id);
      if (open && open.id !== input.sessionId) {
        return Promise.reject(new CeremonyError(
          `a US #${initial.story.id} já tem outra cerimônia aberta. Encerre-a antes de despejar esta.`,
        ));
      }

      const signature = signedInputSignature(input);
      const inFlight = inFlightByStory.get(initial.story.id);
      if (inFlight) {
        if (inFlight.sessionId !== input.sessionId) {
          return Promise.reject(new CeremonyError(
            `a US #${initial.story.id} já tem um despejo em andamento em outra cerimônia.`,
          ));
        }
        if (inFlight.signature !== signature) {
          return Promise.reject(new CeremonyError(
            "esta cerimônia já está despejando outros valores assinados — aguarde antes de tentar novamente.",
          ));
        }
        return inFlight.promise;
      }

      const tracked = (async (): Promise<void> => {
        const preparation = reservePublication(store, initial, input);
        if (preparation.kind === "completed") return;

        const { decisions, inputs, pendingCount, sessionId, storyId, tasks } =
          preparation.publication;
        changed(sessionId);

        try {
          const ado = options.adoOptions();
          const completions = await readDumpCompletion(ado, storyId);
          const incomplete = await readIncompleteDumps(ado, storyId);
          if (incomplete.some((id) => id !== inputs.dumpId)) {
            throw new CeremonyError(
              "a US tem um despejo incompleto de outra cerimônia. Conclua o retry desse despejo antes de publicar outro.",
            );
          }

          if (completions.includes(inputs.dumpId)) {
            store.markDumpCompleted(sessionId, decisions.length);
            changed(sessionId);
            return;
          }

          for (const decision of decisions) {
            if (decision.recordId !== undefined && decision.recordUrl !== undefined) continue;
            if (decision.recordId !== undefined || decision.recordUrl !== undefined) {
              throw new CeremonyError(
                `a decisão ${decision.questionSeq} tem um Registro incompleto no banco local.`,
              );
            }
            const published = await publishDecisionRecord(ado, {
              storyId,
              dumpId: inputs.dumpId,
              questionSeq: decision.questionSeq,
              question: decision.question,
              answer: decision.answer,
              recommendation: decision.recommendation,
              decidedAt: decision.decidedAt,
            });
            store.attachDecisionRecord({
              sessionId,
              questionSeq: decision.questionSeq,
              recordId: published.commentId,
              recordUrl: published.url,
            });
            changed(sessionId);
          }

          const withRecords = readDossie(store, sessionId);
          if (!withRecords) {
            throw new CeremonyError(`cerimônia ${sessionId} não existe.`);
          }
          await publishStorySpec(ado, {
            storyId,
            dumpId: inputs.dumpId,
            markdown: appendDecisionTraceability(inputs.markdown, withRecords.decisions),
            estimate: inputs.estimate,
          });
          await publishChildTasks(ado, {
            storyId,
            dumpId: inputs.dumpId,
            tasks,
          });
          await publishDumpCompletion(ado, {
            storyId,
            dumpId: inputs.dumpId,
            openQuestions: pendingCount,
          });

          store.markDumpCompleted(sessionId, decisions.length);
          changed(sessionId);
          options.logger.info(
            {
              sessionId,
              storyId,
              decisions: withRecords.decisions.length,
              tasks: tasks.length,
              estimate: inputs.estimate,
            },
            "despejo da cerimônia concluído",
          );
        } catch (error) {
          store.abortDump(sessionId);
          changed(sessionId);
          throw error;
        }
      })().finally(() => {
        if (inFlightByStory.get(initial.story.id)?.promise === tracked) {
          inFlightByStory.delete(initial.story.id);
        }
      });
      inFlightByStory.set(initial.story.id, { sessionId: input.sessionId, signature, promise: tracked });
      return tracked;
    },
  };
}

function signedInputSignature(input: CeremonyDumpInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sessionId: input.sessionId,
      markdown: input.markdown,
      base: input.base,
      tasksMarkdown: input.tasksMarkdown,
      estimate: input.estimate,
      confirmPending: input.confirmPending,
    }))
    .digest("hex");
}
