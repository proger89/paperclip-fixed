import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { hostRuntimeServe } from "../commands/host-runtime.ts";

async function allocatePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  if (!address || typeof address === "string") {
    throw new Error("Could not allocate port.");
  }
  return address.port;
}

afterEach(() => {
  delete process.env.PAPERCLIP_HOST_BRIDGE_TOKEN;
});

describe("host-runtime serve", () => {
  it("requires auth for health and reports configured capabilities", async () => {
    const port = await allocatePort();
    const server = await hostRuntimeServe({
      listen: `127.0.0.1:${port}`,
      token: "bridge-token",
      capability: ["codex", "browser"],
      pathMap: ["/workspace=/srv/repo"],
    });

    const unauthorized = await fetch(`http://127.0.0.1:${port}/health`);
    const authorized = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: {
        authorization: "Bearer bridge-token",
      },
    });
    const body = await authorized.json() as Record<string, unknown>;

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

    expect(unauthorized.status).toBe(401);
    expect(body).toMatchObject({
      ok: true,
      capabilities: {
        codex: true,
        claude: false,
        browser: true,
      },
      pathMaps: [
        {
          containerPath: "/workspace",
          hostPath: "/srv/repo",
        },
      ],
    });
  });
});
