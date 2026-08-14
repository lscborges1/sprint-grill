# Agent-originated Agenda items

## Problem

The Refina design says the Agenda contains every gap found by the Investigation,
the room, and the agent. Today the main agent can only ask about or resolve an
item that is already persisted, so a gap discovered while reading code cannot
enter the Agenda.

## Architecture

Add `add_refinement_item` as a first-class agent tool with one validated input:
`{ question: string }`. The runtime emits a typed pending submission. The
ceremony accepts it only while the session is `refinando`. The store owns item
identity and atomically allocates the next `agente-N` ID, persists an open item,
and increments the refinement revision.

The successful tool response returns the generated ID. The agent then uses the
existing `ask_operator` or `resolve_refinement_item` tool to progress that item.
Creation remains separate from asking and resolution so factual discoveries and
room choices follow the same explicit Agenda lifecycle.

## Data flow

1. Ceremony instructions tell the agent to call `add_refinement_item` when code
   exploration reveals an untracked gap.
2. The runtime validates a non-empty `question` at the tool boundary and emits
   an Agenda-item submission.
3. The ceremony passes the question to the store.
4. The store creates `agente-N` transactionally and returns the persisted item.
5. The ceremony responds `Item agente-N criado na Agenda.`, marks the turn as
   progressed, and refreshes Palco and Dossiê through the existing change hook.

## Errors

Invalid arguments are rejected by the runtime schema. Domain failures, such as
creation outside `refinando`, return an actionable rejection. Unexpected
persistence failures return a stable message and propagate to the ceremony's
existing monitored failure path without leaking internal details. A failed call
must not leave a partial item.

## Testing

Public-contract tests prove that:

- the runtime accepts `add_refinement_item` and emits the typed event;
- an agent turn creates `agente-1`, observable through `Ceremony.palco`;
- the returned ID works immediately with existing question and resolution paths;
- creation is rejected outside `refinando`;
- invalid input and unexpected persistence failures use the established error
  boundary.

## Scope

This change adds no dependency, database migration, UI control, source column,
or retry token. Tool calls are serialized by the active turn, and the persisted
`agente-N` identity is sufficient for the current workflow.
