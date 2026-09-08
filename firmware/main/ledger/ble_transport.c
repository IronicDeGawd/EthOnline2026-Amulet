#include "ble_transport.h"
#include <string.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/ble_gap.h"
#include "host/ble_gatt.h"
#include "host/ble_sm.h"
#include "host/util/util.h"
#include "store/config/ble_store_config.h"
void ble_store_config_init(void);

static const char *TAG = "ledger-ble";

// UUIDs in NimBLE little-endian byte order.
static const ble_uuid128_t SVC_UUID  = BLE_UUID128_INIT(0x72,0x65,0x67,0x64,0x65,0x4c,0x00,0x00,0x04,0x00,0x97,0x2c,0x00,0x34,0xd6,0x13);
static const ble_uuid128_t NTF_UUID  = BLE_UUID128_INIT(0x72,0x65,0x67,0x64,0x65,0x4c,0x01,0x00,0x04,0x00,0x97,0x2c,0x00,0x34,0xd6,0x13);
static const ble_uuid128_t WR_UUID   = BLE_UUID128_INIT(0x72,0x65,0x67,0x64,0x65,0x4c,0x02,0x00,0x04,0x00,0x97,0x2c,0x00,0x34,0xd6,0x13);
static const ble_uuid16_t  CCCD_UUID = BLE_UUID16_INIT(0x2902);

#define RX_MAX 1024

// NOTE: NimBLE dispatches *incoming* notifications through the ATT server table
// (ble_att_svr_rx_notify), so CONFIG_BT_NIMBLE_GATT_SERVER must stay enabled even
// though the pendant is a pure central. Without it notifications are silently dropped.

static struct {
    uint16_t conn;               // BLE_HS_CONN_HANDLE_NONE when idle
    uint16_t svc_start, svc_end;
    uint16_t ntf_val, wr_val, cccd;
    uint16_t att_mtu;            // negotiated ATT MTU
    uint16_t payload_mtu;        // from Ledger GET MTU (bytes per frame incl. header)
    uint8_t  own_addr_type;
    volatile bool synced, ready, connected, secured;
    // rx reassembly
    uint8_t  rx_tag; uint16_t rx_seq, rx_expected, rx_len; uint8_t rx_buf[RX_MAX]; volatile bool rx_done; int rx_err;
    SemaphoreHandle_t ev;        // generic "something happened" for connect flow
    SemaphoreHandle_t rx_sem;    // response complete
    SemaphoreHandle_t wr_sem;    // GATT write acked
    SemaphoreHandle_t lock;      // one exchange at a time
} s;

static int gap_cb(struct ble_gap_event *ev, void *arg);

// ---------- discovery chain ----------
static int on_cccd_read(uint16_t conn, const struct ble_gatt_error *err, struct ble_gatt_attr *attr, void *arg)
{
    uint8_t v[2] = {0xff, 0xff};
    if (err->status == 0 && attr) os_mbuf_copydata(attr->om, 0, 2, v);
    ESP_LOGD(TAG, "cccd readback status=%d value=%02x%02x", err->status, v[0], v[1]);
    if (err->status == 0) s.ready = true;
    xSemaphoreGive(s.ev);
    return 0;
}

static int on_cccd_write(uint16_t conn, const struct ble_gatt_error *err, struct ble_gatt_attr *attr, void *arg)
{
    ESP_LOGI(TAG, "cccd write status=%d", err->status);
    if (err->status != 0) { xSemaphoreGive(s.ev); return 0; }
    ble_gattc_read(conn, s.cccd, on_cccd_read, NULL);
    return 0;
}

