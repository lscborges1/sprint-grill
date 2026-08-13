import { z } from "zod";
import { dumpAudits } from "../refinement/dump-marker";
import { INVESTIGATION_MARKER } from "../refinement/refinement-status";
import { COMMENTS_API_VERSION, createAdoRest } from "../rest/ado-rest";
import type { AdoRest } from "../rest/ado-rest";
import { fetchRolloverBaseline } from "./rollover";
import type { RolloverCounts, RolloverBaselineOptions } from "./rollover";

export interface RefinementCoverage {
  readonly scope: number;
  readonly refined: number;
  readonly rate: number | undefined;
}

export interface DumpDoubt {
  readonly id: number;
  readonly title: string;
  readonly openQuestions: number;
  readonly rolled: boolean;
}

export interface SprintMetrics {
  readonly name: string;
  readonly finishDate: Date;
  readonly rollover: RolloverCounts;
  readonly coverage: RefinementCoverage;
  /** Só US que chegaram ao despejo antes do fechamento da sprint. */
  readonly doubts: readonly DumpDoubt[];
}

export interface SprintMetricsReport {
  readonly sprints: readonly SprintMetrics[];
  readonly rollover: RolloverCounts;
  readonly coverage: RefinementCoverage;
}

const commentsSchema = z.object({
  comments: z.array(z.object({
    text: z.string(),
    createdDate: z.iso.datetime({ offset: true }),
  })).default([]),
  continuationToken: z.string().nullable().optional(),
});

/**
 * O trio anti-vaidade por sprint. A rolagem vem das fotos WIQL cruas; cobertura
 * e dúvidas vêm apenas dos comments que o despejo deixou no próprio ADO.
 */
export async function fetchSprintMetrics(
  options: RolloverBaselineOptions,
): Promise<SprintMetricsReport> {
  const rest = createAdoRest(options);
  const baseline = await fetchRolloverBaseline(options);

  const sprints: SprintMetrics[] = [];
  for (const sprint of baseline.sprints) {
    const stories = sprint.stories.filter((story) => story.outcome !== "removed");
    const artifacts = await Promise.all(
      stories.map(async (story) => ({ story, comments: await listComments(rest, story.id) })),
    );
    const doubts: DumpDoubt[] = [];
    let refined = 0;
    for (const { story, comments } of artifacts) {
      const beforeClose = comments.filter(({ createdDate }) =>
        new Date(createdDate).getTime() <= sprint.closesAt.getTime(),
      );
      const audit = beforeClose
        .flatMap((comment) => dumpAudits([comment.text]).map((value) => ({ ...value, createdDate: comment.createdDate })))
        .sort((one, other) => one.createdDate.localeCompare(other.createdDate))
        .at(-1);
      if (audit !== undefined) {
        doubts.push({
          id: story.id,
          title: story.title,
          openQuestions: audit.openQuestions,
          rolled: story.outcome === "rolled",
        });
      }
      if (audit !== undefined && beforeClose.some((comment) => comment.text.includes(INVESTIGATION_MARKER))) {
        refined += 1;
      }
    }
    sprints.push({
      name: sprint.name,
      finishDate: sprint.finishDate,
      rollover: countsOf(sprint),
      coverage: coverageOf(stories.length, refined),
      doubts,
    });
  }

  const coverage = coverageOf(
    sprints.reduce((sum, sprint) => sum + sprint.coverage.scope, 0),
    sprints.reduce((sum, sprint) => sum + sprint.coverage.refined, 0),
  );
  rest.logger.info(
    { sprints: sprints.length, coverage: coverage.rate },
    "trio de métricas por sprint calculado",
  );
  return { sprints, rollover: baseline.total, coverage };
}

function countsOf(sprint: RolloverCounts): RolloverCounts {
  return {
    scope: sprint.scope,
    completed: sprint.completed,
    rolled: sprint.rolled,
    removed: sprint.removed,
    rate: sprint.rate,
  };
}

function coverageOf(scope: number, refined: number): RefinementCoverage {
  return { scope, refined, rate: scope === 0 ? undefined : refined / scope };
}

async function listComments(
  rest: AdoRest,
  storyId: number,
): Promise<readonly z.infer<typeof commentsSchema>["comments"][number][]> {
  const comments: z.infer<typeof commentsSchema>["comments"][number][] = [];
  let continuationToken: string | undefined;
  do {
    const result = await rest.requestWithHeaders({
      operation: `os artefatos de refinamento da US #${storyId}`,
      path: `_apis/wit/workItems/${storyId}/comments`,
      apiVersion: COMMENTS_API_VERSION,
      query: {
        $top: "200",
        order: "asc",
        ...(continuationToken === undefined ? {} : { continuationToken }),
      },
      schema: commentsSchema,
    });
    comments.push(...result.data.comments);
    continuationToken =
      result.headers.get("x-ms-continuationtoken") ??
      result.data.continuationToken ??
      undefined;
  } while (continuationToken !== undefined);
  return comments;
}
