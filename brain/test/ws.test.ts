import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { PendantLink } from "../src/pendant/ws.js";

// A public hostname means anyone can knock. These prove the door is shut without the token and
// open with it, because nothing else on this socket asks who is calling.
async function withLink(token: string | undefined, fn: (port: number) => Promise<void>): Promise<void> {
  const link = new PendantLink();
  const port = 18900 + Math.floor(Math.random() * 400);
  await link.listen(port, "127.0.0.1", token);
  try { await fn(port); } finally { link.close(); }
}

function connect(url: string, headers?: Record<string, string>): Promise<"open" | "refused"> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    const done = (r: "open" | "refused") => { try { ws.close(); } catch { /* already gone */ } resolve(r); };
    ws.on("open", () => done("open"));
    ws.on("close", (code) => { if (code === 1008) done("refused"); });
    ws.on("error", () => done("refused"));
    setTimeout(() => done("refused"), 3000);
  });
}

describe("who may talk to the agent", () => {
  it("lets anyone in when no token is set, as on a home network", async () => {
    await withLink(undefined, async (p) => {
      expect(await connect(`ws://127.0.0.1:${p}/`)).toBe("open");
    });
  });

  it("refuses a caller with no token", async () => {
    await withLink("s3cret", async (p) => {
      expect(await connect(`ws://127.0.0.1:${p}/`)).toBe("refused");
    });
  });

  it("refuses a caller with the wrong token", async () => {
    await withLink("s3cret", async (p) => {
      expect(await connect(`ws://127.0.0.1:${p}/guessing`)).toBe("refused");
    });
  });

  it("lets the token through in the path, which is what the pendant sends", async () => {
    await withLink("s3cret", async (p) => {
      expect(await connect(`ws://127.0.0.1:${p}/s3cret`)).toBe("open");
    });
  });

  it("lets the token through in a header too", async () => {
    await withLink("s3cret", async (p) => {
      expect(await connect(`ws://127.0.0.1:${p}/`, { "x-amulet-token": "s3cret" })).toBe("open");
    });
  });
});