static int on_dsc(uint16_t conn, const struct ble_gatt_error *err, uint16_t chr_val, const struct ble_gatt_dsc *dsc, void *arg)
{
    if (err->status == 0 && dsc && ble_uuid_cmp(&dsc->uuid.u, &CCCD_UUID.u) == 0) {
        s.cccd = dsc->handle;
        ESP_LOGI(TAG, "cccd handle=%u", s.cccd);
    } else if (err->status == BLE_HS_EDONE) {
        if (!s.cccd) { ESP_LOGE(TAG, "no CCCD"); xSemaphoreGive(s.ev); return 0; }
        uint8_t en[2] = {0x01, 0x00};
        ble_gattc_write_flat(conn, s.cccd, en, sizeof en, on_cccd_write, NULL);
    }
    return 0;
}

static int on_chr(uint16_t conn, const struct ble_gatt_error *err, const struct ble_gatt_chr *chr, void *arg)
{
    if (err->status == 0 && chr) {
        char b[BLE_UUID_STR_LEN];
        ESP_LOGI(TAG, "chr %s val=%u props=0x%02x", ble_uuid_to_str(&chr->uuid.u, b), chr->val_handle, chr->properties);
        if (ble_uuid_cmp(&chr->uuid.u, &NTF_UUID.u) == 0) s.ntf_val = chr->val_handle;
        else if (ble_uuid_cmp(&chr->uuid.u, &WR_UUID.u) == 0) s.wr_val = chr->val_handle;
    } else if (err->status == BLE_HS_EDONE) {
        if (!s.ntf_val || !s.wr_val) { ESP_LOGE(TAG, "chars missing ntf=%u wr=%u", s.ntf_val, s.wr_val); xSemaphoreGive(s.ev); return 0; }
        // descriptors of the notify characteristic live between its value handle and the service end
        ble_gattc_disc_all_dscs(conn, s.ntf_val, s.svc_end, on_dsc, NULL);
    }
    return 0;
}

static int on_svc(uint16_t conn, const struct ble_gatt_error *err, const struct ble_gatt_svc *svc, void *arg)
{
    if (err->status == 0 && svc) {
        s.svc_start = svc->start_handle; s.svc_end = svc->end_handle;
        ESP_LOGI(TAG, "ledger service handles %u..%u", s.svc_start, s.svc_end);
    } else if (err->status == BLE_HS_EDONE) {
        if (!s.svc_start) { ESP_LOGE(TAG, "ledger service not found"); xSemaphoreGive(s.ev); return 0; }
        ble_gattc_disc_all_chrs(conn, s.svc_start, s.svc_end, on_chr, NULL);
    }
    return 0;
}

static int on_mtu(uint16_t conn, const struct ble_gatt_error *err, uint16_t mtu, void *arg)
{
    s.att_mtu = (err->status == 0) ? mtu : 23;
    ESP_LOGI(TAG, "att mtu=%u (status %d)", s.att_mtu, err->status);
    ble_gattc_disc_svc_by_uuid(conn, &SVC_UUID.u, on_svc, NULL);
    return 0;
}

// ---------- scanning ----------
static bool is_ledger(const struct ble_gap_disc_desc *d, char *name_out, size_t cap)
{
    struct ble_hs_adv_fields f;
    if (ble_hs_adv_parse_fields(&f, d->data, d->length_data) != 0) return false;
    name_out[0] = 0;
    if (f.name && f.name_len) {
        size_t n = f.name_len < cap - 1 ? f.name_len : cap - 1;
        memcpy(name_out, f.name, n); name_out[n] = 0;
    }
    for (int i = 0; i < f.num_uuids128; i++)
        if (ble_uuid_cmp(&f.uuids128[i].u, &SVC_UUID.u) == 0) return true;
    return strncmp(name_out, "Nano X", 6) == 0 || strncmp(name_out, "Ledger", 6) == 0;
}

