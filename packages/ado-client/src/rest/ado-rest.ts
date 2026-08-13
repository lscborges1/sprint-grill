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

interface RequestSpecBase<TSchema extends z.ZodType> {
  /** Nome curto da operação, usado no log e na mensagem de erro. */
  readonly operation: string;
  /** Caminho a partir do projeto, ex.: `_apis/wit/wiql`. */
  readonly path: string;
  readonly schema: TSchema;
  readonly apiVersion?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /** Conteúdo especial exigido pela rota, por exemplo application/json-patch+json. */
  readonly contentType?: string;
  /** Cabeçalhos de concorrência específicos da rota, como `If-Match`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Uma falha de concorrência conhecida, segura para o Operador tentar de novo. */
  readonly conflict?: string;
  /** Escopo do PAT exigido por APIs que não pertencem a Work Items. */
  readonly requiredPatScope?: string;
  /**
   * Mensagem de 404 quando o que sumiu é o recurso pedido, não a config: sem
   * isto o Operador vai conferir org e projeto por causa de um id errado.
   */
  readonly notFound?: string;
}

interface ReadRequestSpec<TSchema extends z.ZodType> extends RequestSpecBase<TSchema> {
  readonly write?: false;
  readonly method?: "GET" | "POST";
}

interface WriteRequestSpec<TSchema extends z.ZodType> extends RequestSpecBase<TSchema> {
  /**
   * Marca a operação como escrita (ADR 0002 — esta é a única porta de escrita
   * no ADO). A escrita sai em `info` com metadados de auditoria, sem expor o
   * conteúdo do artefato, e cada falha passa a dizer se o Operador precisa
   * conferir a US antes de tentar de novo.
   */
  readonly write: true;
  /** A rota de work items usa PATCH com JSON Patch; POST continua sendo o padrão de escrita. */
  readonly method?: "POST" | "PATCH" | "PUT";
}

export type RequestSpec<TSchema extends z.ZodType> =
  | ReadRequestSpec<TSchema>
  | WriteRequestSpec<TSchema>;

const DEFAULT_API_VERSION = "7.1";

/**
 * Comments ainda são rota preview. Leitura e escrita compartilham a versão de
 * propósito: ler os comments numa versão diferente da que os escreveu é como o
 * marcador do picker some no caminho e a US fica "sem Investigação" para sempre.
 */
export const COMMENTS_API_VERSION = "7.1-preview.4";

/**
 * O que uma escrita que não terminou limpa exige do Operador. Prometer que nada
 * foi gravado quando não dá para saber é o que produz comment duplicado na US.
 */
const CHECK_THE_US = " Confira a US antes de tentar de novo.";

export interface AdoRest {
  readonly logger: Logger;
  /** URL da US no board — é o link que o Operador abre, não o da REST API. */
  workItemUrl(id: number): string;
  /** URL REST de um work item, usada em relações hierárquicas/de dependência. */
  workItemApiUrl(id: number): string;
  request<TSchema extends z.ZodType>(
    spec: RequestSpec<TSchema>,
  ): Promise<z.infer<TSchema>>;
  /** Variante para rotas cuja resposta carrega um ETag ou outro metadado HTTP. */
  requestWithHeaders<TSchema extends z.ZodType>(
    spec: RequestSpec<TSchema>,
  ): Promise<{ readonly data: z.infer<TSchema>; readonly headers: Headers }>;
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

    workItemApiUrl(id) {
      return `${projectUrl}/_apis/wit/workitems/${id}`;
    },

    async request(spec) {
      const result = await performRequest(spec);
      return result.data;
    },

    async requestWithHeaders(spec) {
      return performRequest(spec);
    },
  };

  async function performRequest<TSchema extends z.ZodType>(
    spec: RequestSpec<TSchema>,
  ): Promise<{ readonly data: z.infer<TSchema>; readonly headers: Headers }> {
      const url = buildUrl(`${projectUrl}/${spec.path}`, {
        ...spec.query,
        "api-version": spec.apiVersion ?? DEFAULT_API_VERSION,
      });

      const response = await send(doFetch, url, spec, authorization);
      const payload = await readJson(response, spec);
      const parsed = spec.schema.safeParse(payload);

      if (!parsed.success) {
        logger.error(
          { operation: spec.operation, url, issues: parsed.error.issues },
          "resposta do Azure DevOps fora do contrato",
        );
        throw new AdoError(
          "unexpected-response",
          spec.write
            ? `O Azure DevOps aceitou ${spec.operation} mas respondeu num formato ` +
                `inesperado — a gravação provavelmente foi feita.${CHECK_THE_US}`
            : `O Azure DevOps respondeu ${spec.operation} num formato inesperado. ` +
                `Confira se a organização "${organization}" e o projeto "${project}" estão certos.`,
          { cause: parsed.error, writeMayHaveSucceeded: spec.write === true },
        );
      }

      if (spec.write) {
        // URL e tamanho dão rastreabilidade sem copiar conteúdo de US ou do
        // relatório para o log. A URL identifica o work item que recebeu a
        // escrita; o corpo pode conter dados sensíveis da squad.
        logger.info(
          {
            operation: spec.operation,
            url,
            bodyBytes:
              spec.body === undefined ? 0 : Buffer.byteLength(JSON.stringify(spec.body)),
          },
          "escrita no Azure DevOps concluída",
        );
      } else {
        logger.debug(
          { operation: spec.operation, url },
          "leitura no Azure DevOps concluída",
        );
      }

      return { data: parsed.data, headers: response.headers };
  }
}

