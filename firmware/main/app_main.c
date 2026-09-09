// Amulet pendant — Day 2 build: first Ledger-signed transaction from the pendant.
// WiFi → RPC → BLE Ledger → GET PUBLIC KEY → nonce/fees → tx to self → SIGN TX → broadcast.
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_sntp.h"
#include <time.h>
#include "display.h"
#include "ui.h"
#include "battery.h"
#include "proposal.h"
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

// ---- proposal flow ----------------------------------------------------------------------
// The websocket callback runs on the client's task, so it must not sign or broadcast. It
// parses, hands the proposal over, and returns. All BLE and RPC work happens on the main
// task below, where blocking for a human to press a Ledger button is fine.
static amulet_proposal_t s_pending;
static volatile bool s_have_pending;
static void on_ws_rx(const char *data, size_t len)
{
    char err[64];
    amulet_proposal_t p;
    if (!proposal_parse(data, len, &p, err, sizeof err)) {
        ESP_LOGW(TAG, "ignored message: %s", err);
        return;
    }
    if (p.chain_id != AMULET_CHAIN_ID) {
        ESP_LOGW(TAG, "proposal for chain %llu, we are on %llu — refused",
                 (unsigned long long)p.chain_id, (unsigned long long)AMULET_CHAIN_ID);
        return;
    }
    if (s_have_pending) { ESP_LOGW(TAG, "already holding a proposal, dropped %s", p.id); return; }
    s_pending = p;
    s_have_pending = true;
    ESP_LOGI(TAG, "proposal %s tier %u: %s", p.id, p.tier, p.human);
}

// Signs one proposal on the Ledger and broadcasts it. Returns true when it lands.
static char s_last_txh[67];   // full hash of the last broadcast, for the decision report

// Tells the brain what happened to a proposal. The brain gets a fact, never a signature it
// could replay: result is one of approved | rejected | policy_reject | expired.
static void send_decision(const char *id, const char *result, const char *txh)
{
    char msg[192];
    snprintf(msg, sizeof msg, "{\"type\":\"decision\",\"id\":\"%s\",\"result\":\"%s\",\"txHash\":\"%s\"}",
             id, result, txh ? txh : "");
    if (!ws_send_text(msg)) ESP_LOGW(TAG, "decision not delivered (no brain link): %s", msg);
}

static bool execute(const amulet_proposal_t *p, char *out, size_t out_cap)
{
    s_last_txh[0] = 0;
    tx1559_t tx = {
        .chain_id = p->chain_id, .nonce = p->nonce, .gas_limit = p->gas,
        .data = p->data_len ? p->data : NULL, .data_len = p->data_len,
    };
    memcpy(tx.to, p->to, 20);
    memcpy(tx.value, p->value, 32);
    memcpy(tx.max_fee, p->max_fee, 32);
    memcpy(tx.max_priority_fee, p->max_priority_fee, 32);

    uint8_t rlp[768];
    size_t rl = tx_1559_encode_unsigned(&tx, rlp, sizeof rlp);
    if (!rl) { snprintf(out, out_cap, "encode failed"); return false; }
    hexlog("unsigned payload", rlp, rl);

    uint8_t v8, r[32], sg[32];
    if (sign_with_ledger(rlp, rl, &v8, r, sg) != 0) { snprintf(out, out_cap, "Ledger refused"); return false; }

    uint8_t raw[900];
    uint8_t parity = tx_1559_parity_from_ledger(v8, p->chain_id);
    for (int attempt = 0; attempt < 2; attempt++, parity ^= 1) {
        size_t rawl = tx_1559_encode_signed(&tx, parity, r, sg, raw, sizeof raw);
        if (!rawl) { snprintf(out, out_cap, "encode failed"); return false; }
        char txh[67], err[128];
        if (rpc_send_raw(raw, rawl, txh, err)) {
            ESP_LOGI(TAG, "BROADCAST OK (yParity=%u) https://sepolia.etherscan.io/tx/%s", parity, txh);
            snprintf(s_last_txh, sizeof s_last_txh, "%s", txh);
            snprintf(out, out_cap, "%.10s..%.6s", txh, txh + 60);
            return true;
        }
        ESP_LOGW(TAG, "broadcast yParity=%u failed: %s", parity, err);
        snprintf(out, out_cap, "%s", err);
    }
    return false;
}

