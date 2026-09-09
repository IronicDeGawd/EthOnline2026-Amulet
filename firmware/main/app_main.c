// Amulet pendant — Day 2 build: first Ledger-signed transaction from the pendant.
// WiFi → RPC → BLE Ledger → GET PUBLIC KEY → nonce/fees → tx to self → SIGN TX → broadcast.
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "display.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "wifi.h"
#include "ws.h"
#include "ble_transport.h"
#include "apdu_eth.h"
#include "keccak.h"
#include "tx.h"
#include "rpc.h"
#include "secrets.h"
#include "amulet_config.h"

static const char *TAG = "amulet";
static const uint32_t ETH_PATH[5] = { 44 | BIP32_HARDEN, 60 | BIP32_HARDEN, 0 | BIP32_HARDEN, 0, 0 };

static void hexlog(const char *label, const uint8_t *b, size_t n)
{
    char *h = malloc(2 * n + 1); bytes_to_hex(b, n, h);
    ESP_LOGI(TAG, "%s (%u): 0x%s", label, (unsigned)n, h); free(h);
}

static bool keccak_selftest(void)
{
    uint8_t out[32]; keccak256((const uint8_t *)"", 0, out);
    static const uint8_t want[32] = {0xc5,0xd2,0x46,0x01,0x86,0xf7,0x23,0x3c,0x92,0x7e,0x7d,0xb2,0xdc,0xc7,0x03,0xc0,
                                     0xe5,0x00,0xb6,0x53,0xca,0x82,0x27,0x3b,0x7b,0xfa,0xd8,0x04,0x5d,0x85,0xa4,0x70};
    bool ok = memcmp(out, want, 32) == 0;
    ESP_LOGI(TAG, "keccak selftest %s", ok ? "OK" : "FAIL");
    return ok;
}

static int sign_with_ledger(const uint8_t *rlp, size_t rlp_len, uint8_t *v, uint8_t r[32], uint8_t s[32])
{
    uint8_t apdu[300], out[128]; size_t off = 0, al, n; uint16_t sw = 0; bool first = true; int rc;
    while ((al = apdu_eth_sign_chunk(apdu, sizeof apdu, ETH_PATH, 5, rlp, rlp_len, &off, first)) != 0) {
        rc = ledger_apdu(apdu, al, out, sizeof out, &n, &sw, 120000);   // user reviews on device
        ESP_LOGI(TAG, "sign chunk first=%d len=%u rc=%d sw=%04x resp=%u", first, (unsigned)al, rc, sw, (unsigned)n);
        if (rc) return rc;
        if (sw != 0x9000) return -(int)sw;
        first = false;
        if (off >= rlp_len) return apdu_eth_parse_sig(out, n, v, r, s);
    }
    return -1;
}

