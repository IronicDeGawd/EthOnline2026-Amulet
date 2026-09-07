#include "ble_scan.h"
#include <string.h>
#include "esp_log.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "host/ble_gap.h"

static const char *TAG = "ble";

static void log_adv(const struct ble_gap_disc_desc *d)
{
    struct ble_hs_adv_fields f;
    if (ble_hs_adv_parse_fields(&f, d->data, d->length_data) != 0) return;
    char name[32] = "?";
    if (f.name != NULL && f.name_len > 0) {
        int n = f.name_len < sizeof(name) - 1 ? f.name_len : sizeof(name) - 1;
        memcpy(name, f.name, n);
        name[n] = 0;
    }
    char uuids[160] = "";
    size_t off = 0;
    for (int i = 0; i < f.num_uuids16 && off < sizeof(uuids) - 8; i++)
        off += snprintf(uuids + off, sizeof(uuids) - off, "%04x ", ble_uuid_u16(&f.uuids16[i].u));
    for (int i = 0; i < f.num_uuids128 && off < sizeof(uuids) - 40; i++) {
        char buf[BLE_UUID_STR_LEN];
        off += snprintf(uuids + off, sizeof(uuids) - off, "%s ", ble_uuid_to_str(&f.uuids128[i].u, buf));
    }
    ESP_LOGI(TAG, "%02x:%02x:%02x:%02x:%02x:%02x rssi=%d name=\"%s\" svc=[%s]",
             d->addr.val[5], d->addr.val[4], d->addr.val[3], d->addr.val[2], d->addr.val[1], d->addr.val[0],
             d->rssi, name, uuids);
}

static int on_gap(struct ble_gap_event *ev, void *arg)
{
    if (ev->type == BLE_GAP_EVENT_DISC) log_adv(&ev->disc);
    else if (ev->type == BLE_GAP_EVENT_DISC_COMPLETE) ESP_LOGI(TAG, "scan complete");
    return 0;
}

static void start_disc(void)
{
    uint8_t own_addr_type;
    if (ble_hs_id_infer_auto(0, &own_addr_type) != 0) { ESP_LOGE(TAG, "no addr"); return; }
    struct ble_gap_disc_params p = { .passive = 0, .filter_duplicates = 1, .itvl = 0x50, .window = 0x30 };
    int rc = ble_gap_disc(own_addr_type, 30 * 1000, &p, on_gap, NULL);
    if (rc != 0) ESP_LOGE(TAG, "disc rc=%d", rc);
    else ESP_LOGI(TAG, "scanning 30 s");
}

static void on_sync(void) { start_disc(); }
static void on_reset(int reason) { ESP_LOGW(TAG, "reset reason=%d", reason); }

static void host_task(void *param)
{
    nimble_port_run();
    nimble_port_freertos_deinit();
}

void ble_scan_start(void)
{
    ESP_ERROR_CHECK(nimble_port_init());
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.reset_cb = on_reset;
    nimble_port_freertos_init(host_task);
}