// Owns the Ledger link end to end: reconnect if the BLE link dropped, then check the
// Ethereum app is actually answering. Both halves have to hold — a connected device with a
// locked screen is not ready, and neither is an unlocked one we lost the link to.
// timeout_ms is the connect budget; keep it short on the UI loop, generous at boot.
static volatile bool s_pair_shown;        // the pairing prompt took over the screen
static bool s_return_to_ledger;           // ...started from the LEDGER screen, go back there

// Reads our address from the Ledger (path 44'/60'/0'/0/0) and its nonce from the chain.
// Called whenever the Ledger first answers, whichever screen that happens from.
static void learn_address(char *addr, ui_status_t *st)
{
    uint8_t apdu[64], out[128]; size_t n = 0; uint16_t sw = 0; uint8_t pk[65];
    size_t alen = apdu_eth_get_address(apdu, sizeof apdu, ETH_PATH, 5, false);
    if (ledger_apdu(apdu, alen, out, sizeof out, &n, &sw, 10000) == 0 && sw == 0x9000 &&
        apdu_eth_parse_address(out, n, pk, addr) == 0) {
        ESP_LOGI(TAG, "LEDGER ADDRESS %s", addr);
        if (rpc_get_nonce(addr, &st->nonce)) ui_set_status(st);
    }
}

static bool ledger_link_ensure(uint32_t connect_ms, uint16_t *sw_out)
{
    if (sw_out) *sw_out = 0;
    if (!ledger_ble_is_connected()) {
        int rc = ledger_ble_connect(connect_ms);
        if (s_pair_shown) {
            // Pairing ran inside connect and left its own screen up; put the flow's screen back.
            s_pair_shown = false;
            if (ui_state() == UI_BLOCKED) vTaskDelay(pdMS_TO_TICKS(2000));
            if (s_return_to_ledger) ui_show_ledger();
            else if (s_have_pending) ui_show_proposal(&s_pending);
            else ui_show_home();
        }
        if (rc != 0) return false;
    }

    uint8_t apdu[64], out[128];
    size_t alen = apdu_eth_get_address(apdu, sizeof apdu, ETH_PATH, 5, false);
    size_t rn = 0;
    uint16_t sw = 0;
    int rc = ledger_apdu(apdu, alen, out, sizeof out, &rn, &sw, 5000);
    if (sw_out) *sw_out = sw;
    return rc == 0 && sw == 0x9000;
}

// First-time pairing. The wearer already approved it with a hold (LEDGER screen or a
// proposal), so the pendant accepts its side of the numeric comparison at once and the code
// on screen is there to be checked against the Nano X. The Nano X button is the gate: refuse
// there and the pairing fails. Waiting for a second hold here only raced the Nano X, which
// drops the request when either side is slow.
static bool pairing_prompt(uint32_t code)
{
    ESP_LOGW(TAG, "PAIRING CODE %06lu - confirm on the Nano X", (unsigned long)code);
    if (!display_ready()) return true;
    s_pair_shown = true;
    ui_show_pairing(code);
    return true;
}

// Turns a Ledger status word into something worth putting on a 32mm screen.
static const char *ledger_reason(uint16_t sw)
{
    switch (sw) {
        case 0x5515: return "unlock your Ledger";
        case 0x6511: case 0x6e00: case 0x6d02: case 0x6e01: return "open the Ethereum app";
        case 0x0000: return "Ledger not found";
        default:     return "Ledger not ready";
    }
}

