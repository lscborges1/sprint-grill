# Agent-originated Agenda items

## Problem

The Refina design says the Agenda contains every gap found by the Investigation,
the room, and the agent. Today the main agent can only ask about or resolve an
item that is already persisted, so a gap discovered while reading code cannot
enter the Agenda.

## Architecture

Add `add_refinement_item` as a first-class agent tool with one validated input:
`{ question: string }`. The runtime trims the question and rejects blank text.
It emits an `AgentEvent` whose discriminant is `agenda-item-submission` and whose
payload is `PendingAgentSubmission<AddRefinementItemSubmission>`.

The ceremony handles that event and calls the store contract
`addAgentRefinementItem(sessionId, question): RefinementItem`. The store owns
item identity and atomically allocates the next `agente-N` ID, persists an open
item, and increments the refinement revision.

Within the session transaction, `N` is one greater than the maximum numeric
suffix among existing IDs that exactly match `agente-N`; unrelated IDs do not
participate. The unique session/item index remains the final collision guard.
Any collision or later transaction failure rolls back the entire operation.

The successful tool response returns the generated ID. The agent then uses the
existing `ask_operator` or `resolve_refinement_item` tool to progress that item.
Creation remains separate from asking and resolution so factual discoveries and
room choices follow the same explicit Agenda lifecycle.

## Data flow

1. Ceremony instructions tell the agent to call `add_refinement_item` when code
   exploration reveals an untracked gap.
2. The runtime validates a non-empty `question` at the tool boundary and emits
   an Agenda-item submission.
3. The ceremony passes the trimmed question to the store.
4. The store creates `agente-N` transactionally and returns the persisted item.
5. If the session is awaiting confirmation, reviewing an artifact, or ready to
   publish, that same transaction first reopens `refinando`, clears the
   completion proposal, and invalidates downstream approvals. This is the same
   late-doubt invariant used by the room flow. Published or closed sessions
   reject creation.
6. The ceremony responds `Item agente-N criado na Agenda. Use esse ID para
   perguntar ou resolver o furo.`, marks the turn as progressed, and refreshes
   Palco and Dossiê through the existing change hook.

## Errors

The runtime schema and store both trim the question and reject a blank value.
Domain failures, such as creation in a published or closed session, return an
actionable rejection. Unexpected persistence failures respond `Não foi possível
adicionar o item à Agenda. Tente novamente.` and propagate to the ceremony's
existing monitored failure path without leaking internal details. A rejected or
failed call leaves no partial item, phase transition, or approval invalidation.

## Testing

Public-contract tests prove that:

- the runtime accepts `add_refinement_item` and emits the typed event;
- an agent turn creates `agente-1`, observable through `Ceremony.palco`;
- the returned ID works immediately with existing question and resolution paths;
- consecutive calls allocate consecutive IDs while unrelated item IDs are
  ignored by allocation;
- a late item atomically reopens refinement and invalidates approved artifacts;
- transaction failures roll back both creation and reopening;
- creation is rejected after publication or closure;
- invalid input and unexpected persistence failures use the established error
  boundary.

## Scope

This change adds no dependency, database migration, UI control, source column,
or retry token. Tool calls are serialized by the active turn, and the persisted
`agente-N` identity is sufficient for the current workflow.
