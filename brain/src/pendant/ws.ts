// The link to the pendant. Plain ws:// on the LAN for the demo; the VPS path puts Caddy
// with TLS in front (wss://). One pendant at a time: the newest socket wins.
import { EventEmitter } from "node:events";
import { WebSocketServer, WebSocket } from "ws";
import type { Proposal } from "../engine/proposal.js";

export type DecisionResult = "approved" | "rejected" | "policy_reject" | "expired";
export interface Decision { type: "decision"; id: string; result: DecisionResult; txHash?: string; signature?: `0x${string}` }
export interface Presence { type: "presence"; uptime?: number; worn?: boolean; policyVersion?: number; address?: string }
export type BrainState = "watching" | "proposing" | "stale" | "offline";

// The one message the wearer starts. Everything else on this socket is the brain talking.
export interface Ask { type: "ask"; kind: "swap" | "portfolio"; from?: string; to?: string; amount?: string }

export interface Pick { type: "pick"; id: string; idx: number }
export interface Dismiss { type: "dismiss"; id: string }
export type PickResult = { kind: "pick"; idx: number } | { kind: "dismiss" } | { kind: "expired" };

export interface PendantEvents {
  connected: [];
  disconnected: [];
  decision: [Decision];
  presence: [Presence];
  pick: [Pick | Dismiss];
  ask: [Ask];
}

export class PendantLink extends EventEmitter<PendantEvents> {
  private wss?: WebSocketServer;
  private sock?: WebSocket;
  private state: BrainState = "watching";

  listen(port: number, host = "0.0.0.0"): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port, host });
      this.wss.on("listening", () => resolve());
      this.wss.on("error", reject);
      this.wss.on("connection", (ws, req) => {
        if (this.sock && this.sock !== ws && this.sock.readyState === WebSocket.OPEN) this.sock.close(1000, "replaced");
        this.sock = ws;
        this.emit("connected");
        this.send({ type: "status", state: this.state });
        ws.on("message", (buf) => this.onMessage(buf.toString()));
        ws.on("close", () => { if (this.sock === ws) { this.sock = undefined; this.emit("disconnected"); } });
        ws.on("error", () => { /* close follows */ });
        void req;
      });
    });
  }

  get connected(): boolean { return this.sock?.readyState === WebSocket.OPEN; }

  setState(s: BrainState): void {
    if (s === this.state) return;
    this.state = s;
    this.send({ type: "status", state: s });
  }

  push(p: Proposal): boolean { return this.send(p); }

  send(obj: unknown): boolean {
    if (!this.connected || !this.sock) return false;
    this.sock.send(JSON.stringify(obj));
    return true;
  }

  // Resolves with the pendant's decision for `id`, or "expired" when it never answers.
  awaitDecision(id: string, timeoutMs: number): Promise<Decision> {
    return new Promise((resolve) => {
      const onDecision = (d: Decision) => { if (d.id === id) { cleanup(); resolve(d); } };
      const timer = setTimeout(() => { cleanup(); resolve({ type: "decision", id, result: "expired" }); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.off("decision", onDecision); };
      this.on("decision", onDecision);
    });
  }

  // Resolves with the row the wearer tapped on an options card, a dismiss, or "expired".
  awaitPick(id: string, timeoutMs: number): Promise<PickResult> {
    return new Promise((resolve) => {
      const onPick = (m: Pick | Dismiss) => {
        if (m.id !== id) return;
        cleanup();
        resolve(m.type === "pick" ? { kind: "pick", idx: Number(m.idx) } : { kind: "dismiss" });
      };
      const timer = setTimeout(() => { cleanup(); resolve({ kind: "expired" }); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.off("pick", onPick); };
      this.on("pick", onPick);
    });
  }

  close(): void {
    this.sock?.close(1000, "bye");
    this.wss?.close();
  }

  private onMessage(text: string): void {
    let m: { type?: string };
    try { m = JSON.parse(text); } catch { return; }
    if (m.type === "decision") this.emit("decision", m as Decision);
    else if (m.type === "presence") this.emit("presence", m as Presence);
    else if (m.type === "pick" || m.type === "dismiss") this.emit("pick", m as Pick | Dismiss);
    else if (m.type === "ask") this.emit("ask", m as Ask);
  }
}