#if AMULET_FAKE_PROPOSAL
// Lets the whole UI and signing flow be finished and rehearsed before the brain exists.
// Set AMULET_FAKE_PROPOSAL to 0 once the agent is pushing real proposals.
//
// Fees and nonce are read LIVE rather than hardcoded. Hardcoding them is how a rehearsal
// starts failing for reasons that have nothing to do with the thing under test: a stale nonce
// gives "nonce too low", and a fee ceiling below the current base fee gives "max fee per gas
// less than block base fee". Both look like signing bugs and are not.
static void inject_fake_proposal(const char *self_addr)
{
    uint64_t nonce = 0;
    if (!rpc_get_nonce(self_addr, &nonce)) { ESP_LOGW(TAG, "fake proposal: no nonce"); return; }

    uint8_t max_fee[32], max_prio[32];
    if (!rpc_fee_data(max_fee, max_prio)) { ESP_LOGW(TAG, "fake proposal: no fee data"); return; }
    char fee_hex[67] = "0x", prio_hex[67] = "0x";
    bytes_to_hex(max_fee, 32, fee_hex + 2);
    bytes_to_hex(max_prio, 32, prio_hex + 2);

    static char json[900];
    snprintf(json, sizeof json,
        "{\"type\":\"proposal\",\"id\":\"demo-1\",\"tier\":2,"
        "\"action\":\"SEND\",\"human\":\"Send 0.0001 ETH\","
        "\"rationale\":\"Demo: to yourself\","
        "\"tx\":{\"chainId\":%llu,\"to\":\"%s\",\"value\":\"0x5af3107a4000\","
        "\"nonce\":%llu,\"maxFeePerGas\":\"%s\","
        "\"maxPriorityFeePerGas\":\"%s\",\"gas\":21000},"
        "\"evidence\":{\"deploymentId\":\"QmFake\",\"block\":1},\"expiresAt\":0}",
        (unsigned long long)AMULET_CHAIN_ID, self_addr, (unsigned long long)nonce, fee_hex, prio_hex);
    ESP_LOGI(TAG, "fake proposal: nonce %llu maxFee %s", (unsigned long long)nonce, fee_hex);
    on_ws_rx(json, strlen(json));
}
#endif

