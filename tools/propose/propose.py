#!/usr/bin/env python3
"""Stand-in brain: pushes one hand-written proposal to the pendant over plain ws:// on the LAN
and waits for its decision. Used to seed the demo position through the Ledger before the real
brain exists, and as the Thursday fallback.

  propose.py --to 0xSIM --fn "supply()" --value 0.05 --human "Supply 0.05 ETH to Sim-A"
  propose.py --to 0xSIM --fn "borrow(uint256)" --args 60000000 --human "Borrow 60 sUSDC"
  propose.py --scenario price_drop            # setPrice(1600e8) from the deployer key, then a repay

Firmware: AMULET_BRAIN_ENABLED 1, AMULET_FAKE_PROPOSAL 0, AMULET_WSS_URL "ws://<this laptop>:8788".
Nano X: Blind signing ON in the Ethereum app settings (these are contract calls).
"""
import argparse, asyncio, json, os, socket, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RPC = os.environ.get("SEPOLIA_RPC", "https://ethereum-sepolia-rpc.publicnode.com")
LEDGER = "0x211828006b402e0aae8244fB95B362b9eFFf7736"
CHAIN_ID = 11155111
DEPLOYER_KEY_FILE = ROOT / ".secrets" / "sepolia-deployer"


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    # publicnode returns 403 to urllib's default User-Agent.
    req = urllib.request.Request(RPC, body, {"content-type": "application/json", "user-agent": "amulet-propose/1"})
    with urllib.request.urlopen(req, timeout=15) as r:
        out = json.load(r)
    if "error" in out:
        raise SystemExit(f"rpc {method}: {out['error']}")
    return out["result"]


def cast(*args):
    return subprocess.check_output(["cast", *args], text=True).strip()


def deployments():
    p = ROOT / "contracts" / "deployments" / f"{CHAIN_ID}.json"
    if not p.exists():
        raise SystemExit(f"missing {p} — deploy the contracts first")
    return json.loads(p.read_text())


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.connect(("8.8.8.8", 80))
    ip = s.getsockname()[0]
    s.close()
    return ip


def build_proposal(to, fn, args, value_eth, human, rationale, tier, gas):
    data = cast("calldata", fn, *args) if fn else "0x"
    value_wei = int(value_eth * 10**18)
    nonce = int(rpc("eth_getTransactionCount", [LEDGER, "pending"]), 16)
    base = int(rpc("eth_getBlockByNumber", ["latest", False])["baseFeePerGas"], 16)
    tip = int(rpc("eth_maxPriorityFeePerGas", []), 16) or 1_500_000_000
    max_fee = 2 * base + tip
    if gas is None:
        est = rpc("eth_estimateGas", [{"from": LEDGER, "to": to, "value": hex(value_wei), "data": data}])
        gas = int(int(est, 16) * 1.3)
    return {
        "type": "proposal",
        "id": f"p-{int(time.time())}",
        "tier": tier,
        "action": fn.split("(")[0].upper() if fn else "SEND",
        "human": human,
        "rationale": rationale,
        "tx": {
            "chainId": CHAIN_ID,
            "to": to,
            "value": hex(value_wei),
            "data": data,
            "nonce": nonce,
            "maxFeePerGas": hex(max_fee),
            "maxPriorityFeePerGas": hex(tip),
            "gas": gas,
        },
        "evidence": {"deploymentId": "manual", "block": int(rpc("eth_blockNumber", []), 16)},
        "expiresAt": int(time.time()) + 600,
    }


async def serve(proposal, port):
    import websockets  # pip install websockets

    done = asyncio.get_event_loop().create_future()

    async def handler(ws):
        print(f"pendant connected from {ws.remote_address[0]}")
        await ws.send(json.dumps(proposal))
        print(f"sent {proposal['id']}: {proposal['human']}")
        async for msg in ws:
            try:
                m = json.loads(msg)
            except json.JSONDecodeError:
                continue
            if m.get("type") == "decision" and m.get("id") == proposal["id"]:
                if not done.done():
                    done.set_result(m)
                return
            print("pendant:", msg)

    ip = lan_ip()
    async with websockets.serve(handler, "0.0.0.0", port):
        print(f"listening on ws://{ip}:{port}  (firmware AMULET_WSS_URL)")
        return await done


def price_drop(dep, price):
    key = DEPLOYER_KEY_FILE.read_text().strip()
    print(f"setPrice({price}) on Sim-A from the deployer key")
    out = cast("send", dep["simA"], "setPrice(uint256)", str(price), "--private-key", key, "--rpc-url", RPC, "--json")
    print("  tx", json.loads(out)["transactionHash"])
    hf = int(cast("call", dep["simA"], "healthFactor(address)(uint256)", LEDGER, "--rpc-url", RPC).split()[0])
    print(f"  Ledger HF on Sim-A now {hf / 1e18:.3f}")
    return hf


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--to")
    ap.add_argument("--fn", default="", help='e.g. "supply()" or "borrow(uint256)"; empty = plain transfer')
    ap.add_argument("--args", nargs="*", default=[])
    ap.add_argument("--value", type=float, default=0.0, help="ETH to send with the call")
    ap.add_argument("--human", default="")
    ap.add_argument("--rationale", default="Manual proposal from propose.py")
    ap.add_argument("--tier", type=int, default=2)
    ap.add_argument("--gas", type=int)
    ap.add_argument("--port", type=int, default=8788)
    ap.add_argument("--scenario", choices=["price_drop"])
    ap.add_argument("--price", type=int, default=1600_00000000, help="price_drop target, 8 decimals")
    a = ap.parse_args()

    if a.scenario == "price_drop":
        dep = deployments()
        hf = price_drop(dep, a.price)
        if hf >= 1.25e18:
            raise SystemExit("HF still >= 1.25, nothing to propose")
        a.to, a.fn, a.args = dep["simA"], "repay()", []
        if not a.value:
            a.value = 0.01
        a.human = a.human or f"Repay {a.value:g} ETH on Sim-A"
        a.rationale = f"Health factor {hf / 1e18:.2f} is under 1.25 on Sim-A after the price move."
    if not a.to or not a.human:
        ap.error("--to and --human are required (or --scenario)")

    proposal = build_proposal(a.to, a.fn, a.args, a.value, a.human, a.rationale, a.tier, a.gas)
    print(json.dumps(proposal, indent=2))
    decision = asyncio.run(serve(proposal, a.port))
    print("decision:", decision)
    if decision.get("result") == "approved":
        print(f"https://sepolia.etherscan.io/tx/{decision.get('txHash')}")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
