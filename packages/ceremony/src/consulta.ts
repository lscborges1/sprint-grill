import { AgentRuntimeError } from "@sprint-griller/agent-runtime";
import type { AgentQuestion, AgentRuntime } from "@sprint-griller/agent-runtime";
import type { Logger, SquadConfig } from "@sprint-griller/core";
import { citationSchema, readJsonBlock, verifyGrounding } from "@sprint-griller/investigation";
import { z } from "zod";
import { consultationInstructions, consultationPrompt } from "./prompt";
import type { ConsultationStory } from "./prompt";
import type { ConsultationOutcome } from "./types";

/** O que o agente da Consulta ouve se resolver perguntar em vez de ler o código. */
export const CONSULTA_SEM_SALA =
  "Ninguém responde por aqui: a sala está no Palco esperando um fato. " +
  "Leia os repositórios e responda com o que o código disser.";

export interface RunConsultationOptions {
  /** Ciclo de vida do runtime é de quem chama — a Consulta só abre uma sessão. */
  readonly runtime: AgentRuntime;
  readonly repos: SquadConfig["repos"];
  readonly story: ConsultationStory;
  /** A dúvida de fato que surgiu na sala, como o Operador escreveu. */
  readonly question: string;
  readonly logger?: Logger;
}

/**
 * A resposta como o agente a entrega: afirmação + citações. Mesmo contrato da
 * Investigação, e pela mesma razão — é a estrutura que torna a citação
 * verificável em vez de decorativa.
 */
const consultationAnswerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fact"),
    answer: z.string().min(1, "responda a pergunta da sala"),
  }),
  z.object({
    kind: z.literal("room-choice"),
    question: z.string().min(1),
    recommendation: z.string().min(1),
    evidence: z.array(z.string().min(1)).min(1),
    options: z
      .array(z.object({ label: z.string().min(1), description: z.string().min(1) }))
      .default([]),
    allowFreeText: z.boolean().default(true),
  }),
]);
const consultationCitationsFieldSchema = z.object({ citations: z.unknown().optional() });
const consultationCitationsSchema = z.array(citationSchema);

const INVALID_CITATIONS_REASON =
  "a resposta trouxe citações em formato inválido, então as evidências não puderam ser conferidas.";
const CONSULTATION_FAILURE_MESSAGE = "A consulta parou por um erro inesperado.";

/**
 * Uma dúvida **factual** da sala resolvida ao vivo: o agente abre uma sessão
 * própria, lê os repos e volta com a resposta e as citações que a sustentam.
 *
 * Sessão separada da cerimônia de propósito: o turno do grilling está parado na
 * decisão da vez, e o codex só aceita um turno por sessão — perguntar por dentro
 * dele custaria a pergunta que está projetada na tela.
 *
 * A Investigação **não** entra como insumo: consulta factual se responde no
 * código, e repetir o que outro turno escreveu seria fato de segunda mão.
 */
export async function runConsultation(
  options: RunConsultationOptions,
): Promise<ConsultationOutcome> {
  const { runtime, repos, story, question } = options;
  const logger = options.logger?.child({ storyId: story.id });

  let lastMessage = "";
  let failure: string | undefined;

  try {
    const session = await runtime.startSession({
      instructions: consultationInstructions(repos),
    });

    for await (const event of session.send(consultationPrompt(story, question))) {
      switch (event.type) {
        case "message":
          lastMessage = event.text;
          break;

        // Perguntar travaria o turno para sempre: quem espera é a sala, no Palco.
        case "question":
          logger?.info({ questions: event.question.questions.length }, "consulta não tem sala");
          await event.question.answer(noRoomAnswers(event.question.questions));
          break;

        // Leitura dentro do sandbox não pede aprovação: o que chega aqui é o
        // agente querendo sair dele, e isso nunca é fato que a sala pediu.
        case "approval":
          logger?.warn({ kind: event.approval.kind }, "aprovação recusada na consulta");
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
    logger?.error({ reason: failure }, "consulta factual falhou");
    return { status: "falhou", message: CONSULTATION_FAILURE_MESSAGE };
  }

  return grade(options, lastMessage, logger);
}

/**
 * A mesma checagem mecânica da Investigação, com a sala na frente: resposta que
 * não fecha com o disco continua na tela, marcada — o que ela não pode é passar
 * por fato e sair da cerimônia como se tivesse sido conferida.
 */
function grade(
  { repos, question }: RunConsultationOptions,
  lastMessage: string,
  logger: Logger | undefined,
): ConsultationOutcome {
  // A dúvida é input livre do Operador — pode trazer PII. Nos logs fica só o
  // tamanho; storyId já vem no child do logger.
  const questionLength = question.length;

  const candidate = readJsonBlock(lastMessage);
  const parsedAnswer = consultationAnswerSchema.safeParse(candidate);
  if (!parsedAnswer.success) {
    logger?.error({ questionLength }, "resposta da consulta ilegível");
    return {
      status: "falhou",
      message: "O agente terminou sem devolver a resposta no formato combinado. Pergunte de novo.",
    };
  }

  if (parsedAnswer.data.kind === "room-choice") {
    logger?.info({ questionLength }, "dúvida classificada como escolha da sala");
    return {
      status: "precisa-sala",
      question: parsedAnswer.data.question,
      recommendation: parsedAnswer.data.recommendation,
      evidence: parsedAnswer.data.evidence,
      options: parsedAnswer.data.options,
      allowFreeText: parsedAnswer.data.allowFreeText,
    };
  }

  const answer = parsedAnswer.data.answer;
  const citationsField = consultationCitationsFieldSchema.parse(candidate).citations;
  const parsedCitations = consultationCitationsSchema.safeParse(citationsField ?? []);
  if (!parsedCitations.success) {
    logger?.warn({ questionLength }, "consulta respondeu com citações em formato inválido");
    return {
      status: "sem-lastro",
      answer,
      citations: [],
      motivo: INVALID_CITATIONS_REASON,
    };
  }

  const citations = parsedCitations.data;
  if (citations.length === 0) {
    logger?.warn({ questionLength }, "consulta respondida sem citação");
    return {
      status: "sem-lastro",
      answer,
      citations,
      motivo: "a resposta veio sem citar nenhum arquivo dos repos da squad.",
    };
  }

  const grounding = verifyGrounding([{ claim: answer, citations }], [
    repos.primary,
    ...repos.related,
  ]);

  if (grounding.status === "reprovado") {
    logger?.warn(
      {
        questionLength,
        violations: grounding.violations.map((violation) => violation.detail),
      },
      "consulta reprovada na checagem de citações",
    );
    return {
      status: "sem-lastro",
      answer,
      citations,
      motivo: grounding.violations.map((violation) => violation.detail).join(" "),
    };
  }

  logger?.info({ questionLength, citations: citations.length }, "consulta respondida");
  return { status: "respondida", answer, citations };
}

function noRoomAnswers(questions: readonly AgentQuestion[]): Record<string, readonly string[]> {
  return Object.fromEntries(questions.map((question) => [question.id, [CONSULTA_SEM_SALA]]));
}
