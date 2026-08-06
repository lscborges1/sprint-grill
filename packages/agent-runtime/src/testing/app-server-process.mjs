// App-server falso: fala o mesmo JSONL do `codex app-server`, mas segue um
// roteiro. Os testes o spawnam com o Node de verdade, então framing, stdio e
// morte de processo são exercitados sem tocar na assinatura do Operador.
//
// Uso: node fake-app-server.mjs '<roteiro JSON>' [caminho-do-transcript]
//
// Roteiro:
// {
//   "reactions": {
//     "<método>": {
//       "result": { ... },                  // resposta ao request do cliente
//       "error": { "message": "..." },
//       "emit": [                           // executado depois de responder
//         { "notify": { "method": "...", "params": { ... } } },
//         { "request": { "method": "...", "params": { ... } } },  // espera a resposta
//         { "raw": "não é json" },
//         { "exit": 1 }
//       ]
//     },
//     "<outro método>": [ { ... }, { ... } ] // uma reação por chamada, na ordem
//   }
// }
//
// Toda linha recebida é anexada ao arquivo de transcript, para os testes
// afirmarem sobre o que o cliente enviou.

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const script = JSON.parse(process.argv[2] ?? "{}");
const transcriptPath = process.argv[3];

/** Respostas pendentes dos requests que *nós* mandamos para o cliente. */
const pendingResponses = new Map();
let nextRequestId = 1000;

/** Chamadas já atendidas por método — o roteiro em lista responde na ordem. */
const callCounts = new Map();

function reactionFor(method) {
  const scripted = script.reactions?.[method] ?? { result: {} };
  if (!Array.isArray(scripted)) return scripted;

  const seen = callCounts.get(method) ?? 0;
  callCounts.set(method, seen + 1);
  // A última reação repete: lista curta não trava o teste.
  return scripted.at(Math.min(seen, scripted.length - 1)) ?? { result: {} };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function requestClient(method, params) {
  const id = nextRequestId++;
  return new Promise((resolve) => {
    pendingResponses.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

async function runEmissions(emissions = []) {
  for (const emission of emissions) {
    if (emission.notify) {
      send({ jsonrpc: "2.0", ...emission.notify });
    } else if (emission.request) {
      await requestClient(emission.request.method, emission.request.params);
    } else if (emission.raw !== undefined) {
      process.stdout.write(`${emission.raw}\n`);
    } else if (emission.exit !== undefined) {
      // stdout para pipe é assíncrono: sair na hora truncaria o que já foi escrito.
      await new Promise((resolve) => setTimeout(resolve, 20));
      process.exit(emission.exit);
    }
  }
}

const readline = createInterface({ input: process.stdin });

readline.on("line", (line) => {
  if (line.trim() === "") return;
  if (transcriptPath) appendFileSync(transcriptPath, `${line}\n`);

  const message = JSON.parse(line);

  // Resposta a um request nosso (ex.: uma pergunta HITL respondida).
  if (message.id !== undefined && message.method === undefined) {
    pendingResponses.get(message.id)?.(message);
    pendingResponses.delete(message.id);
    return;
  }

  // Notificação do cliente (`initialized`): nada a responder.
  if (message.id === undefined) return;

  const reaction = reactionFor(message.method);
  if (reaction.error) {
    send({ jsonrpc: "2.0", id: message.id, error: reaction.error });
  } else {
    send({ jsonrpc: "2.0", id: message.id, result: reaction.result ?? {} });
  }

  void runEmissions(reaction.emit);
});

readline.on("close", () => process.exit(0));
