import { Writable } from "node:stream";
import { AdoError } from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import type { InvestigationOutcome } from "@sprint-griller/investigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchStory = vi.hoisted(() => vi.fn());
const publishToAdo = vi.hoisted(() => vi.fn());
const createAgentRuntime = vi.hoisted(() => vi.fn());
const runInvestigation = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/ado-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/ado-client")>()),
  fetchStory,
  publishInvestigation: publishToAdo,
}));
vi.mock("@sprint-griller/agent-runtime", () => ({ createAgentRuntime }));
vi.mock("@sprint-griller/investigation", () => ({ runInvestigation }));
vi.mock("./squad-config", () => ({
  getSquadConfig: () => ({
    azureDevOps: { organization: "acme", project: "Plataforma" },
    repos: { primary: { name: "core-api", path: "/dev/core-api" }, related: [] },
  }),
}));
vi.mock("./logger", () => ({
  logger: createLogger({
    destination: new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    }),
    level: "fatal",
  }),
}));

vi.stubEnv("AZURE_DEVOPS_PAT", "pat-de-teste");

const { getInvestigation, publishInvestigation, startInvestigation } =
  await import("./investigations");

const STORY = {
  id: 1,
  title: "TTL de sessão configurável",
  type: "User Story",
  state: "New",
  description: "O TTL hoje é fixo.",
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
};

const APPROVED_MARKDOWN = "# Investigação\n";

const APPROVED: InvestigationOutcome = {
  status: "aprovado",
  report: {
    summary: "resumo",
    gaps: [],
    impacts: [],
    externalRepos: [],
    unverified: [],
  },
  markdown: APPROVED_MARKDOWN,
};

const close = vi.fn(async () => undefined);

/** Cada teste usa uma US própria: o registro vive no processo, como em produção. */
let nextStoryId = 1;

beforeEach(() => {
  vi.clearAllMocks();
  nextStoryId += 1;
  fetchStory.mockResolvedValue({ ...STORY, id: nextStoryId });
  createAgentRuntime.mockResolvedValue({ close });
  runInvestigation.mockResolvedValue(APPROVED);
  publishToAdo.mockImplementation(
    async (_options: unknown, { storyId }: { storyId: number }) => ({
      storyId,
      commentId: 77,
      url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
    }),
  );
});