void app_main(void)
{
    esp_err_t r = nvs_flash_init();
    if (r == ESP_ERR_NVS_NO_FREE_PAGES || r == ESP_ERR_NVS_NEW_VERSION_FOUND) { ESP_ERROR_CHECK(nvs_flash_erase()); r = nvs_flash_init(); }
    ESP_ERROR_CHECK(r);
    ESP_LOGI(TAG, "amulet day-3 build, free heap %lu", (unsigned long)esp_get_free_heap_size());
    keccak_selftest();

    // Display is optional: if the board is absent or a pin is wrong, the signing flow still runs
    // headless over serial. Never let a screen fault take out the transaction path.
    esp_err_t derr = display_init();
    if (derr != ESP_OK) ESP_LOGW(TAG, "display init failed (%s) — running headless", esp_err_to_name(derr));
    ui_init();
    battery_init();

    ui_status_t st = {0};
    ui_set_status(&st);

    if (!wifi_connect(AMULET_WIFI_SSID, AMULET_WIFI_PASS)) {
        ui_show_blocked("no wifi");
        ESP_LOGE(TAG, "wifi failed");
        return;
    }
    st.wifi = true; ui_set_status(&st);
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_init();
    setenv("TZ", AMULET_TZ, 1); tzset();

    rpc_init(AMULET_RPC_URL);
    ledger_ble_init();
    ledger_ble_set_pairing_prompt(pairing_prompt);
    bool bonded = ledger_ble_is_bonded();
    ui_set_pairing(bonded ? UI_PAIR_PAIRED : UI_PAIR_NONE, NULL, NULL);

    // Learn our own address and nonce once, so HOME has something true to show and a fake
    // proposal can be aimed back at ourselves. The Ledger auto-locks and the user may still
    // be reaching for it, so retry while telling them exactly what to do.
    // One quick try if a bond exists; otherwise HOME says "Swipe right to pair" and the
    // periodic check below picks the Ledger up whenever it appears. Never block on it.
    char addr[43] = {0};
    for (int attempt = 0; attempt < 1 && bonded && !addr[0]; attempt++) {
        uint16_t sw = 0;
        if (ledger_link_ensure(6000, &sw)) {
            uint8_t apdu[64], out[128]; size_t n = 0;
            size_t alen = apdu_eth_get_address(apdu, sizeof apdu, ETH_PATH, 5, false);
            uint8_t pk[65];
            if (ledger_apdu(apdu, alen, out, sizeof out, &n, &sw, 10000) == 0 && sw == 0x9000 &&
                apdu_eth_parse_address(out, n, pk, addr) == 0) {
                st.ledger = true;
                ESP_LOGI(TAG, "LEDGER ADDRESS %s", addr);
                if (rpc_get_nonce(addr, &st.nonce)) ESP_LOGI(TAG, "nonce %llu", (unsigned long long)st.nonce);
                break;
            }
        }
        ESP_LOGW(TAG, "%s (sw=%04x, attempt %d)", ledger_reason(sw), sw, attempt);
    }
    if (!addr[0]) ESP_LOGW(TAG, "no Ledger yet - HOME will say so and keep looking");

    ui_set_status(&st);
    ui_show_home();

    // The brain does not exist yet. Starting the client against the day-0 placeholder just
    // spams a TLS failure and a reconnect every 3 s, which drowns the log and churns the CPU
    // during a demo. Point AMULET_WSS_URL at the real agent (ws:// on the LAN) to enable it.
#if AMULET_BRAIN_ENABLED
    ws_start(AMULET_WSS_URL, on_ws_rx);
#else
    ESP_LOGW(TAG, "brain disabled (AMULET_BRAIN_ENABLED=0) — no websocket");
#endif

#if AMULET_FAKE_PROPOSAL
    // Fired from the idle loop the first time the Ledger is ready, rather than once at boot,
    // so unlocking late still gets the rehearsal.
    bool demo_sent = false;
#endif

    int tick = 0;
    while (1) {
#if AMULET_BRAIN_ENABLED
        ws_tick();
#endif
        // Re-check readiness periodically. The Ledger auto-locks, and the pendant should say
        // so on HOME rather than discovering it only when you try to sign.
        if (ui_is_resting() && ui_inactive_ms() > AMULET_IDLE_MS) ui_show_idle();

        if (tick % 20 == 1) {                            // every ~10 s
            int mv = battery_mv();
            if (mv > 0) { ui_set_battery(battery_percent(mv)); if (tick % 120 == 1) ESP_LOGI(TAG, "battery %d mV", mv); }
        }
        if (ui_is_resting() || ui_state() == UI_IDLE || ui_state() == UI_PROPOSAL) {
            time_t now = time(NULL); struct tm tmv; localtime_r(&now, &tmv);
            if (tmv.tm_year > 100) {            // SNTP has answered
                char d[16], t[8];
                strftime(d, sizeof d, "%a %e", &tmv); strftime(t, sizeof t, "%H:%M", &tmv);
                ui_set_clock(d, t);
            }
            bool brain = AMULET_BRAIN_ENABLED ? ws_is_connected() : true;
            if (brain != st.brain) { st.brain = brain; ui_set_status(&st); }
            // Cheap on the wire but not free, so only every few seconds.
            // Unpaired: never connect on our own, or the code would pop up while the wearer is
            // elsewhere. Pairing starts from the LEDGER screen (or at first boot).
            if (++tick % 6 == 0 && bonded) {
                bool led = ledger_link_ensure(4000, NULL);
                if (led != st.ledger) { st.ledger = led; ui_set_status(&st); }
                if (ledger_ble_is_bonded() != bonded) {
                    bonded = !bonded;
                    ui_set_pairing(bonded ? UI_PAIR_PAIRED : UI_PAIR_NONE, addr, NULL);
                }
                if (led && !addr[0]) learn_address(addr, &st);   // unlocked after the boot window
#if AMULET_FAKE_PROPOSAL
                if (led && addr[0] && !demo_sent) { demo_sent = true; vTaskDelay(pdMS_TO_TICKS(1500)); inject_fake_proposal(addr); }
#endif
            }
        }

        if (s_have_pending && ui_state() != UI_PROPOSAL) {
            ui_attention(s_pending.tier >= 2 ? 3 : (s_pending.tier == 1 ? 2 : 1));
            ui_show_proposal(&s_pending);
        }

        bool prop_confirm = ui_state() == UI_PROPOSAL && ui_take_confirm();   // taken once
        // An advisory (tier 0) carries nothing to sign; the screen never arms the hold for it,
        // and this guard keeps a stray confirm from reaching the Ledger with the placeholder tx.
        if (prop_confirm && s_pending.tier == 0) prop_confirm = false;
        if (prop_confirm && !st.ledger) {
            // Held while the Ledger was not answering: go and find it (pairing runs inside if
            // there is no bond yet), then the loop below puts the proposal back on screen.
            uint16_t sw = 0;
            ui_show_blocked("looking for your Ledger");
            bool led = ledger_link_ensure(12000, &sw);
            bonded = ledger_ble_is_bonded();
            if (led && !addr[0]) learn_address(addr, &st);
            ui_set_pairing(bonded ? UI_PAIR_PAIRED : UI_PAIR_NONE, addr, led ? NULL : ledger_reason(sw));
            if (led != st.ledger) { st.ledger = led; ui_set_status(&st); }
            if (!led) { ui_show_blocked(sw ? ledger_reason(sw) : "Ledger not found"); vTaskDelay(pdMS_TO_TICKS(2000)); }
            ui_show_proposal(&s_pending);
        } else if (prop_confirm) {
            ui_show_ledger_wait("Confirm on your Nano X");
            char detail[64];
            bool ok = execute(&s_pending, detail, sizeof detail);
            ui_show_result(ok, detail);
            send_decision(s_pending.id, ok ? "approved" : "rejected", ok ? s_last_txh : NULL);
            s_have_pending = false;
            if (ok && rpc_get_nonce(addr, &st.nonce)) ui_set_status(&st);
            vTaskDelay(pdMS_TO_TICKS(6000));
            ui_show_home();
        }

        if (ui_state() == UI_PROPOSAL && ui_take_reject()) {
            send_decision(s_pending.id, "rejected", NULL);
            ui_show_dismissed(s_pending.tier == 0);
            s_have_pending = false;
            vTaskDelay(pdMS_TO_TICKS(1800));
            ui_show_home();
        }

        // LEDGER screen: hold to pair (connect now; the code prompt runs inside) or to remove.
        if (ui_state() == UI_LEDGER && ui_take_confirm()) {
            if (bonded) {
                ledger_ble_forget();
                bonded = false; st.ledger = false; ui_set_status(&st);
                ui_set_pairing(UI_PAIR_REMOVED, NULL, NULL);
                vTaskDelay(pdMS_TO_TICKS(1800));
                ui_set_pairing(UI_PAIR_NONE, NULL, NULL);
            } else {
                s_return_to_ledger = true;
                uint16_t sw = 0;
                ui_show_blocked("looking for your Ledger");
                bool led = ledger_link_ensure(12000, &sw);
                s_return_to_ledger = false;
                bonded = ledger_ble_is_bonded();
                if (led && !addr[0]) learn_address(addr, &st);
                if (led != st.ledger) { st.ledger = led; ui_set_status(&st); }
                // Not paired: back to this screen with the reason on its detail line.
                ui_set_pairing(bonded ? UI_PAIR_PAIRED : UI_PAIR_NONE, addr,
                               bonded ? NULL : (sw ? ledger_reason(sw) : "Not found. Is it unlocked?"));
                if (ui_state() != UI_LEDGER) ui_show_ledger();
            }
        }

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
