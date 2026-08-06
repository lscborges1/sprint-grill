import type { AdoCredentials, Logger, SquadConfig } from "@sprint-griller/core";
import { createLogger } from "@sprint-griller/core";
import type { z } from "zod";
import { AdoError } from "../ado-error";

const ADO_BASE_URL = "https://dev.azure.com";

/** Fronteira do Azure DevOps: tudo que o app lê ou grava no tracker passa aqui. */
export interface AdoClientOptions {
  readonly azureDevOps: SquadConfig["azureDevOps"];
  readonly credentials: AdoCredentials;
  /** Injetado pelos testes; em produção é o `fetch` do runtime. */
  readonly fetch?: typeof globalThis.fetch;
  readonly logger?: Logger;
}

interface RequestSpec<TSchema extends z.ZodType> {
  /** Nome curto da operação, usado no log e na mensagem de erro. */
  readonly operation: string;
  /** Caminho a partir do projeto, ex.: `_apis/wit/wiql`. */
  readonly path: string;
  readonly schema: TSchema;
  readonly apiVersion?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

const DEFAULT_API_VERSION = "7.1";

export interface AdoRest {
  readonly logger: Logger;
  /** URL da US no board — é o link que o Operador abre, não o da REST API. */
  workItemUrl(id: number): string;
  request<TSchema extends z.ZodType>(
    spec: RequestSpec<TSchema>,
  ): Promise<z.infer<TSchema>>;
}

export function createAdoRest(options: AdoClientOptions): AdoRest {
  const { organization, project } = options.azureDevOps;
  const doFetch = options.fetch ?? globalThis.fetch;
  const logger = options.logger ?? createLogger({ name: "ado-client" });
  const authorization = `Basic ${Buffer.from(`:${options.credentials.pat}`).toString("base64")}`;
  const projectUrl = `${ADO_BASE_URL}/${encode(organization)}/${encode(project)}`;

  return {
    logger,

    workItemUrl(id) {
      return `${projectUrl}/_workitems/edit/${id}`;
    },

    async request(spec) {
      const url = buildUrl(`${projectUrl}/${spec.path}`, {
        ...spec.query,
        "api-version": spec.apiVersion ?? DEFAULT_API_VERSION,
      });

      const response = await send(doFetch, url, spec, authorization);
      const payload = await readJson(response, spec.operation);
      const parsed = spec.schema.safeParse(payload);

      if (!parsed.success) {
        logger.error(
          { operation: spec.operation, url, issues: parsed.error.issues },
          "resposta do Azure DevOps fora do contrato",
        );
        throw new AdoError(
          "unexpected-response",
          `O Azure DevOps respondeu ${spec.operation} num formato inesperado. ` +
            `Confira se a organização "${organization}" e o projeto "${project}" estão certos.`,
          { cause: parsed.error },
        );
      }

      logger.debug(
        { operation: spec.operation, url },
        "leitura no Azure DevOps concluída",
      );
      return parsed.data;
    },
  };
}

async function send(
  doFetch: typeof globalThis.fetch,
  url: string,
  spec: RequestSpec<z.ZodType>,
  authorization: string,
): Promise<Response> {
  let response: Response;

  try {
    response = await doFetch(url, {
      method: spec.body === undefined ? "GET" : "POST",
      headers: {
        accept: "application/json",
        authorization,
        ...(spec.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
    });
  } catch (cause) {
    throw new AdoError(
      "connection",
      `Não foi possível falar com o Azure DevOps (${spec.operation}). ` +
        `Verifique a conexão e se ${new URL(url).origin} está acessível.`,
      { cause },
    );
  }

  if (response.ok) return response;
  throw failedResponse(response, spec.operation);
}

/**
 * Cada código vira uma instrução diferente para o Operador: PAT, config ou
 * "isso não é problema seu". Mensagem genérica aqui custa uma cerimônia parada.
 */
function failedResponse(response: Response, operation: string): AdoError {
  if (response.status === 401 || response.status === 403) {
    return new AdoError(
      "auth",
      "O Azure DevOps recusou a credencial. Gere um novo Personal Access Token " +
        "com escopo de leitura de work items e atualize AZURE_DEVOPS_PAT.",
    );
  }

  if (response.status === 404) {
    return new AdoError(
      "not-found",
      "O Azure DevOps não encontrou a organização ou o projeto configurado. " +
        "Confira azureDevOps.organization e azureDevOps.project na config da squad.",
    );
  }

  return new AdoError(
    "unexpected",
    `O Azure DevOps falhou em ${operation} (HTTP ${response.status}).`,
  );
}

/**
 * PAT expirado costuma vir como página de login com 200 — sem esta checagem o
 * erro apareceria como "formato inesperado" e mandaria o Operador caçar a config.
 */
async function readJson(response: Response, operation: string): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("json")) {
    throw new AdoError(
      "auth",
      "O Azure DevOps respondeu com uma página de login em vez de dados. " +
        "O Personal Access Token em AZURE_DEVOPS_PAT provavelmente expirou.",
    );
  }

  try {
    return await response.json();
  } catch (cause) {
    throw new AdoError(
      "unexpected-response",
      `O Azure DevOps respondeu ${operation} com um corpo que não é JSON válido.`,
      { cause },
    );
  }
}

function buildUrl(base: string, query: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** Org e projeto podem ter espaço; o path precisa deles escapados. */
function encode(segment: string): string {
  return encodeURIComponent(segment);
}