static void first_signed_tx(void)
{
    uint8_t out[512]; size_t n; uint16_t sw; int rc;
    if (ledger_ble_connect(90000)) { ESP_LOGE(TAG, "ledger connect failed"); return; }

    uint8_t apdu[64]; size_t al = apdu_eth_get_address(apdu, sizeof apdu, ETH_PATH, 5, false);
    for (int attempt = 0; attempt < 40; attempt++) {          // up to ~3 min for the user to unlock / open the app
        rc = ledger_apdu(apdu, al, out, sizeof out, &n, &sw, 10000);
        if (rc == 0 && sw == 0x9000) break;
        if (rc == 0 && sw == 0x5515) ESP_LOGW(TAG, "Ledger is LOCKED — enter PIN (attempt %d)", attempt);
        else if (rc == 0 && (sw == 0x6511 || sw == 0x6e00 || sw == 0x6d02 || sw == 0x6e01)) ESP_LOGW(TAG, "Ethereum app not open (sw=%04x) — open it (attempt %d)", sw, attempt);
        else ESP_LOGW(TAG, "get-address rc=%d sw=%04x (attempt %d)", rc, sw, attempt);
        if (rc != 0) break;
        vTaskDelay(pdMS_TO_TICKS(5000));
    }
    uint8_t pk[65]; char addr[43];
    if (rc || sw != 0x9000 || apdu_eth_parse_address(out, n, pk, addr)) { ESP_LOGE(TAG, "get-address failed rc=%d sw=%04x", rc, sw); goto done; }
    ESP_LOGI(TAG, "LEDGER ADDRESS %s", addr);

    uint8_t bal[32]; uint64_t nonce;
    if (!rpc_balance(addr, bal) || !rpc_get_nonce(addr, &nonce)) { ESP_LOGE(TAG, "rpc failed"); goto done; }
    hexlog("balance wei", bal + 24, 8); ESP_LOGI(TAG, "nonce %llu", (unsigned long long)nonce);
    bool zero = true; for (int i = 0; i < 32; i++) if (bal[i]) zero = false;
    if (zero) { ESP_LOGW(TAG, "balance is zero — fund %s with Sepolia ETH and reset", addr); goto done; }

#if AMULET_TEST_WITH_CALLDATA
    // Contract-call shape: selector repay(uint256) + amount 120e6. Requires Blind signing enabled on the device.
    static const uint8_t calldata[36] = { 0x37,0x1f,0xd8,0xea,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, 0x07,0x27,0x0e,0x00 };
    const uint8_t *cd = calldata; size_t cdl = sizeof calldata; uint64_t gas_limit = 60000;
#else
    const uint8_t *cd = NULL; size_t cdl = 0; uint64_t gas_limit = 21000;
#endif

#if AMULET_TX_TYPE == 2
    uint8_t max_fee[32], max_prio[32];
    if (!rpc_fee_data(max_fee, max_prio)) { ESP_LOGE(TAG, "fee data failed"); goto done; }
    hexlog("maxFeePerGas", max_fee + 24, 8); hexlog("maxPriorityFeePerGas", max_prio + 24, 8);

    tx1559_t tx = { .chain_id = AMULET_CHAIN_ID, .nonce = nonce, .gas_limit = gas_limit, .data = cd, .data_len = cdl };
    memcpy(tx.max_fee, max_fee, 32);
    memcpy(tx.max_priority_fee, max_prio, 32);
    hex_to_bytes(addr, tx.to, 20);                    // to self
    u64_to_be32(AMULET_TEST_VALUE_WEI, tx.value);

    uint8_t rlp[256]; size_t rl = tx_1559_encode_unsigned(&tx, rlp, sizeof rlp);
#else
    uint8_t gas_price[32];
    if (!rpc_gas_price(gas_price)) { ESP_LOGE(TAG, "gas price failed"); goto done; }
    hexlog("gasPrice", gas_price + 24, 8);
    // bump gas price 25% so it lands quickly
    { uint64_t gp = 0; for (int i = 24; i < 32; i++) gp = (gp << 8) | gas_price[i]; gp += gp / 4; u64_to_be32(gp, gas_price); }

    legacy_tx_t tx = { .chain_id = AMULET_CHAIN_ID, .nonce = nonce, .gas_limit = gas_limit, .data = cd, .data_len = cdl };
    memcpy(tx.gas_price, gas_price, 32);
    hex_to_bytes(addr, tx.to, 20);                    // to self
    u64_to_be32(AMULET_TEST_VALUE_WEI, tx.value);

    uint8_t rlp[256]; size_t rl = tx_legacy_encode_unsigned(&tx, rlp, sizeof rlp);
#endif
    if (!rl) { ESP_LOGE(TAG, "encode failed"); goto done; }
    hexlog("unsigned payload", rlp, rl);
    ESP_LOGW(TAG, ">>> CONFIRM THE TRANSACTION ON THE NANO X <<<");

    uint8_t v8, r[32], s[32];
    rc = sign_with_ledger(rlp, rl, &v8, r, s);
    if (rc) { ESP_LOGE(TAG, "sign failed rc=%d", rc); goto done; }
    hexlog("r", r, 32); hexlog("s", s, 32);

    uint8_t raw[320]; char txh[67], err[128];
#if AMULET_TX_TYPE == 2
    // The Ledger's v byte for typed transactions is inconsistent across app versions, and we have no
    // secp256k1 recovery on the device to settle it locally. Try the computed parity, then the other one.
    uint8_t parity = tx_1559_parity_from_ledger(v8, AMULET_CHAIN_ID);
    ESP_LOGI(TAG, "ledger v=%u → yParity guess %u", v8, parity);
    for (int pass = 0; pass < 2; pass++, parity ^= 1) {
        size_t rawl = tx_1559_encode_signed(&tx, parity, r, s, raw, sizeof raw);
        if (!rawl) { ESP_LOGE(TAG, "encode failed"); goto done; }
        hexlog("SIGNED RAW TX", raw, rawl);
        uint8_t h[32]; keccak256(raw, rawl, h); hexlog("expected tx hash", h, 32);
        if (rpc_send_raw(raw, rawl, txh, err)) {
            ESP_LOGI(TAG, "BROADCAST OK (yParity=%u) %s  https://sepolia.etherscan.io/tx/%s", parity, txh, txh);
            goto done;
        }
        ESP_LOGW(TAG, "broadcast with yParity=%u failed: %s", parity, err);
    }
    ESP_LOGE(TAG, "both parities rejected — signature or encoding is wrong, not the v byte");
#else
    uint64_t v = tx_legacy_v_from_ledger(v8, AMULET_CHAIN_ID);
    ESP_LOGI(TAG, "ledger v=%u → v=%llu", v8, (unsigned long long)v);
    size_t rawl = tx_legacy_encode_signed(&tx, v, r, s, raw, sizeof raw);
    if (!rawl) { ESP_LOGE(TAG, "encode failed"); goto done; }
    hexlog("SIGNED RAW TX", raw, rawl);
    uint8_t h[32]; keccak256(raw, rawl, h); hexlog("expected tx hash", h, 32);
    if (rpc_send_raw(raw, rawl, txh, err)) ESP_LOGI(TAG, "BROADCAST OK %s  https://sepolia.etherscan.io/tx/%s", txh, txh);
    else ESP_LOGE(TAG, "broadcast failed: %s", err);
#endif
done:
    ledger_ble_disconnect();
}

static void on_ws_rx(const char *data, size_t len) { ESP_LOGI(TAG, "ws rx (%u): %.*s", (unsigned)len, (int)len, data); }

void app_main(void)
{
    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) { ESP_ERROR_CHECK(nvs_flash_erase()); r = nvs_flash_init(); }
    ESP_ERROR_CHECK(r);
    ESP_LOGI(TAG, "amulet day-2 build, free heap %lu", (unsigned long)esp_get_free_heap_size());
    keccak_selftest();

    // Display is optional: if the board is absent or a pin is wrong, the signing flow still runs
    // headless over serial. Never let a screen fault take out the transaction path.
    esp_err_t derr = display_init();
    if (derr != ESP_OK) ESP_LOGW(TAG, "display init failed (%s) — running headless", esp_err_to_name(derr));

    if (!wifi_connect(AMULET_WIFI_SSID, AMULET_WIFI_PASS)) { ESP_LOGE(TAG, "wifi failed"); return; }
    rpc_init(AMULET_RPC_URL);
    ledger_ble_init();
    first_signed_tx();

    ws_start(AMULET_WSS_URL, on_ws_rx);
    while (1) vTaskDelay(pdMS_TO_TICKS(5000));
}
