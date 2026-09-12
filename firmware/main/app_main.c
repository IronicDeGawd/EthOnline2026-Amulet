// Amulet pendant — Day 2 build: first Ledger-signed transaction from the pendant.
// WiFi → RPC → BLE Ledger → GET PUBLIC KEY → nonce/fees → tx to self → SIGN TX → broadcast.
#include <stdio.h>
#include <string.h>
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
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
#include "eip712.h"
#include "keccak.h"
#include "tx.h"
#include "rpc.h"
#include "policy.h"
#include "ens.h"
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
// The handoff crosses cores: the copy and the flag are published under a spinlock so the
// main task never sees the flag before every byte of the proposal.
static portMUX_TYPE s_pending_mux = portMUX_INITIALIZER_UNLOCKED;
static bool take_pending_flag(void)
{
    portENTER_CRITICAL(&s_pending_mux);
    bool have = s_have_pending;
    portEXIT_CRITICAL(&s_pending_mux);
    return have;
}
// A yield card waiting to be shown; same handoff as a proposal.
static amulet_options_t s_options;
static volatile bool s_have_options;
static bool take_options_flag(void)
{
    portENTER_CRITICAL(&s_pending_mux);
    bool have = s_have_options;
    portEXIT_CRITICAL(&s_pending_mux);
    return have;
}
// The policy the wrist enforces, from ENS (ens/ens.c). Written and read on the main task
// only: the check runs there, just before a proposal is shown, so a refresh can never be
// half-applied under a check running on the websocket task.
// The agents this pendant knows, each read from its own ENS name. A proposal is checked
// against the policy of the agent that sent it; one from a name that is not here is refused
// whatever it says.
static agent_t s_agents[AGENT_MAX];
static int s_nagents;

static const agent_t *agent_find(const char *label)
{
    if (!label || !label[0]) return NULL;
    for (int i = 0; i < s_nagents; i++) if (!strcmp(s_agents[i].label, label)) return &s_agents[i];
    return NULL;
}

// The freshest read across the agents we hold, for the "policy not refreshed" line on HOME.
static int64_t agents_fetched_at(void)
{
    int64_t newest = 0;
    for (int i = 0; i < s_nagents; i++) if (s_agents[i].policy.fetched_at > newest) newest = s_agents[i].policy.fetched_at;
    return newest;
}
static amulet_portfolio_t s_portfolio;
static volatile bool s_have_portfolio;
static volatile bool s_policy_refresh_now;   // the brain saw the ENS records change
static void on_ws_rx(const char *data, size_t len)
{
    char err[64];
    amulet_proposal_t p;
    // Holdings arrive as a long message, so this check cannot live inside the short-frame
    // branch below — it never matched there, and every portfolio fell through to be rejected
    // as "not a proposal".
    if (len > 20 && memmem(data, len < 40 ? len : 40, "\"portfolio\"", 11)) {
        if (portfolio_parse(data, len, &s_portfolio, err, sizeof err)) s_have_portfolio = true;
        else ESP_LOGW(TAG, "portfolio ignored: %s", err);
        return;
    }
    if (len < 64) {   // tiny control message; the frame is not NUL-terminated
        char head[64]; memcpy(head, data, len); head[len] = 0;
        if (strstr(head, "\"type\":\"policy\"")) { s_policy_refresh_now = true; return; }
    }
    // A yield card is not a proposal: nothing to sign until a row is tapped.
    if (len > 20 && memmem(data, len < 40 ? len : 40, "\"options\"", 9)) {
        amulet_options_t o;
        if (!options_parse(data, len, &o, err, sizeof err)) { ESP_LOGW(TAG, "ignored card: %s", err); return; }
        if (take_pending_flag() || s_have_options) { ESP_LOGW(TAG, "busy, dropped card %s", o.id); return; }
        portENTER_CRITICAL(&s_pending_mux);
        s_options = o;
        s_have_options = true;
        portEXIT_CRITICAL(&s_pending_mux);
        ESP_LOGI(TAG, "yield card %s: %u venues for %s", o.id, o.n, o.asset);
        return;
    }
    if (!proposal_parse(data, len, &p, err, sizeof err)) {
        ESP_LOGW(TAG, "ignored message: %s", err);
        return;
    }
    if (p.chain_id != AMULET_CHAIN_ID) {
        ESP_LOGW(TAG, "proposal for chain %llu, we are on %llu — refused",
                 (unsigned long long)p.chain_id, (unsigned long long)AMULET_CHAIN_ID);
        return;
    }
    if (take_pending_flag()) { ESP_LOGW(TAG, "already holding a proposal, dropped %s", p.id); return; }
    portENTER_CRITICAL(&s_pending_mux);
    s_pending = p;
    s_have_pending = true;
    portEXIT_CRITICAL(&s_pending_mux);
    ESP_LOGI(TAG, "proposal %s tier %u: %s", p.id, p.tier, p.human);
}

