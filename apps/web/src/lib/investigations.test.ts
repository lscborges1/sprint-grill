import { Writable } from "node:stream";
import { AdoError } from "@sprint-griller/ado-client";
import { createLogger } from "@sprint-griller/core";
import type { InvestigationOutcome } from "@sprint-griller/investigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchStory = vi.hoisted(() => vi.fn());
const createAgentRuntime = vi.hoisted(() => vi.fn());
const runInvestigation = vi.hoisted(() => vi.fn());

vi.mock("@sprint-griller/ado-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sprint-griller/ado-client")>()),
  fetchStory,
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

process.env["AZURE_DEVOPS_PAT"] = "pat-de-teste";

const { getInvestigation, startInvestigation } = await import("./investigations");

const STORY = {
  id: 1,
  title: "TTL de sessão configurável",
  type: "User Story",
  state: "New",
  description: "O TTL hoje é fixo.",
  url: "https://dev.azure.com/acme/Plataforma/_workitems/edit/1",
};

const APPROVED: InvestigationOutcome = {
  status: "aprovado",
  report: {
    summary: "resumo",
    gaps: [],
    impacts: [],
    externalRepos: [],
    unverified: [],
  },
  markdown: "# Investigação\n",
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
