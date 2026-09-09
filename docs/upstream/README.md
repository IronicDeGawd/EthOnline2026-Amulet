# Upstream contributions

Prepared, reviewed, **not yet submitted.** Nothing here has been opened against a Ledger
repository. Each folder holds a ready-to-send patch and PR body.

## Status

| # | Target | Kind | Status |
|---|--------|------|--------|
| 1 | `LedgerHQ/app-ethereum` → `doc/apdu.md` | Documentation | Ready to open |
| 2 | BLE transport porting guide | Documentation | Blocked — no live repo, see below |

## 1. `app-ethereum` — document the `SIGN ETH TRANSACTION` `v` byte

Folder: `app-ethereum-v-byte/`

- `apdu-v-byte.diff` — unified diff against `doc/apdu.md` at `develop`. Verified to apply
  cleanly with `patch(1)`.
- `PR_BODY.md` — PR description, already fitted to the repo's pull request template.

The response `v` byte is three different encodings depending on transaction type and the
doc explains none of them. The same file already documents the convention correctly for
`SIGN EIP 7702 AUTHORIZATION`, which makes the omission on `SIGN ETH TRANSACTION` look like
an oversight rather than a decision.

Repo facts checked: `LedgerHQ/app-ethereum`, Apache-2.0, active (pushed 2026-09-08),
default branch `develop`, has a PR template, no `CONTRIBUTING.md`.

**To open it:** fork, apply the diff to `doc/apdu.md` on a branch off `develop`, and paste
`PR_BODY.md`. Not done — waiting on the go-ahead.

## 2. BLE transport porting guide — no home for it yet

Our `firmware/main/ledger/ble_transport.c` is, as far as we can find, the first embedded-C
implementation of the Ledger BLE APDU framing. The natural place to contribute the wire
protocol write-up does not currently exist:

- `LedgerHQ/hw-transport-android-ble` — **archived** (Aug 2024). Cannot accept a PR.
- `LedgerHQ/hw-transport-ios-ble` — **archived** (Jan 2024). Cannot accept a PR.
- `LedgerHQ/developer-portal` — returns 404 on the GitHub API; referenced as the
  replacement for the deprecated `LedgerHQ/ledger-dev-doc`, but not publicly reachable.
- The only public description of the framing is a gist by Ledger's CTO
  (`btchip/balenos_ble.asc`), which a PR cannot target.
- `LedgerHQ/device-sdk-ts` is active and is where transport work now lives, but it is a
  TypeScript library. A protocol-level porting guide would need a maintainer's view on
  whether it belongs there.

Options, in order of preference:

1. Ask in the ETHOnline team group chat on `developers.ledger.com/eth-online` where a
   transport porting guide should live. The Ledger PMs pointed at that chat for exactly
   this kind of question.
2. Open an issue on `LedgerHQ/device-sdk-ts` proposing the guide and asking where it should
   go, rather than a PR that may land in the wrong repo.
3. Keep it as `docs/LEDGER_BLE_PORTING.md` in this repo and link it from the feedback
   report, so it is at least public and citable.

Option 3 is not blocked on anyone and should happen regardless.

## Context

The Ledger track asked for documentation feedback explicitly — *"a simple page would do"* —
and said PRs to any public Ledger repo count. See `context/research/ledger-workshop.md`.
The running feedback log is `docs/LEDGER_FEEDBACK.md`.
