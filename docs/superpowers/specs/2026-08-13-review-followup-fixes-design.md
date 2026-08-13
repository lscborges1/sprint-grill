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

`dumpCeremony` keeps its existing synchronous snapshot boundary: it reads the
Dossiê, validates pending confirmation and signed inputs, and calls `beginDump`
without an intervening `await`. JavaScript therefore cannot settle a consultation
between that read and the store freeze. The two possible orderings are explicit:

- if a consultation settles first, the Dossiê snapshot contains its verified or
  unverified outcome;
- if dumping freezes first, the `buscando` question remains an unknown in the
  signed Spec and the store rejects the late consultation write through the
  existing Dossiê mutability guard.

No ADO request starts before this snapshot is validated and frozen.

## Markdown publication

The current handwritten renderer recognizes only headings and unordered lists.
It will be replaced by `markdown-it` because preserving general Markdown is not
a small extension to that parser. The parser will run synchronously with GFM-style
tables enabled by its default preset and raw HTML disabled (`html: false`). It
must:

- support ordered lists, fenced code, blockquotes, tables, images, links, and the
  existing headings and nested unordered lists;
- expose a synchronous typed API suitable for the existing deterministic ADO
  publication flow;
- render raw operator HTML as inert text rather than executable markup;
- allow link destinations only for absolute `http:`, `https:`, and `mailto:`
  URLs; unsafe links keep their visible label but receive no anchor;
- allow image sources only for absolute `http:` and `https:` URLs; unsafe images
  render their alt text without an image element.

URL checks operate on decoded destinations before `markdown-it` emits attributes,
so character/entity encoding cannot bypass the scheme policy. Attribute values
remain escaped by the renderer.

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

1. `readDossie` covers the consultation status matrix: `respondida` is not
   pending; `buscando`, `falhou`, and `sem-lastro` are pending; only `respondida`
   contributes verified impact and only `sem-lastro` contributes an unverified
   answer.
2. `dumpCeremony` proves each unresolved status requires confirmation before any
   mocked ADO write. Controlled-order tests cover a consultation settling before
   the snapshot and a consultation attempting to settle after `beginDump`.
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
