import { describe, expect, it } from "vitest";
import {
  parseTaskDraft,
  taskDraftTemplate,
  taskPreviewFromTranscript,
  validateTaskDraft,
} from "./task-draft";

const SPEC_URL = "https://dev.azure.com/acme/Plataforma/_workitems/edit/4211";

const VALID = `## Criar endpoint de exportação

Entrega o CSV de comissões para o Operador.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- Retorna um CSV com a comissão arredondada pela regra bancária.

## Mostrar link no portal

Mostra o resultado da exportação no fluxo existente do portal.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- Exibe o link somente quando a exportação estiver pronta.

### Bloqueada por

- Criar endpoint de exportação`;

describe("parseTaskDraft", () => {
  it("should preserve every signed Task section while extracting publication metadata", () => {
    const markdown = `## Criar endpoint

Entrega o CSV ao Operador.

[Spec da US](${SPEC_URL})

### Contexto técnico

Preservar compatibilidade com clientes antigos.

### Critérios de aceite

- Retorna CSV em UTF-8.

### Bloqueada por

- Preparar contrato

## Preparar contrato

Documenta o contrato público.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- Publica o schema.`;

    expect(parseTaskDraft(markdown, SPEC_URL)[0]).toEqual({
      title: "Criar endpoint",
      bodyMarkdown: `Entrega o CSV ao Operador.

[Spec da US](${SPEC_URL})

### Contexto técnico

Preservar compatibilidade com clientes antigos.

### Critérios de aceite

- Retorna CSV em UTF-8.

### Bloqueada por

- Preparar contrato`,
      acceptanceCriteria: ["Retorna CSV em UTF-8."],
      blockedBy: ["Preparar contrato"],
    });
  });

  it("should parse agent-ready child tasks and their native blockers", () => {
    expect(parseTaskDraft(VALID, SPEC_URL)).toEqual([
      {
        title: "Criar endpoint de exportação",
        bodyMarkdown: `Entrega o CSV de comissões para o Operador.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- Retorna um CSV com a comissão arredondada pela regra bancária.`,
        acceptanceCriteria: ["Retorna um CSV com a comissão arredondada pela regra bancária."],
        blockedBy: [],
      },
      {
        title: "Mostrar link no portal",
        bodyMarkdown: `Mostra o resultado da exportação no fluxo existente do portal.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- Exibe o link somente quando a exportação estiver pronta.

### Bloqueada por

- Criar endpoint de exportação`,
        acceptanceCriteria: ["Exibe o link somente quando a exportação estiver pronta."],
        blockedBy: ["Criar endpoint de exportação"],
      },
    ]);
  });

  it("should reject a task without acceptance criteria before dumping", () => {
    expect(() => parseTaskDraft("## Sem aceite\n\nDescrição", SPEC_URL)).toThrow(/critérios de aceite/i);
  });

  it("should reject a Task without a self-contained description", () => {
    expect(() => parseTaskDraft(`## Sem descrição

### Critérios de aceite

- Entrega observável.`, SPEC_URL)).toThrow(/descrever o slice vertical/i);
  });

  it("should reject a blocker that does not name another task", () => {
    expect(() =>
      parseTaskDraft(`${VALID}\n\n## Publicar\n\n### Critérios de aceite\n\n- Publica.\n\n### Bloqueada por\n\n- Não existe`, SPEC_URL),
    ).toThrow(/não existe/i);
  });

  it("should reject a circular dependency before any child Task is created", () => {
    expect(() =>
      parseTaskDraft(`## A

### Critérios de aceite

- Entrega A.

### Bloqueada por

- B

## B

### Critérios de aceite

- Entrega B.

### Bloqueada por

- A`, SPEC_URL),
    ).toThrow(/dependência circular/i);
  });

  it("should report every task structural failure together", () => {
    const result = validateTaskDraft(`Introdução indevida.

## A

### Critérios de aceite

Conforme discutido.

### Bloqueada por

- Não existe

## A

Descrição`, SPEC_URL);

    expect(result).toMatchObject({ valid: false });
    if (result.valid) throw new Error("esperava falhas estruturais");
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/antes da primeira/i),
      expect.stringMatching(/ao menos um critério/i),
      expect.stringMatching(/Spec atual/i),
      expect.stringMatching(/não existe/i),
      expect.stringMatching(/aparece mais de uma vez/i),
      expect.stringMatching(/não tem critérios/i),
    ]));
  });

  it("should require the current Spec link for contextual task wording", () => {
    expect(validateTaskDraft(`## Implementar

Implementa o comportamento refinado pela sala.

### Critérios de aceite

- Funciona conforme discutido na [Spec](https://exemplo.test/spec).`, SPEC_URL)).toMatchObject({ valid: false });

    expect(validateTaskDraft(`## Implementar

Implementa o comportamento refinado pela sala.

### Critérios de aceite

- Funciona conforme discutido na [Spec da US](${SPEC_URL}).`, SPEC_URL)).toMatchObject({ valid: true });
  });

  it("should reject every Task that omits the current Spec link", () => {
    const result = validateTaskDraft(`## Implementar

Entrega o comportamento refinado pela sala.

### Critérios de aceite

- Entrega observável.`, SPEC_URL);

    expect(result).toMatchObject({ valid: false });
    if (result.valid) throw new Error("esperava a ausência do link da Spec");
    expect(result.errors).toEqual([
      expect.stringMatching(/link.*Spec atual/i),
    ]);
  });

  it("should validate the exact current Spec link independently for every Task", () => {
    const result = validateTaskDraft(`## Backend

Entrega a API.

[Spec da US](${SPEC_URL})

### Critérios de aceite

- A API responde.

## Frontend

Entrega a interface.

### Critérios de aceite

- A interface consome a API.`, SPEC_URL);

    expect(result).toMatchObject({ valid: false });
    if (result.valid) throw new Error("esperava o link ausente na segunda Task");
    expect(result.errors).toEqual([
      expect.stringMatching(/Frontend.*link.*Spec atual/i),
    ]);
  });

  it("should reject a Task that links a different Spec", () => {
    const result = validateTaskDraft(`## Implementar

Entrega o comportamento refinado pela sala.

### Critérios de aceite

- Entrega observável na [Spec da US](https://dev.azure.com/acme/Plataforma/_workitems/edit/9999).`, SPEC_URL);

    expect(result).toMatchObject({ valid: false });
    if (result.valid) throw new Error("esperava o link exato da Spec atual");
    expect(result.errors).toEqual([
      expect.stringMatching(/link.*Spec atual/i),
    ]);
  });

  it("should accept a Task only when it contains the exact current Spec link", () => {
    expect(validateTaskDraft(`## Implementar

Entrega o comportamento refinado pela sala.

### Critérios de aceite

- Entrega observável na [Spec da US](${SPEC_URL}).`, SPEC_URL)).toMatchObject({ valid: true });
  });

  it.each([
    "[contrato](htps://example.test/contrato)",
    "[script](javascript:alert)",
    "[relativo](/contrato)",
    "[incompleto](https://example.test/contrato",
    "[com espaço](https://example.test/contrato inválido)",
    "[con[trato](https://example.test/contrato)",
    "[contrato](https://example.test/contra]to)",
  ])("should reject the structurally broken link %s", (link) => {
    const result = validateTaskDraft(`## Implementar

Entrega o contrato público.

### Critérios de aceite

- Documenta ${link}.`, SPEC_URL);

    expect(result).toMatchObject({ valid: false });
    if (result.valid) throw new Error("esperava um link inválido");
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/link Markdown inválido/i)]));
  });

  it("should fall back to the template when no transcript message contains a draft", () => {
    expect(taskPreviewFromTranscript(
      [{ at: 1, event: { kind: "turno-encerrado" } }],
      SPEC_URL,
    )).toContain(`[Spec da US](${SPEC_URL})`);
  });

  it("should ignore an unclosed draft marker", () => {
    expect(taskPreviewFromTranscript([{
      at: 1,
      event: { kind: "mensagem", text: "<!-- sprint-griller:tasks:start -->\n## Incompleta" },
    }], SPEC_URL)).toBe(taskDraftTemplate(SPEC_URL));
  });

  it("should select the newest complete non-empty transcript draft", () => {
    expect(taskPreviewFromTranscript([
      {
        at: 1,
        event: { kind: "mensagem", text: "<!-- sprint-griller:tasks:start -->\n## Antiga\n<!-- sprint-griller:tasks:end -->" },
      },
      {
        at: 2,
        event: { kind: "mensagem", text: "<!-- sprint-griller:tasks:start -->\n## Nova\n<!-- sprint-griller:tasks:end -->" },
      },
    ], SPEC_URL)).toBe("## Nova");
  });
});