// Read the policy from ENS; keep the cached one when the network says no. Returns whether
// what we hold is fresh enough to trust silently.
// Re-reads every agent's name. One that answers with a blank policy is dropped on the spot:
// that is the Ledger switching it off, and keeping its cached policy alive would defeat it.
// One that cannot be reached keeps what it had, because a flat network is not permission.
static bool agents_refresh(bool *stale_out)
{
    static const char *labels[] = AMULET_AGENT_LABELS;
    agent_t next[AGENT_MAX];
    int n = 0;
    bool all_read = true;
    for (size_t i = 0; i < sizeof labels / sizeof labels[0] && n < AGENT_MAX; i++) {
        agent_t a;
        bool revoked = false;
        if (ens_fetch_agent(labels[i], &a, &revoked)) {
            next[n++] = a;
        } else if (revoked) {
            all_read = false;                       // deliberately dropped, not carried over
            ESP_LOGW(TAG, "%s is revoked: the wrist will refuse everything it sends", labels[i]);
        } else {
            all_read = false;
            const agent_t *old = agent_find(labels[i]);
            if (old) next[n++] = *old;              // unreachable: keep what we last saw
        }
    }
    memcpy(s_agents, next, sizeof(agent_t) * (size_t)n);
    s_nagents = n;
    if (n) ens_save_cached(s_agents, n);

    int64_t newest = agents_fetched_at();
    int64_t age = newest ? (int64_t)time(NULL) - newest : INT64_MAX;
    bool stale = n == 0 || (!all_read && age > AMULET_POLICY_STALE_S);
    for (int i = 0; i < n; i++) s_agents[i].policy.stale = stale;
    if (stale_out) *stale_out = stale;
    return all_read && n > 0;
}

// Signs one proposal on the Ledger and broadcasts it. Returns true when it lands.
static char s_last_txh[67];   // full hash of the last broadcast, for the decision report
static uint8_t s_last_sig[65];   // r||s||v of the last typed-data signature

// Tells the brain what happened to a proposal. The brain gets a fact, never a signature it
// could replay: result is one of approved | rejected | policy_reject | expired.
static void send_decision(const char *id, const char *result, const char *txh)
{
    char msg[192];
    snprintf(msg, sizeof msg, "{\"type\":\"decision\",\"id\":\"%s\",\"result\":\"%s\",\"txHash\":\"%s\"}",
             id, result, txh ? txh : "");
    if (!ws_send_text(msg)) ESP_LOGW(TAG, "decision not delivered (no brain link): %s", msg);
}

// The signature over a typed-data intent. The brain relays it; it holds no key that could
// alter what was signed.
static void send_signature(const char *id, const uint8_t sig[65])
{
    char hex[131 + 1];
    for (int i = 0; i < 65; i++) snprintf(hex + i * 2, 3, "%02x", sig[i]);
    char msg[256];
    snprintf(msg, sizeof msg, "{\"type\":\"decision\",\"id\":\"%s\",\"result\":\"approved\",\"signature\":\"0x%s\"}", id, hex);
    if (!ws_send_text(msg)) ESP_LOGW(TAG, "signature not delivered (no brain link)");
}

