import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// MCP job tools — hermetic: GALCODE_MCP_DIR redirects job state to tmp before
// the server module is imported; no galcode child is actually spawned (we test
// validation and status/cancel semantics, not the record pipeline itself).

let tmp;
let server;

beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "galcode-mcp-jobs-"));
  process.env.GALCODE_MCP_DIR = path.join(tmp, "mcp");
  server = await import("../src/mcp/server.mjs");
});

beforeEach(async () => {
  await fs.rm(path.join(tmp, "mcp", "jobs"), { recursive: true, force: true });
});

afterEach(async () => {
  // Nothing to kill: no test spawns a real job.
});

describe("galcode_render_video validation", () => {
  it("rejects a non-compiled project directory before spawning anything", async () => {
    await expect(server.renderVideoTool({ projectDir: "outputs" })).rejects.toThrow(/Not a compiled Galcode project/);
  });

  it("rejects an unknown mode", async () => {
    const projectDir = path.join(tmp, "proj");
    await fs.mkdir(path.join(projectDir, "game", "scene"), { recursive: true });
    await fs.writeFile(path.join(projectDir, "game", "scene", "start.txt"), "; x\n");
    // Path must stay inside the repo root; use outputs/ for the positive case.
    await expect(server.renderVideoTool({ projectDir: "outputs", mode: "bogus" })).rejects.toThrow(/Unknown mode/);
  });

  it("rejects missing projectDir", async () => {
    await expect(server.renderVideoTool({})).rejects.toThrow(/projectDir/);
  });
});

describe("galcode_job_status / galcode_cancel_job", () => {
  it("status reads a persisted job file; unknown ids throw", async () => {
    await expect(server.jobStatusTool({ jobId: "record-nope" })).rejects.toThrow(/Unknown job/);

    const jobsDir = path.join(tmp, "mcp", "jobs");
    await fs.mkdir(jobsDir, { recursive: true });
    const job = {
      id: "record-test-1",
      type: "record",
      status: "completed",
      projectDir: "/x",
      videoOut: "/x/final.mp4",
      producedVideo: true,
      exitCode: 0,
      startedAt: "2026-10-14T00:00:00.000Z",
      finishedAt: "2026-10-14T00:01:00.000Z",
      logPath: path.join(jobsDir, "record-test-1.log")
    };
    await fs.writeFile(path.join(jobsDir, "record-test-1.json"), JSON.stringify(job));
    const status = await server.jobStatusTool({ jobId: "record-test-1" });
    expect(status).toMatchObject({
      jobId: "record-test-1",
      type: "record",
      status: "completed",
      active: false,
      producedVideo: true,
      exitCode: 0
    });
  });

  it("status marks a stale running job as inactive when its pid is gone", async () => {
    const jobsDir = path.join(tmp, "mcp", "jobs");
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, "record-stale.json"), JSON.stringify({
      id: "record-stale",
      type: "record",
      status: "running",
      pid: 4194303, // implausible pid — nothing should own it
      projectDir: "/x",
      logPath: path.join(jobsDir, "record-stale.log"),
      startedAt: "2026-10-14T00:00:00.000Z"
    }));
    const status = await server.jobStatusTool({ jobId: "record-stale" });
    expect(status.status).toBe("running");
    expect(status.active).toBe(false);
  });

  it("cancel reports not-active for jobs not in this process", async () => {
    const jobsDir = path.join(tmp, "mcp", "jobs");
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, "record-done.json"), JSON.stringify({
      id: "record-done",
      type: "record",
      status: "completed",
      logPath: path.join(jobsDir, "record-done.log")
    }));
    const result = await server.cancelJobTool({ jobId: "record-done" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not active/);
    await expect(server.cancelJobTool({ jobId: "missing" })).rejects.toThrow(/Unknown job/);
  });
});
