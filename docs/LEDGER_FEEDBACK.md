# Ledger developer-experience feedback — Amulet (ETHOnline 2026)

Running log of friction and findings while porting the Ledger BLE transport and Ethereum app APDUs to an ESP32-S3 in C (ESP-IDF v5.5, NimBLE). Written as it happened; tidied at the end. Sections follow the order a first-time embedded developer hits things.

## 1. Finding the BLE protocol (before the device arrived)

- **There is no embedded or C host implementation to start from.** Every transport is JS (Web Bluetooth, React Native, Node), Kotlin, Swift, Dart, or Rust on desktop. A microcontroller developer has to reverse the framing from `hw-transport-web-ble` source. A short "transport porting guide" page with the frame layout, tag table, and MTU rule would have saved a day.
- **The authoritative protocol note is a personal gist**, not a developer-portal page: `balenos_ble.asc` by btchip. It documents tags `0x00` GET VERSION, `0x01` INIT, `0x02` ECHO, `0x08` GET MTU and `0x0E` error, none of which the JS transport uses. Please move it into developers.ledger.com next to the Ethereum APDU doc.
- **Bonding rule is buried in that gist:** bond data is only persisted if the *client* initiates the disconnect. This explains the "disconnect, wait 4 s, reconnect" workaround in `hw-transport-web-ble` and should be stated wherever the transport is documented.
- **MTU byte semantics:** the JS code reads byte 5 of the GET MTU reply; the gist says "1-byte MTU size". The reply is a normal framed packet (`[08][0000][0001][mtu]`), so byte 5 is simply the first payload byte. Worth one sentence in the doc.

## 2. Porting notes that are not Ledger's fault but belong in a porting guide

- NimBLE (ESP-IDF) routes incoming notifications through the ATT *server* dispatch table. A central-only build with `CONFIG_BT_NIMBLE_GATT_SERVER=n` silently drops every notification from the Ledger. Cost us an hour of HCI-trace reading. A porting guide could carry a "stack gotchas" list.
- With no device on hand we validated framing against a fake peripheral on macOS (`tools/fake-ledger/`) built from the gist. It cannot rehearse pairing, which is the part most likely to differ. An official BLE simulator mode in Speculos would close this gap.

## 2b. First contact with a real Nano X (BLE)
- **The device advertises under a random-looking 4-hex name (`F69C`), not "Nano X".** Nothing in the docs says so; developers filtering by name will never find it. Document that the service UUID is the only reliable discriminator.
- **Subscribing before pairing fails with ATT error 0x05 (insufficient authentication).** The gist says LE Secure Connections are "preferred"; on the device they are *required* for the notify characteristic. Say "required" and state the order: connect → pair → subscribe.
- **The pairing window is 30 s and a missed confirmation stops advertising** until the error screen is dismissed on the device. First-time developers will read this as "my scan is broken". Worth one line.
- There is a **third characteristic** (`…0003`, write-without-response) not in the gist. Is it usable for APDU frames? Unknown; document either way.
- `GET MTU (0x08)` did not answer within 3 s and `GET VERSION (0x00)` returned an empty payload, while `ECHO (0x02)` and APDUs worked. Either these tags are deprecated or need a specific state; the doc should say which tags current firmware supports.

## 3. Ethereum app APDUs
- `GET PUBLIC KEY` worked first try from C with the layout in `hw-app-eth`.
- `SIGN TX` for a legacy EIP-155 transfer worked first try; the 1-byte `v` needs the chainId-modulo recovery that only exists in `hw-app-eth` source, not in the app's APDU doc. One sentence in the doc ("for chainId > 109 the returned v is truncated; recover as …") would spare every non-JS integrator a puzzle.
- **The `SIGN ETH TRANSACTION` `v` byte is three different encodings and `doc/apdu.md` describes none of them.** The doc lists the response as `v | 1` with no further text. From `src/features/sign_tx/ui_common_sign_tx.c` it is actually: bare parity (`0`/`1`) for Type 1/2/4; `chainId*2+35` plus parity plus `2` for the `xGTn` case, truncated to one byte, for legacy with a chain ID; and `27` plus those offsets for a pre-EIP-155 payload. Measured and confirmed on a Nano X — tx `0xb7cb3e4a…c074` on Sepolia, `v` byte `0`, accepted with `yParity 0x0`.
  What makes this a clear oversight rather than a judgement call: **the same document already gets it right for `SIGN EIP 7702 AUTHORIZATION`**, whose output row reads *"Signature parity (0 even, 1 odd) - use as is in EIP 7702"*. One command explains the convention, the neighbouring one does not.
  **The failure mode points away from the cause.** Applying the legacy recovery to a typed transaction yields a valid signature over a *different* recovered sender, so the node accepts the shape and answers `insufficient funds for gas * price + value: balance 0`. That reads as an unfunded account. Anyone without the JS libraries to lean on will go looking at their funding, their nonce and their RLP before they suspect one byte.
  Today the rule is only recoverable by reading the app's C source or `@ledgerhq/hw-app-eth`. For a non-JS integrator — we wrote the transport in C for an embedded target — there is no documented path to it.
  **Ask:** document the byte per transaction type, with the legacy recovery formula. We have prepared the patch: `docs/upstream/app-ethereum-v-byte/`.

- Contract-call transactions (calldata present, no ERC-7730 descriptor) sign fine with **Blind signing enabled**; the device shows a clear warning screen first. Good UX. A pointer from the APDU doc to "how to ship an ERC-7730 descriptor so this call is clear-signed" would turn the warning into a feature for hackathon teams.
- Auto-lock returns **0x5515** on every APDU. It is in the doc, but a note that hosts should poll-and-wait rather than fail would help agent-style integrations where nobody is watching a terminal.
- `SIGN TX` with an invalid leading byte returns **0x6501**; a continuation chunk with no transaction in progress returns **0x6980**. Neither code is in the app's `apdu.md` status-word table as far as we could find. A complete table would have saved a lookup.

## 4. wallet-cli / Key Ring
_(to be filled when the brain's secrets move to the Key Ring)_

## 5. Developer portal navigation
_(to be filled)_

## 6. Suggestions
1. A "transport porting guide" with frame layout, tag table, MTU rule, bonding rule, and status words on one page. Note that there is currently **no live repo to contribute one to**: `hw-transport-android-ble` and `hw-transport-ios-ble` are both archived, and `LedgerHQ/developer-portal` is not publicly reachable. The only public description of the framing is a gist. See `docs/upstream/README.md`.
2. Publish a minimal C reference implementation of the BLE framing (it is ~150 lines).
3. Add BLE transport to Speculos, or document a way to run the BLE protocol over TCP for host development.
4. Document the `SIGN ETH TRANSACTION` `v` byte per transaction type — patch prepared, `docs/upstream/app-ethereum-v-byte/`.
