"use client";

import type {
  CeremonyCitation,
  CeremonyConsultation,
  PalcoState,
} from "@sprint-griller/ceremony";
import { useActionState } from "react";
import { Button } from "../../../components/ui";
import { addDoubtAction } from "../actions";

/**
 * Fato ao vivo: o que mata o "alguém verifica depois". Dúvida factual que surge
 * na sala é disparada aqui, o agente lê o código na hora e volta com a resposta
 * e o arquivo que a sustenta.
 *
 * Fica fora do Palco da decisão de propósito: a pergunta que a sala está
 * decidindo continua projetada enquanto o fato é buscado, e a resposta **não**
 * é Registro de decisão — ninguém decidiu nada, o repositório respondeu.
 */
export function Doubts({ state }: { readonly state: PalcoState }) {
  const over = state.refinement.phase === "publicado" || state.current.phase === "falhou";
  if (over && !state.consultation) return null;

  return (
    <section
      aria-labelledby="adicionar-duvida"
      className="flex flex-col gap-5 rounded-[var(--radius-md)] border border-line bg-surface px-6 py-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="adicionar-duvida" className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Adicionar dúvida
        </h2>
        <p className="text-sm text-muted">
          O agente classifica a dúvida: fato verificável ou escolha para a Agenda.
        </p>
      </div>

      {state.consultation && <Consultation consultation={state.consultation} />}
      {!over && (
        <DoubtForm
          // Consulta nova é campo limpo: sem a `key`, a dúvida anterior fica no input.
          key={state.consultation?.id ?? "primeira"}
          sessionId={state.sessionId}
          // Uma de cada vez: o Palco só projeta a última, e outra no meio da busca
          // faria a resposta anterior sumir da tela.
          looking={state.consultation?.status === "buscando"}
        />
      )}
    </section>
  );
}

function Consultation({ consultation }: { readonly consultation: CeremonyConsultation }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-base text-muted">{consultation.question}</p>

      {consultation.status === "buscando" && (
        <p role="status" className="text-lg">
          O agente está lendo o código…
        </p>
      )}

      {consultation.status === "falhou" && (
        <p role="alert" className="text-lg text-red-600">
          A consulta não voltou: {consultation.message}
        </p>
      )}

      {consultation.status === "precisa-sala" && (
        <div role="status" className="flex flex-col gap-2 border-l-[3px] border-accent pl-4">
          <p className="text-lg">Esta dúvida é uma escolha da sala e entrou na Agenda.</p>
          <p className="text-sm text-muted">
            Recomendação do agente: {consultation.recommendation}
          </p>
        </div>
      )}

      {(consultation.status === "respondida" || consultation.status === "sem-lastro") && (
        <>
          <p className="max-w-[62ch] text-[clamp(19px,1.7vw,23px)] leading-snug">
            {consultation.answer}
          </p>
          {consultation.citations.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {consultation.citations.map((citation) => (
                <li
                  key={formatCitation(citation)}
                  className="rounded-md border border-line px-2.5 py-1 font-mono text-xs text-muted"
                >
                  {formatCitation(citation)}
                </li>
              ))}
            </ul>
          )}
          {consultation.status === "sem-lastro" && (
            // Resposta sem lastro continua na tela, marcada: o que ela não pode é
            // sair da sala como fato conferido.
            <p role="alert" className="max-w-[62ch] border-l-[3px] border-amber-600 pl-4 text-sm">
              <strong className="font-medium">Não verificado</strong> — {consultation.motivo} Trate
              como suspeita até alguém abrir o arquivo.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function DoubtForm({
  sessionId,
  looking,
}: {
  readonly sessionId: string;
  /** Já tem consulta em voo — o submit fica fechado até ela terminar. */
  readonly looking: boolean;
}) {
  const [error, ask, pending] = useActionState(addDoubtAction, null);
  const blocked = pending || looking;

  return (
    <form action={ask} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <label className="flex flex-1 flex-col gap-1.5 text-sm text-muted">
        Dúvida da sala
        <input
          type="text"
          name="question"
          required
          disabled={blocked}
          placeholder="O contrato de CreateOrder já tem campo de parcelas?"
          className="min-w-64 rounded-[var(--radius-md)] border border-line bg-surface px-4 py-2.5 text-base text-foreground disabled:opacity-50"
        />
      </label>
      <Button type="submit" disabled={blocked}>
        Perguntar ao agente
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-red-600">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * `repo · caminho → símbolo`: o `·` é o mesmo separador das evidências que o
 * agente manda com cada pergunta (elas dividem a tela com estas), e o `→` é o
 * do `formatCitation` da Investigação. Não dá para importar aquele aqui — o
 * barril do pacote arrasta o runtime do agente para o bundle do cliente.
 */
function formatCitation(citation: CeremonyCitation): string {
  const file = `${citation.repo} · ${citation.path}`;
  return citation.symbol === undefined ? file : `${file} → ${citation.symbol}`;
}
