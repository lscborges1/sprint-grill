# Qualidade da IA: útil > bonita

Type: grilling
Status: resolved
Blocked by: 01, 06

## Question

Como garantir que perguntas, spec e tickets gerados sejam ancorados em fatos (código da squad, docs, decisões registradas) em vez de documentação plausível e bonita? Mecanismos candidatos a debater: grounding obrigatório no repo (a IA cita arquivo/linha ou não afirma), perguntas que só um humano pode responder (HITL estrito — a IA nunca responde pela squad), unknowns explícitos na spec em vez de prosa confiante, verificação adversarial da spec gerada, e o critério de "US madura" como checklist verificável.

Saída: princípios de qualidade que a spec incorpora como requisitos testáveis do produto.

## Answer

Resolvido em grilling com o Operador (5 perguntas confirmadas). Quatro princípios, todos com teste objetivo:

1. **Grounding com citação obrigatória** — toda afirmação de impacto da Investigação ancora em evidência do repo (caminho/símbolo); o não-ancorável vai para a seção **"Não verificado"**, nunca para o corpo como fato. *Teste: checagem mecânica pré-publicação (não-LLM) — caminho citado não existe ⇒ Investigação não publica.*
2. **HITL estrito com divisão de trabalho** — perguntas exibidas na UI de sessão são só *decisões* (sempre com recomendação do agente + evidência); dúvida factual surgida na cerimônia o agente resolve ao vivo lendo o código (nunca "alguém verifica depois"); nenhuma decisão é registrada sem confirmação humana. *Teste: não existe caminho no código que grave Registro de decisão sem input humano.*
3. **Despejo revisável e rastreável** — preview editável (Markdown) de spec e tasks antes de gravar (a IA redige, o humano assina); cada trecho da spec nascido de decisão da cerimônia linka o Registro de decisão correspondente; task linka a spec. *Teste: toda decisão da sessão aparece na spec com link navegável no ADO.*
4. **Tasks agent-ready verificadas estruturalmente** — critérios de aceite presentes, link para a spec, `Blocked by` íntegro (sem referência a task inexistente), nenhum "conforme discutido" sem link; falhas aparecem no gate do despejo junto às dúvidas abertas. *Evolução marcada: "leitor frio" (agente sem contexto da cerimônia tenta entender cada task) vira o teste de aceitação do futuro esforço de orquestração — não roda na cerimônia.*

**Princípio-síntese:** a IA nunca é fonte de verdade — o código é a fonte dos fatos, a squad é a fonte das decisões; a IA é o transporte verificável entre os dois.
