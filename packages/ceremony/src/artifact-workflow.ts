import { createHash } from "node:crypto";
import {
  refinementSpecSubmissionSchema,
  refinementTicketsSubmissionSchema,
} from "@sprint-griller/agent-runtime";
import type {
  RefinementSpecSubmission,
  RefinementTicketsSubmission,
} from "@sprint-griller/agent-runtime";

export interface ArtifactApproval {
  readonly revision: number;
  readonly hash: string;
  readonly markdown: string;
  readonly approvedAt: number;
}

export interface SpecArtifact {
  readonly revision: number;
  readonly submission: RefinementSpecSubmission;
  readonly markdown: string;
  readonly submittedAt: number;
  readonly approval: ArtifactApproval | null;
}

export interface TicketArtifact {
  readonly revision: number;
  readonly submission: RefinementTicketsSubmission;
  readonly markdown: string;
  readonly submittedAt: number;
  readonly specRevision: number;
  readonly specHash: string;
  readonly approval: (ArtifactApproval & {
    readonly specRevision: number;
    readonly specHash: string;
  }) | null;
}

export interface RefinementArtifactState {
  readonly spec: SpecArtifact | null;
  readonly tickets: TicketArtifact | null;
}

export interface ApprovedRefinementArtifacts {
  readonly spec: ArtifactApproval;
  readonly tickets: NonNullable<TicketArtifact["approval"]>;
}

export function artifactHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

export function parseStoredSpecSubmission(value: string): RefinementSpecSubmission {
  return refinementSpecSubmissionSchema.parse(JSON.parse(value));
}

export function parseStoredTicketsSubmission(value: string): RefinementTicketsSubmission {
  return refinementTicketsSubmissionSchema.parse(JSON.parse(value));
}