// The typed-data path: the Ledger shows the sentence and the figures, signs the intent, and
// the pendant hands the signature back. Whoever relays it pays the gas and can change none of
// it — the summary, the market, the amount, the nonce and the deadline are all inside the
// signature. Returns true when the device signed.
static bool sign_intent(const amulet_proposal_t *p, char *out, size_t out_cap)
{
    const amulet_intent_t *t = &p->intent;
    eip712_action_t a = {
        .summary = t->summary, .action = t->action, .chain_id = p->chain_id,
    };
    memcpy(a.market, t->market, 20);
    memcpy(a.amount, t->amount, 32);
    memcpy(a.nonce, t->nonce, 32);
    memcpy(a.deadline, t->deadline, 32);
    memcpy(a.verifying_contract, t->account, 20);
    uint16_t sw = 0;
    int rc = eip712_sign_action(ETH_PATH, 5, &a, s_last_sig, &sw);
    if (rc != 0) {
        // 0x6985 is the wearer saying no on the device; anything else is a real failure.
        if (sw == 0x6985) snprintf(out, out_cap, "Ledger refused");
        else if (sw == 0x6a80 || sw == 0x6501) snprintf(out, out_cap, "turn on Verbose EIP712");
        else snprintf(out, out_cap, "sign failed 0x%04x", sw);
        return false;
    }
    snprintf(out, out_cap, "signed, agent relaying");
    return true;
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

    // Policy: the last copy from NVS first (boots with no network still enforce it), then a
    // fresh read from the ENS name (six eth_calls, ~45 s; the brain link comes up meanwhile
    // and any proposal simply waits in s_pending). HOME says when neither is recent.
    s_nagents = ens_load_cached(s_agents, AGENT_MAX);
    if (s_nagents) ESP_LOGI(TAG, "%d agent(s) from NVS", s_nagents);
    agents_refresh(&st.policy_stale);
    ui_set_status(&st);
    for (int i = 0; i < s_nagents; i++)
        ESP_LOGI(TAG, "agent %s.%s: cap set, %u targets%s", s_agents[i].label, AMULET_ENS_PARENT,
                 s_agents[i].policy.nallowed, s_agents[i].has_face ? ", has a face" : "");
    if (!s_nagents) ESP_LOGW(TAG, "no agents yet: every tier-1/2 proposal will be refused until %s answers", AMULET_ENS_PARENT);
    time_t policy_tried = time(NULL);
    bool pf_asked = false;   // ask the brain once per visit to the holdings screen
    uint32_t heap_logged = 0;
    uint32_t ledger_used_ms = 0;   // when the Ledger was last actually needed

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
            // The Ledger is a signer, not a data source: nothing here needs it until there is
            // something to sign. So it is only sought while the wearer is actually looking at
            // the Ledger screen. Everywhere else the radio stays quiet, which is both the
            // scarce internal memory and a measurable slice of the battery.
            // Unpaired: never connect on our own, or the code would pop up while the wearer is
            // elsewhere. Pairing starts from the LEDGER screen (or at first boot).
            if (++tick % 6 == 0 && bonded && ui_state() == UI_LEDGER) {
                bool led = ledger_link_ensure(4000, NULL);
                if (led != st.ledger) { st.ledger = led; ui_set_status(&st); }
                if (led) ledger_used_ms = (uint32_t)(esp_timer_get_time() / 1000);
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

        // Hourly policy refresh (or when the brain says so); a failed read retries in five
        // minutes. Not while the Ledger is mid-signature or pairing: that path owns the radio.
        if (ui_state() != UI_LEDGER_WAIT && ui_state() != UI_PAIRING) {
            time_t now = time(NULL);
            int64_t newest = agents_fetched_at();
            int64_t since_ok = newest ? (int64_t)now - newest : INT64_MAX;
            if (s_policy_refresh_now || (since_ok > AMULET_POLICY_REFRESH_S && now - policy_tried > 300)) {
                if (s_policy_refresh_now) ESP_LOGI(TAG, "brain says the policy changed; re-reading");
                s_policy_refresh_now = false;
                policy_tried = now;
                bool stale;
                ESP_LOGI(TAG, "heap before agent read: %u total, %u internal",
                         (unsigned)esp_get_free_heap_size(),
                         (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));
                agents_refresh(&stale);
                if (stale != st.policy_stale) { st.policy_stale = stale; ui_set_status(&st); }
            }
        }

        // A yield card: show it, then relay the tap (pick) or the swipe (dismiss) to the brain.
        // The pick becomes a normal proposal on the brain's side; nothing is signed from here.
        if (take_options_flag() && ui_state() != UI_OPTIONS) {
            if (options_expired(&s_options, (int64_t)time(NULL))) {
                ESP_LOGW(TAG, "yield card %s expired before it was shown", s_options.id);
                s_have_options = false;
            } else {
                ui_attention(1);
                ui_show_options(&s_options);
            }
        }
        if (ui_state() == UI_AGENT) {
            if (ui_take_tap()) {
                // Put the request on screen first. Finding the Ledger takes seconds and blocks
                // this task, so doing it before the tap is handled makes the face screen feel
                // dead and invites a second tap. The hold arms itself when the link answers.
                ui_show_proposal(&s_pending);
                if (!st.ledger && bonded && s_pending.tier >= 2) {
                    bool led = ledger_link_ensure(8000, NULL);
                    if (led != st.ledger) { st.ledger = led; ui_set_status(&st); }
                    if (led) ledger_used_ms = (uint32_t)(esp_timer_get_time() / 1000);
                }
            } else if (ui_take_reject()) {
                send_decision(s_pending.id, "rejected", NULL);
                ui_show_dismissed(false);
                s_have_pending = false;
                vTaskDelay(pdMS_TO_TICKS(1800));
                ui_show_home();
            }
        }

        // Nothing has wanted the Ledger for a while: drop the link and stop the radio. It
        // comes back on the next proposal, which costs a few seconds hidden behind the face
        // screen, and costs nothing at all while the pendant is just sitting on a chest.
        if (st.ledger && !s_have_pending && ui_state() != UI_LEDGER && ui_state() != UI_LEDGER_WAIT
            && ui_state() != UI_PAIRING && ui_state() != UI_PROPOSAL && ui_state() != UI_AGENT) {
            uint32_t idle = (uint32_t)(esp_timer_get_time() / 1000) - ledger_used_ms;
            if (ledger_used_ms && idle > AMULET_LEDGER_IDLE_MS) {
                ESP_LOGI(TAG, "Ledger idle for %us - letting the link go", (unsigned)(idle / 1000));
                ledger_ble_disconnect();
                st.ledger = false;
                ui_set_status(&st);
                ledger_used_ms = 0;
            }
        }

        // Internal RAM is the one that runs out: WiFi, TLS, BLE and the screen's draw buffer
        // all need it and nothing else can. Print it often enough to see the floor.
        uint32_t now_ms = (uint32_t)(esp_timer_get_time() / 1000);
        if (now_ms - heap_logged > 20000) {
            heap_logged = now_ms;
            ESP_LOGI(TAG, "heap: %u free, %u internal, %u internal low-water | lvgl %u of %u used, %u%% frag",
                     (unsigned)esp_get_free_heap_size(),
                     (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                     (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL),
                     (unsigned)ui_lvgl_used(), (unsigned)ui_lvgl_total(), (unsigned)ui_lvgl_frag());
        }

        // The holdings screen asks once when it opens and shows whatever comes back.
        if (ui_state() == UI_PORTFOLIO) {
            if (!pf_asked) {
                pf_asked = true;
                s_have_portfolio = false;
                ui_portfolio_waiting();
                if (!ws_send_text("{\"type\":\"ask\",\"kind\":\"portfolio\"}")) ESP_LOGW(TAG, "portfolio ask not delivered");
            }
            if (s_have_portfolio) { s_have_portfolio = false; ui_show_portfolio(&s_portfolio); }
        } else {
            pf_asked = false;
        }

        // The one thing the wearer starts. The screen sends an ask; whatever the agent comes
        // back with arrives as an ordinary proposal and is checked like any other.
        if (ui_state() == UI_SWAP) {
            char from[8], to[8], amount[12], msg[160];
            if (ui_take_swap(from, sizeof from, to, sizeof to, amount, sizeof amount)) {
                snprintf(msg, sizeof msg,
                         "{\"type\":\"ask\",\"kind\":\"swap\",\"from\":\"%s\",\"to\":\"%s\",\"amount\":\"%s\"}",
                         from, to, amount);
                if (ws_send_text(msg)) {
                    ESP_LOGI(TAG, "asked the agent: %s", msg);
                } else {
                    ESP_LOGW(TAG, "ask not delivered: %s", msg);
                    ui_swap_waiting("No link");
                }
            }
        }

        if (ui_state() == UI_OPTIONS) {
            int idx;
            char msg[128];
            if (ui_take_pick(&idx)) {
                snprintf(msg, sizeof msg, "{\"type\":\"pick\",\"id\":\"%s\",\"idx\":%d}", s_options.id, idx);
                if (!ws_send_text(msg)) ESP_LOGW(TAG, "pick not delivered: %s", msg);
                s_have_options = false;
                ui_show_picked(s_options.items[idx < s_options.n ? idx : 0].human);
                vTaskDelay(pdMS_TO_TICKS(1200));
                ui_show_home();
            } else if (ui_take_reject()) {
                snprintf(msg, sizeof msg, "{\"type\":\"dismiss\",\"id\":\"%s\"}", s_options.id);
                if (!ws_send_text(msg)) ESP_LOGW(TAG, "dismiss not delivered: %s", msg);
                s_have_options = false;
                ui_show_dismissed(true);
                vTaskDelay(pdMS_TO_TICKS(1800));
                ui_show_home();
            } else if (options_expired(&s_options, (int64_t)time(NULL))) {
                s_have_options = false;
                ui_show_home();
            }
        }

        if (take_pending_flag() && ui_state() != UI_PROPOSAL && ui_state() != UI_AGENT) {
            // Policy first. Out of policy: answer the brain, show why, never arm — the
            // Ledger never sees it.
            char reason[POLICY_REASON_LEN];
            // Whose proposal is this? An agent the pendant does not know gets no further,
            // and the screen says so by name.
            const agent_t *ag = agent_find(s_pending.agent);
            if (!ag) snprintf(reason, sizeof reason, s_pending.agent[0] ? "Unknown agent" : "Proposal has no agent");
            if (!ag || !policy_within(&ag->policy, &s_pending, (int64_t)time(NULL), reason, sizeof reason)) {
                ESP_LOGW(TAG, "proposal %s from '%s' REFUSED: %s (%s)", s_pending.id, s_pending.agent, reason, s_pending.human);
                send_decision(s_pending.id, "policy_reject", NULL);
                ui_attention(2);
                ui_show_policy_reject(reason, s_pending.agent, s_pending.human);
                s_have_pending = false;
                // The refusal is the moment the pendant earned its place, so it stays until
                // the wearer has read it and tapped. Three seconds went by unseen. The
                // timeout is only so a pendant left on a table finds its way home.
                // It waits. A refusal the wearer did not see is the same as no refusal at all; the
                // only reason there is a limit is a pendant left face-down on a bench.
                for (int waited = 0; waited < 600000; waited += 50) {
                    if (ui_take_ack()) break;
                    vTaskDelay(pdMS_TO_TICKS(50));
                }
                ui_show_home();
            } else {
                // Who is asking comes first. The amount is not on screen until the wearer
                // has seen the face and tapped through.
                ui_set_agent(ag);
                ui_attention(s_pending.tier >= 2 ? 3 : (s_pending.tier == 1 ? 2 : 1));
                if (ag && ag->has_face) ui_show_agent(ag);
                else ui_show_proposal(&s_pending);

            }
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
            bool intent = s_pending.intent.present;
            bool ok = intent ? sign_intent(&s_pending, detail, sizeof detail)
                             : execute(&s_pending, detail, sizeof detail);
            ui_show_result(ok, detail);
            if (intent && ok) send_signature(s_pending.id, s_last_sig);
            else send_decision(s_pending.id, ok ? "approved" : "rejected", ok ? s_last_txh : NULL);
            s_have_pending = false;
            if (ok && !intent && rpc_get_nonce(addr, &st.nonce)) ui_set_status(&st);
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
