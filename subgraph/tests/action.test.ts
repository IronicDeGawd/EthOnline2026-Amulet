import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { afterEach, assert, clearStore, describe, test } from "matchstick-as/assembly/index";
import { newMockEvent } from "matchstick-as";
import { Action as ActionEvent } from "../generated/AmuletLog/AmuletLog";
import { handleAction } from "../src/mapping";

// The counters here become the agent's own memory, and that memory becomes a line in the
// model's prompt. A miscount does not show up as an error anywhere; it quietly changes what
// the agent proposes next. So every bucket is asserted, and so is the sum.

const SENDER = "0x635dac6c98435579f90567dfc510b646ef1753ca";
const TARGET_A = "0x9a6c374822ada7aaa0590f1ce345a4fd949a467c";
const TARGET_B = "0xaab73d09e659a0f1898e19fbdd294371044dd524";
const SELECTOR = "0x047fc9aa";
const WEI = "10000000000000000"; // 0.01 ETH

// 2026-09-11 12:00 UTC. 20707 days since the epoch; one day later is 20708.
const NOON: i32 = 20707 * 86400 + 43200;

function makeEvent(
  agent: string,
  outcome: i32,
  value: string,
  target: string,
  ts: i32,
  logIndex: i32,
  txHash: string,
): ActionEvent {
  const e = changetype<ActionEvent>(newMockEvent());
  e.parameters = new Array();
  e.parameters.push(new ethereum.EventParam("sender", ethereum.Value.fromAddress(Address.fromString(SENDER))));
  e.parameters.push(new ethereum.EventParam("proposalId", ethereum.Value.fromFixedBytes(
    Bytes.fromHexString("0x" + "11".repeat(32)) as Bytes)));
  e.parameters.push(new ethereum.EventParam("target", ethereum.Value.fromAddress(Address.fromString(target))));
  e.parameters.push(new ethereum.EventParam("agent", ethereum.Value.fromString(agent)));
  e.parameters.push(new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(value))));
  e.parameters.push(new ethereum.EventParam("selector", ethereum.Value.fromFixedBytes(
    Bytes.fromHexString(SELECTOR) as Bytes)));
  e.parameters.push(new ethereum.EventParam("tier", ethereum.Value.fromI32(2)));
  e.parameters.push(new ethereum.EventParam("outcome", ethereum.Value.fromI32(outcome)));
  e.parameters.push(new ethereum.EventParam("blockNumber", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(11680241))));
  e.block.timestamp = BigInt.fromI32(ts);
  e.logIndex = BigInt.fromI32(logIndex);
  e.transaction.hash = Bytes.fromHexString(txHash) as Bytes;
  return e;
}

function send(agent: string, outcome: i32, value: string, target: string, ts: i32, logIndex: i32, txHash: string): void {
  handleAction(makeEvent(agent, outcome, value, target, ts, logIndex, txHash));
}

const TX1 = "0x" + "a1".repeat(32);
const TX2 = "0x" + "b2".repeat(32);