static int gap_cb(struct ble_gap_event *ev, void *arg)
{
    switch (ev->type) {
    case BLE_GAP_EVENT_DISC: {
        char name[32];
        if (!is_ledger(&ev->disc, name, sizeof name)) {
            if (name[0]) ESP_LOGI(TAG, "adv \"%s\" rssi=%d", name, ev->disc.rssi);
            return 0;
        }
        ESP_LOGI(TAG, "found \"%s\" rssi=%d, connecting", name, ev->disc.rssi);
        ble_gap_disc_cancel();
        int rc = ble_gap_connect(s.own_addr_type, &ev->disc.addr, 10000, NULL, gap_cb, NULL);
        if (rc) { ESP_LOGE(TAG, "connect rc=%d", rc); xSemaphoreGive(s.ev); }
        return 0;
    }
    case BLE_GAP_EVENT_DISC_COMPLETE:
        if (!s.connected) { ESP_LOGW(TAG, "scan ended, no ledger"); xSemaphoreGive(s.ev); }
        return 0;
    case BLE_GAP_EVENT_CONNECT:
        if (ev->connect.status != 0) { ESP_LOGE(TAG, "connect failed %d", ev->connect.status); xSemaphoreGive(s.ev); return 0; }
        s.conn = ev->connect.conn_handle; s.connected = true; s.secured = false;
        ESP_LOGI(TAG, "connected handle=%u, initiating pairing", s.conn);
        {
            int rc = ble_gap_security_initiate(s.conn);
            if (rc != 0) { ESP_LOGW(TAG, "security_initiate rc=%d, continuing unencrypted", rc); ble_gattc_exchange_mtu(s.conn, on_mtu, NULL); }
        }
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ESP_LOGW(TAG, "disconnected reason=%d", ev->disconnect.reason);
        s.connected = false; s.ready = false; s.conn = BLE_HS_CONN_HANDLE_NONE;
        xSemaphoreGive(s.ev); xSemaphoreGive(s.rx_sem);
        return 0;
    case BLE_GAP_EVENT_MTU:
        s.att_mtu = ev->mtu.value;
        return 0;
    case BLE_GAP_EVENT_ENC_CHANGE: {
        struct ble_gap_conn_desc d;
        ble_gap_conn_find(ev->enc_change.conn_handle, &d);
        ESP_LOGI(TAG, "encryption change status=%d encrypted=%d authenticated=%d bonded=%d",
                 ev->enc_change.status, d.sec_state.encrypted, d.sec_state.authenticated, d.sec_state.bonded);
        if (ev->enc_change.status != 0) { xSemaphoreGive(s.ev); return 0; }
        if (!s.secured) { s.secured = true; ble_gattc_exchange_mtu(s.conn, on_mtu, NULL); }
        return 0;
    }
    case BLE_GAP_EVENT_REPEAT_PAIRING: {
        // Peer lost our bond (or we lost theirs): drop the stale bond and let it pair again.
        struct ble_gap_conn_desc d;
        if (ble_gap_conn_find(ev->repeat_pairing.conn_handle, &d) == 0) ble_store_util_delete_peer(&d.peer_id_addr);
        ESP_LOGW(TAG, "repeat pairing: deleted stale bond, retrying");
        return BLE_GAP_REPEAT_PAIRING_RETRY;
    }
    case BLE_GAP_EVENT_PASSKEY_ACTION: {
        struct ble_sm_io io = {0};
        io.action = ev->passkey.params.action;
        if (io.action == BLE_SM_IOACT_NUMCMP) {
            // TODO(day1): show ev->passkey.params.numcmp on screen and require swipe. Auto-accept for now.
            ESP_LOGW(TAG, "NUMERIC COMPARISON %06lu — auto-accepting", (unsigned long)ev->passkey.params.numcmp);
            io.numcmp_accept = 1;
        }
        ble_sm_inject_io(ev->passkey.conn_handle, &io);
        return 0;
    }
    case BLE_GAP_EVENT_NOTIFY_RX: {
        ESP_LOGD(TAG, "notify_rx handle=%u len=%u", ev->notify_rx.attr_handle, OS_MBUF_PKTLEN(ev->notify_rx.om));
        if (ev->notify_rx.attr_handle != s.ntf_val) return 0;
        uint8_t fr[256]; uint16_t n = OS_MBUF_PKTLEN(ev->notify_rx.om);
        if (n > sizeof fr) n = sizeof fr;
        os_mbuf_copydata(ev->notify_rx.om, 0, n, fr);
        ESP_LOGD(TAG, "rx frame len=%u tag=%02x", n, fr[0]);
        if (n < 3) return 0;
        uint8_t tag = fr[0]; uint16_t seq = (fr[1] << 8) | fr[2];
        const uint8_t *p; uint16_t plen;
        if (seq == 0) {
            if (n < 5) return 0;
            s.rx_tag = tag; s.rx_expected = (fr[3] << 8) | fr[4]; s.rx_len = 0; s.rx_seq = 0; s.rx_err = 0;
            p = fr + 5; plen = n - 5;
        } else {
            if (tag != s.rx_tag || seq != s.rx_seq + 1) { s.rx_err = -2; s.rx_done = true; xSemaphoreGive(s.rx_sem); return 0; }
            s.rx_seq = seq; p = fr + 3; plen = n - 3;
        }
        if (s.rx_len + plen > RX_MAX) { s.rx_err = -3; s.rx_done = true; xSemaphoreGive(s.rx_sem); return 0; }
        memcpy(s.rx_buf + s.rx_len, p, plen); s.rx_len += plen;
        if (s.rx_len >= s.rx_expected) { s.rx_done = true; xSemaphoreGive(s.rx_sem); }
        return 0;
    }
    default:
        return 0;
    }
}

