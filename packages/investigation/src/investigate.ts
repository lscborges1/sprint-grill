import type { AgentQuestion, AgentRuntime } from "@sprint-griller/agent-runtime";
import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import { createLogger } from "@sprint-griller/core";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { verifyGrounding } from "./grounding";
import type { CitationViolation } from "./grounding";
import { renderReportMarkdown } from "./markdown";
import { investigationInstructions, investigationPrompt } from "./prompt";
import { parseReport } from "./report";
import type { InvestigationReport } from "./report";
import type { InvestigationStory } from "./story";

/** O que o agente ouve quando pergunta durante uma execução AFK. */
export const AFK_ANSWER =
  "Ninguém está na frente da tela: esta Investigação roda AFK. " +
  "Registre esta dúvida em `gaps` e siga com o que o código responde.";

/**
 * Os três fins possíveis de uma Investigação. `reprovado` não é erro: é o
 * relatório existindo e não passando na checagem de citações — o Operador
 * precisa ver isso, e nada disso pode ser publicado como fato.
 */
export type InvestigationOutcome =
  | {
      readonly status: "aprovado";
      readonly report: InvestigationReport;
      readonly markdown: string;
    }
  | {
      readonly status: "reprovado";
      readonly report: InvestigationReport;
      readonly markdown: string;
      readonly violations: readonly CitationViolation[];
    }
  | { readonly status: "falhou"; readonly message: string };

export interface RunInvestigationOptions {
  /** Ciclo de vida (e `cwd`) é de quem chama — a Investigação só usa a sessão. */
  readonly runtime: AgentRuntime;
  readonly story: InvestigationStory;
  readonly repos: SquadConfig["repos"];
  readonly logger?: Logger;
}

/**
 * Um turno de agente, do começo ao fim, sem humano na frente: lê a US e os
 * repos, devolve o relatório estruturado, e ele só vira artefato depois de
 * passar pela checagem mecânica de citações.
 */
export async function runInvestigation(
  options: RunInvestigationOptions,
): Promise<InvestigationOutcome> {
  const { runtime, story, repos } = options;
  const logger = (options.logger ?? createLogger({ name: "investigation" })).child({
    storyId: story.id,
  });

  let lastMessage = "";
  let failure: string | undefined;

  try {
    const session = await runtime.startSession({
      instructions: investigationInstructions(repos),
    });
    logger.info({ sessionId: session.id }, "investigação iniciada");

    for await (const event of session.send(investigationPrompt(story))) {
      switch (event.type) {
        case "message":
          lastMessage = event.text;
          break;

        // Perguntar numa execução AFK travaria o turno para sempre. A dúvida do
        // agente volta como furo da US, que é onde ela é útil.
        case "question":
          logger.info({ questions: event.question.questions.length }, "pergunta respondida como AFK");
          await event.question.answer(afkAnswers(event.question.questions));
          break;

        // Leitura dentro do sandbox não pede aprovação: o que chega aqui é o
        // agente querendo sair dele, e não há humano para autorizar isso. Recusa
        // não o cega — ele segue lendo os repos pelo sandbox read-only.
        case "approval":
          logger.warn(
            { kind: event.approval.kind, summary: event.approval.summary },
            "aprovação recusada — a Investigação roda AFK e só lê",
          );
          await event.approval.decide("decline");
          break;

        case "turn-failed":
          failure = event.error.message;
          break;

        default:
          break;
      }
    }
  } catch (error) {
    if (!(error instanceof AgentRuntimeError)) throw error;
    failure = error.message;
  }

  if (failure !== undefined) {
    logger.error({ reason: failure }, "investigação falhou");
    return { status: "falhou", message: failure };
  }

  return grade(story, repos, lastMessage, logger);
}

function grade(
  story: InvestigationStory,
  repos: SquadConfig["repos"],
  lastMessage: string,
  logger: Logger,
): InvestigationOutcome {
  const parsed = parseReport(lastMessage);
  if (!parsed.ok) {
    logger.error({ reason: parsed.message }, "relatório do agente ilegível");
    return { status: "falhou", message: parsed.message };
  }

  const grounding = verifyGrounding(parsed.report.impacts, [repos.primary, ...repos.related]);
  const markdown = renderReportMarkdown(story, parsed.report, grounding);

  if (grounding.status === "reprovado") {
    logger.warn(
      { violations: grounding.violations.map((violation) => violation.detail) },
      "investigação reprovada na checagem de citações",
    );
    return {
      status: "reprovado",
      report: parsed.report,
      markdown,
      violations: grounding.violations,
    };
  }

  logger.info(
    {
      impacts: parsed.report.impacts.length,
      gaps: parsed.report.gaps.length,
      unverified: parsed.report.unverified.length,
      externalRepos: parsed.report.externalRepos.map((repo) => repo.repo),
    },
    "investigação aprovada",
  );
  return { status: "aprovado", report: parsed.report, markdown };
}

function afkAnswers(
  questions: readonly AgentQuestion[],
): Record<string, readonly string[]> {
  return Object.fromEntries(questions.map((question) => [question.id, [AFK_ANSWER]]));
}
