import { Writable } from "node:stream";
import { createLogger } from "@sprint-griller/core";
import { describe, expect, it, vi } from "vitest";
import { dumpAuditMarker } from "../refinement/dump-marker";
import { INVESTIGATION_MARKER } from "../refinement/refinement-status";
import { fetchSprintMetrics } from "./sprint-metrics";

const AZURE_DEVOPS = { organization: "acme", project: "Plataforma" };
const CREDENTIALS = { pat: "pat-de-teste" };
const logger = createLogger({
  level: "fatal",
  destination: new Writable({ write(_chunk, _encoding, done) { done(); } }),
});

function json(body: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
  });
}

function fakeAdo(paginateComments = false) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/_apis/work/teamsettings/iterations")) {
      return json({ value: [{
        name: "Sprint 41",
        path: "Plataforma\\Sprint 41",
        attributes: {
          startDate: "2026-01-19T00:00:00Z",
          finishDate: "2026-01-30T00:00:00Z",
        },
      }] });
    }
    if (url.includes("workitemtypecategories")) return json({ workItemTypes: [{ name: "User Story" }] });
    if (url.includes("workitemtypes/User%20Story/states")) {
      return json({ value: [
        { name: "Closed", category: "Completed" },
        { name: "Active", category: "InProgress" },
        { name: "Removed", category: "Removed" },
      ] });
    }
    if (url.includes("/_apis/wit/wiql")) return json({ workItems: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    if (url.includes("/_apis/wit/workitemsbatch")) {
      return json({ value: [
        { id: 1, fields: { "System.State": "Closed", "System.WorkItemType": "User Story", "System.Title": "Exportar CSV" } },
        { id: 2, fields: { "System.State": "Active", "System.WorkItemType": "User Story", "System.Title": "Auditar acesso" } },
        { id: 3, fields: { "System.State": "Removed", "System.WorkItemType": "User Story", "System.Title": "Cancelar legado" } },
      ] });
    }
    const comments = /workItems\/(\d+)\/comments/.exec(url)?.[1];
    if (comments === "1") {
      if (paginateComments && !url.includes("continuationToken=next")) {
        return json({ comments: [{
          text: INVESTIGATION_MARKER,
          createdDate: "2026-01-20T10:00:00Z",
        }] }, { "x-ms-continuationtoken": "next" });
      }
      return json({ comments: [
        ...(paginateComments ? [] : [{
          text: INVESTIGATION_MARKER,
          createdDate: "2026-01-20T10:00:00Z",
        }]),
        { text: dumpAuditMarker("dump-1", 0), createdDate: "2026-01-21T10:00:00Z" },
      ] });
    }
    if (comments === "2") {
      return json({ comments: [
        { text: dumpAuditMarker("dump-2", 2), createdDate: "2026-01-22T10:00:00Z" },
        { text: INVESTIGATION_MARKER, createdDate: "2026-02-01T10:00:00Z" },
      ] });
    }
    throw new Error(`rota inesperada: ${url} ${init?.method ?? "GET"}`);
  }) as unknown as typeof globalThis.fetch;
}

describe("fetchSprintMetrics", () => {
  it("should credit only investigations and dump audits recorded before the sprint closes", async () => {
    const metrics = await fetchSprintMetrics({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      fetch: fakeAdo(),
      logger,
      now: new Date("2026-03-02T00:00:00Z"),
    });

    expect(metrics).toMatchObject({
      coverage: { scope: 2, refined: 1, rate: 0.5 },
      sprints: [{
        name: "Sprint 41",
        rollover: { scope: 2, completed: 1, rolled: 1, removed: 1, rate: 0.5 },
        doubts: [
          { id: 1, title: "Exportar CSV", openQuestions: 0, rolled: false },
          { id: 2, title: "Auditar acesso", openQuestions: 2, rolled: true },
        ],
      }],
    });
  });

  it("should follow Azure DevOps comment continuation headers", async () => {
    const metrics = await fetchSprintMetrics({
      azureDevOps: AZURE_DEVOPS,
      credentials: CREDENTIALS,
      fetch: fakeAdo(true),
      logger,
      now: new Date("2026-03-02T00:00:00Z"),
    });

    expect(metrics.coverage).toEqual({ scope: 2, refined: 1, rate: 0.5 });
  });
});