// ---------- host ----------
static void on_sync(void)
{
    ble_hs_id_infer_auto(0, &s.own_addr_type);
    s.synced = true;
    ESP_LOGI(TAG, "host synced");
}
static void on_reset(int reason) { ESP_LOGW(TAG, "host reset %d", reason); }
static void host_task(void *p) { nimble_port_run(); nimble_port_freertos_deinit(); }

void ledger_ble_init(void)
{
    s.conn = BLE_HS_CONN_HANDLE_NONE;
    s.ev = xSemaphoreCreateBinary(); s.rx_sem = xSemaphoreCreateBinary();
    s.wr_sem = xSemaphoreCreateBinary(); s.lock = xSemaphoreCreateMutex();
    ESP_ERROR_CHECK(nimble_port_init());
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_DISP_YES_NO;   // numeric comparison on the pendant screen
    ble_hs_cfg.sm_bonding = 1; ble_hs_cfg.sm_mitm = 1; ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_store_config_init();   // persist bonds in NVS
    nimble_port_freertos_init(host_task);
}

bool ledger_ble_is_connected(void) { return s.connected && s.ready; }
uint16_t ledger_ble_payload_mtu(void) { return s.payload_mtu; }

void ledger_ble_disconnect(void)
{
    if (s.connected) ble_gap_terminate(s.conn, BLE_ERR_REM_USER_CONN_TERM);   // client-initiated → Ledger persists the bond
}

int ledger_ble_connect(uint32_t timeout_ms)
{
    TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(timeout_ms);
    while (!s.synced && xTaskGetTickCount() < deadline) vTaskDelay(pdMS_TO_TICKS(20));
    if (!s.synced) return -1;
    s.svc_start = s.svc_end = s.ntf_val = s.wr_val = s.cccd = 0; s.ready = false; s.payload_mtu = 0;
    xSemaphoreTake(s.ev, 0);
    struct ble_gap_disc_params p = { .passive = 0, .filter_duplicates = 1, .itvl = 0x30, .window = 0x30 };
    int rc = ble_gap_disc(s.own_addr_type, timeout_ms, &p, gap_cb, NULL);
    if (rc) { ESP_LOGE(TAG, "disc rc=%d", rc); return rc; }
    ESP_LOGI(TAG, "scanning for ledger");
    if (xSemaphoreTake(s.ev, pdMS_TO_TICKS(timeout_ms)) != pdTRUE) return -2;
    if (!s.ready) return -3;
    // Ledger-level MTU probe
    uint8_t out[8]; size_t n = 0;
    rc = ledger_ble_exchange(LEDGER_TAG_MTU, NULL, 0, out, sizeof out, &n, 3000);
    s.payload_mtu = (rc == 0 && n >= 1) ? out[0] : 20;
    ESP_LOGI(TAG, "ledger payload mtu=%u (rc=%d)", s.payload_mtu, rc);
    return 0;
}

