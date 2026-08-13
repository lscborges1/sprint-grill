# Review Follow-up Fixes Design

## Goal

Fix the three accepted review findings without changing the signed dump, retry,
or Azure DevOps ownership contracts:

1. unresolved factual consultations must participate in the maturity gate;
2. operator-authored Markdown must retain its structure when published as ADO HTML;
3. dump runtime schemas and TypeScript types must have one source of truth.

## Unresolved factual consultations

The ceremony store will expose all consultations whose question remains unresolved:
`buscando`, `falhou`, and `sem-lastro`. `readDossie` will use that projection for
`pending`, while only `sem-lastro` consultations continue contributing an answer
and grounding failure to the `Não verificado` context.

This keeps the domain distinction intact:

- `respondida` is verified impact context and is not pending;
- `sem-lastro` is both an explicit unknown and unverified context;
- `buscando` and `falhou` contribute their question as an explicit unknown;
- the existing server-side `initial.pending` check continues to require explicit
  confirmation before any ADO write.

The store query, rather than UI-only logic, is the shared source for rendering the
gate, generating the Spec, and enforcing confirmation in `dumpCeremony`.

## Markdown publication

The current handwritten renderer recognizes only headings and unordered lists.
It will be replaced by a maintained Markdown parser because preserving general
Markdown is not a small extension to that parser. The selected parser must:

- support ordered lists, fenced code, blockquotes, tables, images, links, and the
  existing headings and nested unordered lists;
- expose a synchronous typed API suitable for the existing deterministic ADO
  publication flow;
- prevent raw operator HTML from becoming executable HTML in ADO by escaping or
  disabling raw HTML;
- preserve the existing URL-scheme restriction for rendered links and images.

The parser remains inside `ado-client`; the agent still never writes to ADO and
the REST publication order remains unchanged.

## Schema-first dump state

A browser-safe dump-state module will own `signedDumpInputsSchema` and
`dumpStateSchema`. `SignedDumpInputs` and `CeremonyDumpState` will be derived with
`z.infer` from those schemas. The server domain types and `dossieStateSchema` will
import this shared contract rather than repeat its shape.

The existing `signedDumpInputs` projection remains browser-safe and keeps its
public behavior. No persistence columns, status variants, or retry semantics
change.

## Test seams and sequence

Behavior is tested through public interfaces:

1. `readDossie` proves `buscando` and `falhou` consultations appear in pending
   items and generated Spec unknowns.
2. `dumpCeremony` proves an unresolved consultation requires confirmation before
   any mocked ADO write.
3. `markdownToAdoHtml` proves representative Markdown structures survive as the
   corresponding safe HTML and raw HTML is not passed through.
4. Existing session-state tests and workspace typechecking prove the schema-first
   refactor remains compatible.

Each behavioral fix follows a separate red-green cycle. Final verification runs
focused tests followed by the full workspace check.

## Out of scope

- changing dump fingerprints, persistence, reconciliation, or publication order;
- changing which successfully grounded consultation answers become impact context;
- introducing a rich-text editor or Markdown preview UI;
- broad refactoring of the ceremony store or ADO REST client.
