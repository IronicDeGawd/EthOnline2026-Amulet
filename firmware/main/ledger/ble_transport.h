#pragma once
// Ledger BLE transport for NimBLE central (ESP32-S3).
// Protocol: frames on the write char (…0002) and notify char (…0001):
//   [tag u8][seq u16 BE][len u16 BE, seq 0 only][payload]
// Tags: 0x00 GET VERSION, 0x01 INIT, 0x02 ECHO, 0x05 APDU, 0x08 GET MTU, 0x0E error.
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

#define LEDGER_TAG_VERSION 0x00
#define LEDGER_TAG_INIT    0x01
#define LEDGER_TAG_ECHO    0x02
#define LEDGER_TAG_APDU    0x05
#define LEDGER_TAG_MTU     0x08
#define LEDGER_TAG_ERROR   0x0E

// Starts the NimBLE host. Call once.
void ledger_ble_init(void);
// Scan for a Ledger (service UUID or name prefix "Nano X"), connect, subscribe, negotiate MTU.
// Blocks up to timeout_ms. Returns 0 on success.
int ledger_ble_connect(uint32_t timeout_ms);
void ledger_ble_disconnect(void);
bool ledger_ble_is_connected(void);
// Raw framed exchange. Returns 0 on success; *out_len set. Response tag must equal request tag.
int ledger_ble_exchange(uint8_t tag, const uint8_t *in, size_t in_len,
                        uint8_t *out, size_t out_cap, size_t *out_len, uint32_t timeout_ms);
// APDU exchange: strips the trailing status word into *sw. Returns 0 on transport success (check *sw == 0x9000).
int ledger_apdu(const uint8_t *apdu, size_t apdu_len,
                uint8_t *resp, size_t resp_cap, size_t *resp_len, uint16_t *sw, uint32_t timeout_ms);
// Payload capacity per BLE frame as reported by GET MTU (after connect).
uint16_t ledger_ble_payload_mtu(void);
