import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { Action as ActionEvent } from "../generated/AmuletLog/AmuletLog";
import { Action, Agent, DailyStat, Target } from "../generated/schema";

// 0 approved, 1 rejected by the wearer, 2 refused by the on-device policy, 3 expired unanswered.
function outcomeName(o: i32): string {
  if (o == 0) return "approved";
  if (o == 1) return "rejected";
  if (o == 2) return "policy_reject";
  if (o == 3) return "expired";
  return "unknown";
}

const DAY: i32 = 86400;

function loadAgent(label: string, ts: BigInt): Agent {
  let a = Agent.load(label);
  if (a == null) {
    a = new Agent(label);
    a.label = label;
    a.requests = 0;
    a.approved = 0;
    a.rejected = 0;
    a.refusedByPolicy = 0;
    a.expired = 0;
    a.valueApproved = BigInt.zero();
    a.valueRequested = BigInt.zero();
    a.firstSeen = ts;
  }
  return a as Agent;
}

function loadTarget(addr: Bytes): Target {
  let t = Target.load(addr);
  if (t == null) {
    t = new Target(addr);
    t.requests = 0;
    t.approved = 0;
    t.refused = 0;
    t.valueApproved = BigInt.zero();
  }
  return t as Target;
}

function loadDay(ts: BigInt): DailyStat {
  const day = ts.toI32() / DAY;
  const id = day.toString();
  let d = DailyStat.load(id);
  if (d == null) {
    d = new DailyStat(id);
    d.day = day;
    d.requests = 0;
    d.approved = 0;
    d.refused = 0;
    d.valueApproved = BigInt.zero();
  }
  return d as DailyStat;
}

export function handleAction(event: ActionEvent): void {
  const ts = event.block.timestamp;
  const label = event.params.agent;
  const outcome = outcomeName(event.params.outcome);
  const approved = outcome == "approved";
  const value = event.params.value;

  const a = loadAgent(label, ts);

  const id = event.transaction.hash.concatI32(event.logIndex.toI32());
  const act = new Action(id);
  act.agentLabel = label;
  act.agent = a.id;
  act.proposalId = event.params.proposalId;
  act.sender = event.params.sender;
  act.target = event.params.target;
  act.selector = event.params.selector;
  act.value = value;
  act.tier = event.params.tier;
  act.outcome = outcome;
  act.approved = approved;
  act.blockNumber = event.params.blockNumber;
  act.timestamp = ts;
  act.txHash = event.transaction.hash;
  act.save();

  a.requests += 1;
  a.valueRequested = a.valueRequested.plus(value);
  if (approved) {
    a.approved += 1;
    a.valueApproved = a.valueApproved.plus(value);
  } else if (outcome == "rejected") {
    a.rejected += 1;
  } else if (outcome == "policy_reject") {
    a.refusedByPolicy += 1;
  } else if (outcome == "expired") {
    a.expired += 1;
  }
  a.lastSeen = ts;
  a.save();

  const t = loadTarget(event.params.target);
  t.requests += 1;
  if (approved) {
    t.approved += 1;
    t.valueApproved = t.valueApproved.plus(value);
  } else {
    t.refused += 1;
  }
  t.lastSeen = ts;
  t.save();

  const d = loadDay(ts);
  d.requests += 1;
  if (approved) {
    d.approved += 1;
    d.valueApproved = d.valueApproved.plus(value);
  } else {
    d.refused += 1;
  }
  d.save();
}
