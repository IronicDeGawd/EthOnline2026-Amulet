# Amulet contracts (Sepolia)

The mock protocol the agent guards. The Ledger signs straight into these contracts; there is no vault, no custom signer, no key held by the brain.

| Contract | Role |
|---|---|
| `MockERC20` | sUSDC, 6 decimals. The sims and the router may mint/burn without allowance, so no `approve` ever reaches the Ledger. |
| `PositionSim` ×2 | Lending market: native ETH collateral, sUSDC debt, owner-settable price (the demo lever). `supply()` / `repay()` are payable ETH; `withdraw` / `borrow` take one uint. Sim-A and Sim-B differ only in rates, for the yield-move demo. |
| `SwapSim` | Router with the exact Uniswap v3 `exactInputSingle` signature (selector `0x414bf389`). ETH ↔ sUSDC at the Sim-A price minus 0.3 %. |
| `AmuletLog` | `record(...)` emits one `Action` per agent decision, refusals included. Indexed by the custom subgraph. |

Health factor = collateral × price × liquidationThreshold / debt, 1e18-scaled. Demo path: supply 0.05 ETH, borrow 60 sUSDC → HF 1.33; `setPrice(1600e8)` → 1.07; repay 0.01 ETH → 1.45.

```
forge test
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC --broadcast \
  --private-key $(cat ../.secrets/sepolia-deployer) [--verify --etherscan-api-key ...]
```

Deploy writes `deployments/<chainId>.json` (addresses + pinned selectors). `deployments/11155111.json` is committed and is the single source the brain, the firmware policy vectors and the ENS `amulet.allowed` record read from.

Demo lever: `pnpm amulet setprice 160000000000` from `brain/` (deployer key comes from the Ledger Key Ring, never a file).
