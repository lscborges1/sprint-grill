import { pino } from "pino";
import type {
  DestinationStream,
  Logger as PinoLogger,
  LoggerOptions,
} from "pino";
import { z } from "zod";
import { ConfigError } from "../config-error";

export type Logger = PinoLogger;

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const LOG_LEVEL_ENV_VAR = "LOG_LEVEL";
const DEFAULT_LOG_LEVEL: LogLevel = "info";

/**
 * Campos que nunca podem sair no log. O PAT do Azure DevOps é o motivo principal:
 * cada escrita no ADO é logada com payload, e payload passa perto de credencial.
 */
const SECRET_FIELDS = ["pat", "token", "password", "authorization"] as const;

const REDACTED_PATHS = SECRET_FIELDS.flatMap((field) => [
  field,
  `*.${field}`,
  `*.*.${field}`,
]);

export interface CreateLoggerOptions {
  /** Fronteira que emite o log (`agent-runtime`, `ado-client`, `web`). */
  readonly name?: string;
  /** Padrão: `LOG_LEVEL` do ambiente, ou `info`. */
  readonly level?: LogLevel;
  /** Padrão: stdout. Os testes injetam um stream em memória. */
  readonly destination?: DestinationStream;
}

/**
 * Logger estruturado (uma linha JSON por evento) usado nas duas fronteiras do
 * sistema. Log de decisão, não de ruído — ver `docs/adr/`.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? logLevelFromEnv(),
    base: { app: "sprint-griller" },
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...(options.name === undefined ? {} : { name: options.name }),
  };

  return options.destination
    ? pino(loggerOptions, options.destination)
    : pino(loggerOptions);
}

/** Nível inválido é erro de config, não motivo para degradar em silêncio. */
function logLevelFromEnv(
  env: Record<string, string | undefined> = process.env,
): LogLevel {
  const raw = env[LOG_LEVEL_ENV_VAR];
  if (raw === undefined || raw === "") return DEFAULT_LOG_LEVEL;

  const result = z.enum(LOG_LEVELS).safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      `${LOG_LEVEL_ENV_VAR} inválido: "${raw}". Use um de: ${LOG_LEVELS.join(", ")}.`,
    );
  }

  return result.data;
}
