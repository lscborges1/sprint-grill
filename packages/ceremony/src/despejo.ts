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
import { readDossie } from "./dossie";
import { isCeremonyEstimate } from "./estimate";
import {
  appendDecisionTraceability,
  assertValidSpecMarkdown,
  stripDecisionRecordLinks,
} from "./spec";
import type { CeremonyStore } from "./store";
import { parseTaskDraft } from "./task-draft";
import { signedDumpInputs } from "./dump-state";

export interface CreateCeremonyDumpOptions {
  readonly store: CeremonyStore;
  readonly adoOptions: () => AdoClientOptions | Promise<AdoClientOptions>;
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
      const ado = await options.adoOptions();
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
        const frozenInputs = signedDumpInputs(initial.dump);
        if (frozenInputs !== undefined && input.markdown !== frozenInputs.markdown) {
          throw new CeremonyError(
            "o despejo já começou com outra Spec — use a Spec assinada no retry.",
          );
        }
        if (frozenInputs !== undefined && input.estimate !== frozenInputs.estimate) {
          throw new CeremonyError(
            "o despejo já começou com outra estimativa — use a estimativa assinada no retry.",
          );
        }
        if (frozenInputs !== undefined && input.tasksMarkdown !== frozenInputs.tasksMarkdown) {
          throw new CeremonyError(
            "o despejo já começou com outras Tasks assinadas — use as mesmas Tasks no retry.",
          );
        }
        if (initial.dump.status === "completed") return;
        if (store.getSession(input.sessionId)?.status !== "encerrada") {
          throw new CeremonyError("encerre a cerimônia antes de despejar.");
        }
  
        const frozen = frozenInputs?.markdown;
        const signed = frozen ?? initial.spec.draft?.markdown ?? initial.spec.generated;
        if (input.markdown !== signed) {
          throw new CeremonyError(
            frozen === undefined
              ? "salve a edição do Dossiê antes de despejar."
              : "o despejo já começou com outra Spec — use a Spec assinada no retry.",
          );
        }
        if (
          frozen === undefined &&
          stripDecisionRecordLinks(input.base) !== stripDecisionRecordLinks(initial.spec.generated)
        ) {
          throw new CeremonyError(
            "a cerimônia andou depois desta edição — regenere ou salve uma Spec atualizada antes de despejar.",
          );
        }
        if (initial.pending.length > 0 && !input.confirmPending) {
          throw new CeremonyError("confirme que deseja despejar com as pendências abertas.");
        }
        if (frozenInputs === undefined && !isCeremonyEstimate(input.estimate)) {
          throw new CeremonyError("a estimativa deve usar a escala Fibonacci da squad.");
        }
  
        const tasksMarkdown = frozenInputs?.tasksMarkdown ?? input.tasksMarkdown;
        const tasks = parseTaskDraft(tasksMarkdown, initial.story.url);
        const dumpId = frozenInputs?.dumpId ?? fingerprint(
          initial.sessionId,
          initial.story.id,
          signed,
          tasks,
          input.estimate,
        );
  
        assertValidSpecMarkdown(signed, initial.decisions);
        store.beginDump(input.sessionId, {
          dumpId,
          markdown: signed,
          tasksMarkdown,
          estimate: input.estimate,
        });
        changed(input.sessionId);
  
        try {
          const ado = await options.adoOptions();
          const completions = await readDumpCompletion(ado, initial.story.id);
          const incomplete = await readIncompleteDumps(ado, initial.story.id);
          if (incomplete.some((id) => id !== dumpId)) {
            throw new CeremonyError(
              "a US tem um despejo incompleto de outra cerimônia. Conclua o retry desse despejo antes de publicar outro.",
            );
          }
  
          if (completions.includes(dumpId)) {
            store.markDumpCompleted(input.sessionId, initial.decisions.length);
            changed(input.sessionId);
            return;
          }
  
          for (const decision of initial.decisions) {
            if (decision.recordId !== undefined && decision.recordUrl !== undefined) continue;
            if (decision.recordId !== undefined || decision.recordUrl !== undefined) {
              throw new CeremonyError(
                `a decisão ${decision.questionSeq} tem um Registro incompleto no banco local.`,
              );
            }
            const published = await publishDecisionRecord(ado, {
              storyId: initial.story.id,
              dumpId,
              questionSeq: decision.questionSeq,
              question: decision.question,
              answer: decision.answer,
              recommendation: decision.recommendation,
              decidedBy: decision.decidedBy,
              decidedAt: decision.decidedAt,
            });
            store.attachDecisionRecord({
              sessionId: input.sessionId,
              questionSeq: decision.questionSeq,
              recordId: published.commentId,
              recordUrl: published.url,
            });
            changed(input.sessionId);
          }
  
          const withRecords = readDossie(store, input.sessionId);
          if (!withRecords) throw new CeremonyError(`cerimônia ${input.sessionId} não existe.`);
          await publishStorySpec(ado, {
            storyId: withRecords.story.id,
            dumpId,
            markdown: appendDecisionTraceability(signed, withRecords.decisions),
            estimate: input.estimate,
          });
          await publishChildTasks(ado, { storyId: withRecords.story.id, dumpId, tasks });
          await publishDumpCompletion(ado, {
            storyId: withRecords.story.id,
            dumpId,
            openQuestions: initial.pending.length,
          });

          store.markDumpCompleted(input.sessionId, initial.decisions.length);
          changed(input.sessionId);
          options.logger.info(
            {
              sessionId: input.sessionId,
              storyId: withRecords.story.id,
              decisions: withRecords.decisions.length,
              tasks: tasks.length,
              estimate: input.estimate,
            },
            "despejo da cerimônia concluído",
          );
        } catch (error) {
          store.abortDump(input.sessionId);
          changed(input.sessionId);
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

function fingerprint(
  sessionId: string,
  storyId: number,
  markdown: string,
  tasks: readonly ReturnType<typeof parseTaskDraft>[number][],
  estimate: number,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ sessionId, storyId, markdown, tasks, estimate }))
    .digest("hex");
}