describe("handleAction", () => {
  afterEach(() => { clearStore(); });

  test("each outcome lands in its own bucket and the buckets add up", () => {
    send("repay", 0, WEI, TARGET_A, NOON, 0, TX1);
    send("repay", 1, WEI, TARGET_A, NOON, 1, TX1);
    send("repay", 2, WEI, TARGET_A, NOON, 2, TX1);
    send("repay", 3, WEI, TARGET_A, NOON, 3, TX1);

    assert.fieldEquals("Agent", "repay", "requests", "4");
    assert.fieldEquals("Agent", "repay", "approved", "1");
    assert.fieldEquals("Agent", "repay", "rejected", "1");
    assert.fieldEquals("Agent", "repay", "refusedByPolicy", "1");
    assert.fieldEquals("Agent", "repay", "expired", "1");
  });

  test("an outcome outside 0..3 is still counted, so the buckets never disagree with requests", () => {
    // anyone can call record(), so a nonsense outcome is reachable from outside
    send("repay", 9, WEI, TARGET_A, NOON, 0, TX1);

    assert.fieldEquals("Agent", "repay", "requests", "1");
    assert.fieldEquals("Agent", "repay", "approved", "0");
    assert.fieldEquals("Agent", "repay", "expired", "1");
    assert.fieldEquals("Action", TX1 + "00000000", "outcome", "unknown");
  });

  test("value approved grows only on approved; value requested grows on everything", () => {
    send("yield", 0, "1000", TARGET_A, NOON, 0, TX1);
    send("yield", 1, "2000", TARGET_A, NOON, 1, TX1);
    send("yield", 2, "4000", TARGET_A, NOON, 2, TX1);

    assert.fieldEquals("Agent", "yield", "valueApproved", "1000");
    assert.fieldEquals("Agent", "yield", "valueRequested", "7000");
  });

  test("a target folds the three refusal kinds into one count", () => {
    send("repay", 1, WEI, TARGET_A, NOON, 0, TX1);
    send("yield", 2, WEI, TARGET_A, NOON, 1, TX1);
    send("swap", 3, WEI, TARGET_A, NOON, 2, TX1);
    send("repay", 0, WEI, TARGET_A, NOON, 3, TX1);

    assert.fieldEquals("Target", TARGET_A, "requests", "4");
    assert.fieldEquals("Target", TARGET_A, "approved", "1");
    assert.fieldEquals("Target", TARGET_A, "refused", "3");
    assert.fieldEquals("Target", TARGET_A, "valueApproved", WEI);
  });

  test("each target keeps its own tally", () => {
    send("repay", 0, "100", TARGET_A, NOON, 0, TX1);
    send("yield", 0, "200", TARGET_B, NOON, 1, TX1);

    assert.fieldEquals("Target", TARGET_A, "valueApproved", "100");
    assert.fieldEquals("Target", TARGET_B, "valueApproved", "200");
  });

  test("decisions bucket by the day boundary, not by proximity in time", () => {
    const lastSecond = 20708 * 86400 - 1;
    const firstSecond = 20708 * 86400;
    send("repay", 0, "100", TARGET_A, lastSecond, 0, TX1);
    send("repay", 0, "200", TARGET_A, firstSecond, 0, TX2);

    assert.fieldEquals("DailyStat", "20707", "requests", "1");
    assert.fieldEquals("DailyStat", "20707", "valueApproved", "100");
    assert.fieldEquals("DailyStat", "20708", "requests", "1");
    assert.fieldEquals("DailyStat", "20708", "valueApproved", "200");
  });

  test("a day counts anything not approved as refused", () => {
    send("repay", 1, WEI, TARGET_A, NOON, 0, TX1);
    send("repay", 3, WEI, TARGET_A, NOON, 1, TX1);

    assert.fieldEquals("DailyStat", "20707", "requests", "2");
    assert.fieldEquals("DailyStat", "20707", "approved", "0");
    assert.fieldEquals("DailyStat", "20707", "refused", "2");
  });

  test("two decisions in one transaction are two rows, not one", () => {
    send("repay", 0, WEI, TARGET_A, NOON, 0, TX1);
    send("repay", 1, WEI, TARGET_A, NOON, 1, TX1);

    assert.entityCount("Action", 2);
    assert.fieldEquals("Action", TX1 + "00000000", "outcome", "approved");
    assert.fieldEquals("Action", TX1 + "01000000", "outcome", "rejected");
  });

  test("a request that names no agent still gets a row and a tally", () => {
    send("", 0, WEI, TARGET_A, NOON, 0, TX1);

    assert.fieldEquals("Agent", "", "requests", "1");
    assert.fieldEquals("Action", TX1 + "00000000", "agentLabel", "");
  });

  test("first seen is kept, last seen moves", () => {
    send("repay", 0, WEI, TARGET_A, NOON, 0, TX1);
    send("repay", 0, WEI, TARGET_A, NOON + 3600, 0, TX2);

    assert.fieldEquals("Agent", "repay", "firstSeen", NOON.toString());
    assert.fieldEquals("Agent", "repay", "lastSeen", (NOON + 3600).toString());
  });
});
