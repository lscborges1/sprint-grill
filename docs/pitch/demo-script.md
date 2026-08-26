# Demo script — Refina

## Objetivo da demo

Mostrar que uma US aparentemente pronta pode esconder perguntas que o Refina explicita antes da sprint.

US fictícia usada na demo:

> Como cliente, quero informar um cupom no checkout para receber desconto antes de finalizar a compra.

Pergunta que a demo precisa responder:

> O Refina encontrou algo que provavelmente descobriríamos apenas quando começássemos a implementar?

Resposta esperada: sim — cumulatividade de descontos, expiração durante checkout, auditoria do desconto e impacto em cálculo/estado assíncrono.

## Preparação

```bash
pnpm install
pnpm demo
```

Abrir:

```text
http://localhost:3000/dev-ui?view=picker
```

O comando `pnpm demo` ativa `REFINA_DEMO=1`, sobe o Next.js em desenvolvimento e pula a validação de Azure DevOps/Codex/config da squad. A rota `/dev-ui` usa dados fictícios e é segura para apresentação sem expor dados ONR.

## Fluxo da demo local segura

### 1. Picker

URL:

```text
http://localhost:3000/dev-ui?view=picker
```

Destacar:

- “Descubra antes de construir.”
- Funil: sem investigação, investigadas, refinadas.
- US fictícia: `#117 · Aplicar cupom de desconto no checkout`.
- O Picker não substitui Azure DevOps; ele escolhe o próximo item a investigar.

### 2. Investigação

URL:

```text
http://localhost:3000/dev-ui?view=investigacao
```

Destacar:

- A US parece simples na superfície.
- Gaps encontrados:
  - cupom acumula com promoção automática?
  - o que acontece se expirar durante checkout?
  - desconto aplicado precisa ser auditável?
- Impactos técnicos vêm separados de hipóteses.
- Hipótese não verificada não vira fato.
- Em fluxo conectado, só relatório aprovado por grounding pode ser publicado no ADO.

### 3. Palco

URL:

```text
http://localhost:3000/dev-ui?view=palco
```

Destacar:

- O agente não decide sozinho.
- Ele pergunta uma decisão humana por vez.
- A pergunta vem com recomendação e evidência.
- A sala continua dona da decisão.

### 4. Dossiê

URL:

```text
http://localhost:3000/dev-ui?view=dossie
```

Destacar:

- Decisão registrada: cupom não acumula.
- Spec e tickets aparecem como artefatos revisáveis.
- O objetivo é chegar à sprint com decisões explícitas e menos surpresa.

## Demo conectada ao Azure DevOps (opcional)

Usar apenas se houver ambiente preparado e sem dados confidenciais na projeção.

Pré-requisitos:

```bash
cp sprint-griller.config.example.json sprint-griller.config.json
$EDITOR sprint-griller.config.json
cp apps/web/.env.example apps/web/.env
$EDITOR apps/web/.env
pnpm dev
```

Também precisa de Codex CLI autenticado para a Investigação real:

```bash
pnpm --filter @sprint-griller/agent-runtime harness "investigue o cache de sessão"
```

Fluxo:

1. Abrir `http://localhost:3000`.
2. Escolher uma US real não confidencial ou sanitizada.
3. Clicar `Investigar`.
4. Acompanhar `/investigacao/<id>`.
5. Se o relatório for aprovado, publicar no ADO ou explicar que a publicação será omitida na demo.
6. Abrir Refinamento com a sala.

## Plano B se algo falhar

- ADO/PAT indisponível: usar `/dev-ui?view=picker` e explicar que é fixture local segura.
- Codex/runtime indisponível: mostrar `/dev-ui?view=investigacao` e explicar o contrato real de grounding.
- Build/dev server falhar: abrir `docs/pitch/pitch.md` e `docs/pitch/speaker-notes.md`; narrar os quatro estados com prints do README em `docs/assets/readme/`.
- Pergunta sobre “isso elimina bloqueio?”: responder “não; o objetivo é antecipar descoberta, não prometer eliminação”.

## Resultado esperado

Ao final da demo, a equipe deve conseguir dizer:

- qual pergunta apareceu antes da sprint;
- qual impacto técnico foi levantado;
- o que ainda era hipótese;
- qual decisão a sala precisou tomar;
- como isso viraria contexto de refinamento antes da implementação.
