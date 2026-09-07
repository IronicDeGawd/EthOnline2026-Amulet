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

## 3. Ethereum app APDUs
_(to be filled on first contact with the real device)_

## 4. wallet-cli / Key Ring
_(to be filled when the brain's secrets move to the Key Ring)_

## 5. Developer portal navigation
_(to be filled)_

## 6. Suggestions
1. A "transport porting guide" with frame layout, tag table, MTU rule, bonding rule, and status words on one page.
2. Publish a minimal C reference implementation of the BLE framing (it is ~150 lines).
3. Add BLE transport to Speculos, or document a way to run the BLE protocol over TCP for host development.