// ---------- framed exchange ----------
static int on_write(uint16_t conn, const struct ble_gatt_error *err, struct ble_gatt_attr *attr, void *arg)
{
    if (err->status) ESP_LOGE(TAG, "write status=%d", err->status);
    xSemaphoreGive(s.wr_sem);
    return 0;
}

static int send_frame(const uint8_t *frame, size_t len)
{
    xSemaphoreTake(s.wr_sem, 0);
    int rc = ble_gattc_write_flat(s.conn, s.wr_val, frame, len, on_write, NULL);
    if (rc) { ESP_LOGE(TAG, "write_flat rc=%d", rc); return rc; }
    return xSemaphoreTake(s.wr_sem, pdMS_TO_TICKS(2000)) == pdTRUE ? 0 : -4;
}

int ledger_ble_exchange(uint8_t tag, const uint8_t *in, size_t in_len,
                        uint8_t *out, size_t out_cap, size_t *out_len, uint32_t timeout_ms)
{
    if (!s.connected || !s.ready) return -1;
    if (xSemaphoreTake(s.lock, pdMS_TO_TICKS(timeout_ms)) != pdTRUE) return -5;
    uint16_t mtu = s.payload_mtu ? s.payload_mtu : 20;
    if (mtu > s.att_mtu - 3) mtu = s.att_mtu - 3;
    uint8_t frame[256]; size_t off = 0; uint16_t seq = 0; int rc = 0;
    s.rx_done = false; xSemaphoreTake(s.rx_sem, 0);
    do {
        size_t hdr = (seq == 0) ? 5 : 3;
        size_t chunk = in_len - off; if (chunk > mtu - hdr) chunk = mtu - hdr;
        frame[0] = tag; frame[1] = seq >> 8; frame[2] = seq & 0xff;
        if (seq == 0) { frame[3] = in_len >> 8; frame[4] = in_len & 0xff; }
        if (chunk) memcpy(frame + hdr, in + off, chunk);
        rc = send_frame(frame, hdr + chunk);
        if (rc) goto out;
        off += chunk; seq++;
    } while (off < in_len);
    if (xSemaphoreTake(s.rx_sem, pdMS_TO_TICKS(timeout_ms)) != pdTRUE) { rc = -6; goto out; }
    if (!s.connected) { rc = -7; goto out; }
    if (s.rx_err) { rc = s.rx_err; goto out; }
    if (s.rx_tag == LEDGER_TAG_ERROR) { ESP_LOGE(TAG, "device protocol error %02x", s.rx_len ? s.rx_buf[0] : 0); rc = -8; goto out; }
    if (s.rx_tag != tag) { ESP_LOGE(TAG, "tag mismatch %02x != %02x", s.rx_tag, tag); rc = -9; goto out; }
    if (s.rx_expected > out_cap) { rc = -10; goto out; }
    memcpy(out, s.rx_buf, s.rx_expected); *out_len = s.rx_expected;
out:
    xSemaphoreGive(s.lock);
    return rc;
}

int ledger_apdu(const uint8_t *apdu, size_t apdu_len,
                uint8_t *resp, size_t resp_cap, size_t *resp_len, uint16_t *sw, uint32_t timeout_ms)
{
    uint8_t buf[RX_MAX]; size_t n = 0;
    int rc = ledger_ble_exchange(LEDGER_TAG_APDU, apdu, apdu_len, buf, sizeof buf, &n, timeout_ms);
    if (rc) return rc;
    if (n < 2) return -11;
    *sw = (buf[n - 2] << 8) | buf[n - 1];
    n -= 2;
    if (n > resp_cap) return -10;
    memcpy(resp, buf, n); *resp_len = n;
    return 0;
}