async function send(
  doFetch: typeof globalThis.fetch,
  url: string,
  spec: RequestSpec<z.ZodType>,
  authorization: string,
): Promise<Response> {
  let response: Response;

  const method = spec.method ?? (spec.body === undefined ? "GET" : "POST");

  try {
    response = await doFetch(url, {
      method,
      headers: {
        accept: "application/json",
        authorization,
        ...spec.headers,
        ...(spec.body === undefined
          ? {}
          : { "content-type": spec.contentType ?? "application/json" }),
      },
      ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
    });
  } catch (cause) {
    throw new AdoError(
      "connection",
      `Não foi possível falar com o Azure DevOps (${spec.operation}). ` +
      `Verifique a conexão e se ${new URL(url).origin} está acessível.` +
        // A requisição pode ter chegado lá antes de a conexão cair.
        (spec.write ? CHECK_THE_US : ""),
      { cause, writeMayHaveSucceeded: spec.write === true },
    );
  }

  if (response.ok) return response;
  throw failedResponse(response, spec);
}

/**
 * Cada código vira uma instrução diferente para o Operador: PAT, config ou
 * "isso não é problema seu". Mensagem genérica aqui custa uma cerimônia parada.
 */
function failedResponse(
  response: Response,
  spec: RequestSpec<z.ZodType>,
): AdoError {
  if (response.status === 401 || response.status === 403) {
    const requiredPatScope = spec.requiredPatScope ??
      `${spec.write ? "leitura e escrita" : "leitura"} de work items`;
    return new AdoError(
      "auth",
      "O Azure DevOps recusou a credencial. Gere um novo Personal Access Token " +
        `com escopo de ${requiredPatScope} ` +
        "e atualize AZURE_DEVOPS_PAT.",
    );
  }

  if (response.status === 404) {
    return new AdoError(
      "not-found",
      spec.notFound ??
        "O Azure DevOps não encontrou a organização ou o projeto configurado. " +
          "Confira azureDevOps.organization e azureDevOps.project na config da squad.",
    );
  }

  if (spec.conflict && (response.status === 400 || response.status === 409 || response.status === 412)) {
    return new AdoError("conflict", spec.conflict);
  }

  // 5xx numa escrita: o ADO pode ter gravado antes de devolver o erro. Dizer
  // "nada foi gravado" liberaria o retry e criaria comment duplicado na US.
  if (spec.write && response.status >= 500) {
    return new AdoError(
      "unexpected-response",
      `O Azure DevOps falhou em ${spec.operation} (HTTP ${response.status})` +
        ` — a gravação pode ter acontecido mesmo assim.${CHECK_THE_US}`,
      { writeMayHaveSucceeded: true },
    );
  }

  return new AdoError(
    "unexpected",
    `O Azure DevOps falhou em ${spec.operation} (HTTP ${response.status})` +
      (spec.write ? " — nada foi gravado." : "."),
  );
}

/**
 * PAT expirado costuma vir como página de login com 200 — sem esta checagem o
 * erro apareceria como "formato inesperado" e mandaria o Operador caçar a config.
 * Em escrita, porém, 2xx sem content-type JSON não pode virar `auth`: o ADO
 * pode ter gravado o comment e o UI trataria como retry seguro (duplicata).
 */
async function readJson(
  response: Response,
  spec: RequestSpec<z.ZodType>,
): Promise<unknown> {
  if (!response.headers.get("content-type")?.includes("json")) {
    if (spec.write) {
      throw new AdoError(
        "unexpected-response",
        `O Azure DevOps aceitou ${spec.operation} mas respondeu sem JSON ` +
          `— a gravação provavelmente foi feita.${CHECK_THE_US}`,
        { writeMayHaveSucceeded: true },
      );
    }

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
      `O Azure DevOps respondeu ${spec.operation} com um corpo que não é JSON válido.` +
        (spec.write ? CHECK_THE_US : ""),
      { cause, writeMayHaveSucceeded: spec.write === true },
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