describe("startInvestigation", () => {
  it("should return before the agent turn finishes so the operator can walk away", () => {
    const run = startInvestigation(nextStoryId);

    expect(run.status).toBe("em-andamento");
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("should keep the approved report for whoever comes back to look", async () => {
    startInvestigation(nextStoryId);

    await vi.waitFor(() =>
      expect(getInvestigation(nextStoryId)).toMatchObject({
        status: "aprovado",
        story: { title: STORY.title },
      }),
    );
    expect(close).toHaveBeenCalled();
  });

  it("should not start a second turn while the first one is still running", async () => {
    const first = startInvestigation(nextStoryId);
    const second = startInvestigation(nextStoryId);

    expect(second).toBe(first);
    await vi.waitFor(() =>
      expect(getInvestigation(nextStoryId)?.status).toBe("aprovado"),
    );
    expect(createAgentRuntime).toHaveBeenCalledTimes(1);
  });

  it("should record an ADO failure as a failed run instead of hanging", async () => {
    fetchStory.mockRejectedValue(new AdoError("not-found", "A US #99 não existe."));

    startInvestigation(nextStoryId);

    await vi.waitFor(() =>
      expect(getInvestigation(nextStoryId)).toMatchObject({
        status: "falhou",
        message: "A US #99 não existe.",
      }),
    );
    expect(createAgentRuntime).not.toHaveBeenCalled();
  });

  it("should record an unexpected crash as a failed run", async () => {
    createAgentRuntime.mockRejectedValue(new Error("codex não está no PATH"));

    startInvestigation(nextStoryId);

    await vi.waitFor(() =>
      expect(getInvestigation(nextStoryId)?.status).toBe("falhou"),
    );
  });
});

/** Uma US que já tem relatório na mão — o ponto de partida de publicar. */
async function investigated(): Promise<number> {
  const storyId = nextStoryId;
  startInvestigation(storyId);
  await vi.waitFor(() =>
    expect(getInvestigation(storyId)?.status).toBe("aprovado"),
  );
  return storyId;
}

describe("redisparo", () => {
  it("should keep the previous report on screen while the new turn runs", async () => {
    const storyId = await investigated();

    const rerun = startInvestigation(storyId);

    expect(rerun).toMatchObject({
      status: "em-andamento",
      previous: { status: "aprovado", markdown: APPROVED_MARKDOWN },
      story: { title: STORY.title },
    });
  });

  it("should keep the previous report when the new turn fails", async () => {
    const storyId = await investigated();
    runInvestigation.mockResolvedValue({
      status: "falhou",
      message: "o agente caiu no meio do turno",
    } satisfies InvestigationOutcome);

    startInvestigation(storyId);

    await vi.waitFor(() =>
      expect(getInvestigation(storyId)).toMatchObject({
        status: "falhou",
        previous: { status: "aprovado", markdown: APPROVED_MARKDOWN },
      }),
    );
  });

  it("should drop the previous report once a new one lands", async () => {
    const storyId = await investigated();
    runInvestigation.mockResolvedValue({
      ...APPROVED,
      markdown: "# Investigação — segunda tentativa\n",
    } satisfies InvestigationOutcome);

    startInvestigation(storyId);

    await vi.waitFor(() =>
      expect(getInvestigation(storyId)).toMatchObject({
        markdown: "# Investigação — segunda tentativa\n",
        previous: undefined,
      }),
    );
  });

  it("should not stack previous reports across repeated failures", async () => {
    const storyId = await investigated();
    runInvestigation.mockResolvedValue({
      status: "falhou",
      message: "o agente caiu de novo",
    } satisfies InvestigationOutcome);

    startInvestigation(storyId);
    await vi.waitFor(() =>
      expect(getInvestigation(storyId)?.status).toBe("falhou"),
    );
    startInvestigation(storyId);
    await vi.waitFor(() =>
      expect(getInvestigation(storyId)?.status).toBe("falhou"),
    );

    const run = getInvestigation(storyId);
    expect(run?.previous).toMatchObject({
      status: "aprovado",
      markdown: APPROVED_MARKDOWN,
      previous: undefined,
    });
  });
});

describe("publishInvestigation", () => {
  it("should write the approved report to the US and record where it landed", async () => {
    const storyId = await investigated();

    const publication = await publishInvestigation(storyId);

    expect(publishToAdo).toHaveBeenCalledWith(expect.anything(), {
      storyId,
      markdown: APPROVED_MARKDOWN,
    });
    expect(publication).toEqual({
      status: "publicada",
      commentId: 77,
      url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
    });
    expect(getInvestigation(storyId)?.publication).toEqual(publication);
  });

  it("should refuse to publish a report that failed the citation check", async () => {
    runInvestigation.mockResolvedValue({
      status: "reprovado",
      report: APPROVED.report,
      markdown: "# Investigação reprovada\n",
      violations: [
        {
          claim: "o cache expira em 5 minutos",
          citation: { repo: "core-api", path: "src/sumiu.ts" },
          reason: "caminho-inexistente",
          detail: "core-api/src/sumiu.ts não existe no repo",
        },
      ],
    } satisfies InvestigationOutcome);
    const storyId = nextStoryId;
    startInvestigation(storyId);
    await vi.waitFor(() =>
      expect(getInvestigation(storyId)?.status).toBe("reprovado"),
    );

    const publication = await publishInvestigation(storyId);

    expect(publication.status).toBe("falhou");
    expect(publishToAdo).not.toHaveBeenCalled();
  });

  it("should refuse to publish a US that was never investigated on this machine", async () => {
    const publication = await publishInvestigation(9999);

    expect(publication.status).toBe("falhou");
    expect(publishToAdo).not.toHaveBeenCalled();
  });

  it("should not write a second comment when the operator clicks publish twice", async () => {
    const storyId = await investigated();

    const first = await publishInvestigation(storyId);
    const second = await publishInvestigation(storyId);

    expect(second).toEqual(first);
    expect(publishToAdo).toHaveBeenCalledTimes(1);
  });

  it("should share one write when two publish requests arrive together", async () => {
    const storyId = await investigated();
    let resolvePublish: (() => void) | undefined;
    publishToAdo.mockReturnValue(
      new Promise((resolve) => {
        resolvePublish = () =>
          resolve({
            commentId: 77,
            url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
          });
      }),
    );

    const first = publishInvestigation(storyId);
    const second = publishInvestigation(storyId);

    expect(publishToAdo).toHaveBeenCalledTimes(1);
    resolvePublish?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("should keep the ADO error on screen instead of claiming the US was updated", async () => {
    const storyId = await investigated();
    publishToAdo.mockRejectedValue(
      new AdoError("auth", "O Azure DevOps recusou a credencial."),
    );

    const publication = await publishInvestigation(storyId);

    expect(publication).toEqual({
      status: "falhou",
      message: "O Azure DevOps recusou a credencial.",
    });
    expect(getInvestigation(storyId)?.publication).toEqual(publication);
  });

  it("should let the operator retry after a confirmed failed publication", async () => {
    const storyId = await investigated();
    publishToAdo.mockRejectedValueOnce(new AdoError("auth", "sem permissão"));

    await publishInvestigation(storyId);
    const retry = await publishInvestigation(storyId);

    expect(retry.status).toBe("publicada");
  });

  it("should keep an uncertain publication from being retried", async () => {
    const storyId = await investigated();
    publishToAdo.mockRejectedValueOnce(new AdoError("connection", "sem rede"));

    const first = await publishInvestigation(storyId);
    const second = await publishInvestigation(storyId);

    expect(first).toEqual({ status: "incerta", message: "sem rede" });
    expect(second).toEqual(first);
    expect(publishToAdo).toHaveBeenCalledTimes(1);
  });

  it("should treat a write-side 5xx as uncertain, not a safe retry", async () => {
    const storyId = await investigated();
    publishToAdo.mockRejectedValueOnce(
      new AdoError(
        "unexpected-response",
        "O Azure DevOps falhou (HTTP 500) — Confira a US antes de tentar de novo.",
      ),
    );

    const publication = await publishInvestigation(storyId);

    expect(publication.status).toBe("incerta");
    expect(getInvestigation(storyId)?.publication).toEqual(publication);
  });

  it("should not stamp the publication on a report a rerun already replaced", async () => {
    const storyId = await investigated();
    let landed: () => void = () => undefined;
    publishToAdo.mockReturnValue(
      new Promise((resolve) => {
        landed = () =>
          resolve({ storyId, commentId: 77, url: "https://dev.azure.com/x" });
      }),
    );

    // O turno novo fica preso lendo a US, para o run em curso não sair de
    // `em-andamento` no meio da asserção.
    fetchStory.mockReturnValue(new Promise(() => undefined));

    const publishing = publishInvestigation(storyId);
    startInvestigation(storyId);
    landed();
    await publishing;

    expect(getInvestigation(storyId)).toMatchObject({
      status: "em-andamento",
      publication: undefined,
    });
  });

  it("should publish the new report even if the previous one's write is still in flight", async () => {
    const storyId = await investigated();
    const firstMarkdown = APPROVED_MARKDOWN;
    const secondMarkdown = "# Investigação — segunda tentativa\n";
    let resolveFirst: (() => void) | undefined;
    publishToAdo.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = () =>
            resolve({
              storyId,
              commentId: 77,
              url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
            });
        }),
    );
    publishToAdo.mockImplementationOnce(
      async (_options: unknown, { storyId: id }: { storyId: number }) => ({
        storyId: id,
        commentId: 88,
        url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${id}`,
      }),
    );

    const publishingFirst = publishInvestigation(storyId);
    runInvestigation.mockResolvedValue({
      ...APPROVED,
      markdown: secondMarkdown,
    } satisfies InvestigationOutcome);
    startInvestigation(storyId);
    await vi.waitFor(() =>
      expect(getInvestigation(storyId)).toMatchObject({
        status: "aprovado",
        markdown: secondMarkdown,
      }),
    );

    const second = await publishInvestigation(storyId);
    resolveFirst?.();
    await publishingFirst;

    expect(publishToAdo).toHaveBeenCalledTimes(2);
    expect(publishToAdo).toHaveBeenNthCalledWith(1, expect.anything(), {
      storyId,
      markdown: firstMarkdown,
    });
    expect(publishToAdo).toHaveBeenNthCalledWith(2, expect.anything(), {
      storyId,
      markdown: secondMarkdown,
    });
    expect(second).toEqual({
      status: "publicada",
      commentId: 88,
      url: `https://dev.azure.com/acme/Plataforma/_workitems/edit/${storyId}`,
    });
    expect(getInvestigation(storyId)?.publication).toEqual(second);
  });
});
