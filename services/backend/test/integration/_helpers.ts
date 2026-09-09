import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_DIR = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const GATEWAY_DIR = path.resolve(BACKEND_DIR, "../game-gateway");

async function pickPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a test port."));
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url: string, expected: number[], logs: string[]): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (expected.includes(response.status)) return;
    } catch {
      // The worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Worker did not start: ${url}\n${logs.slice(-50).join("")}`);
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (process.exitCode === null) process.kill("SIGKILL");
}

function runWrangler(cwd: string, args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", CI: "1" },
    encoding: "utf8",
    timeout: 120_000,
  });
}

function startWrangler(cwd: string, args: string[], logs: string[]): ChildProcess {
  const child = spawn("npx", ["wrangler", ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => logs.push(chunk.toString()));
  return child;
}

export interface LocalStack {
  backendUrl: string;
  gatewayUrl: string;
  logs: string[];
  executeSql(sql: string): string;
  scheduled(): Promise<Response>;
  cleanup(): Promise<void>;
}

export async function startLocalStack(): Promise<LocalStack> {
  const persistDir = await mkdtemp(path.join(os.tmpdir(), "blitz-games-test-"));
  const backendPort = await pickPort();
  const gatewayPort = await pickPort();
  const logs: string[] = [];

  runWrangler(BACKEND_DIR, [
    "d1", "migrations", "apply", "blitz-games-platform-db",
    "--local", "--persist-to", persistDir,
  ]);

  const gateway = startWrangler(GATEWAY_DIR, [
    "dev", "--local", "--ip", "127.0.0.1", "--port", String(gatewayPort),
    "--persist-to", persistDir,
  ], logs);
  const backend = startWrangler(BACKEND_DIR, [
    "dev", "--local", "--test-scheduled", "--ip", "127.0.0.1", "--port", String(backendPort),
    "--persist-to", persistDir,
    "--var", "PLATFORM_AUTH_JWT_SECRET:integration-jwt-secret-with-at-least-32-bytes",
    "--var", `GATEWAY_ORIGIN:http://127.0.0.1:${gatewayPort}`,
  ], logs);

  const backendUrl = `http://127.0.0.1:${backendPort}`;
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  try {
    await Promise.all([
      waitFor(`${backendUrl}/health`, [200], logs),
      waitFor(gatewayUrl, [404], logs),
    ]);
  } catch (error) {
    await Promise.all([stop(backend), stop(gateway)]);
    await rm(persistDir, { recursive: true, force: true });
    throw error;
  }

  return {
    backendUrl,
    gatewayUrl,
    logs,
    executeSql(sql: string): string {
      return runWrangler(BACKEND_DIR, [
        "d1", "execute", "blitz-games-platform-db", "--local",
        "--persist-to", persistDir, "--command", sql,
      ]);
    },
    scheduled(): Promise<Response> {
      return fetch(`${backendUrl}/__scheduled?cron=*+*+*+*+*`);
    },
    async cleanup(): Promise<void> {
      await Promise.all([stop(backend), stop(gateway)]);
      await rm(persistDir, { recursive: true, force: true });
    },
  };
}
