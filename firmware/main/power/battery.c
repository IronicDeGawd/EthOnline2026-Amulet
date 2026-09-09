#include "battery.h"
#include "esp_log.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

static const char *TAG = "battery";
static adc_oneshot_unit_handle_t s_adc;
static adc_cali_handle_t s_cali;
#define BAT_CH ADC_CHANNEL_0      // GPIO1 = A0 = D0 on the XIAO ESP32-S3

void battery_init(void)
{
    adc_oneshot_unit_init_cfg_t u = { .unit_id = ADC_UNIT_1 };
    if (adc_oneshot_new_unit(&u, &s_adc) != ESP_OK) { ESP_LOGW(TAG, "no ADC"); return; }
    adc_oneshot_chan_cfg_t c = { .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT };
    adc_oneshot_config_channel(s_adc, BAT_CH, &c);
    adc_cali_curve_fitting_config_t cal = { .unit_id = ADC_UNIT_1, .chan = BAT_CH, .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_DEFAULT };
    if (adc_cali_create_scheme_curve_fitting(&cal, &s_cali) != ESP_OK) { ESP_LOGW(TAG, "no calibration"); s_cali = NULL; }
}

int battery_mv(void)
{
    if (!s_adc) return -1;
    int sum = 0, n = 0;
    for (int i = 0; i < 16; i++) {
        int raw, mv;
        if (adc_oneshot_read(s_adc, BAT_CH, &raw) != ESP_OK) continue;
        if (s_cali && adc_cali_raw_to_voltage(s_cali, raw, &mv) == ESP_OK) sum += mv;
        else sum += raw * 3100 / 4095;                 // uncalibrated fallback, 12 dB full scale
        n++;
    }
    return n ? (sum / n) * 2 : -1;                      // divider halves the pack voltage
}

int battery_percent(int mv)
{
    // Open-circuit LiPo curve. On USB the charger holds the pack near 4.2 V, so this reads
    // ~100% while plugged in; that is the real state of the cell, not a bug.
    static const int pts[][2] = { {4200,100},{4100,90},{4000,78},{3900,62},{3800,45},{3700,25},{3600,10},{3500,3},{3400,0} };
    if (mv >= pts[0][0]) return 100;
    for (int i = 1; i < 9; i++)
        if (mv >= pts[i][0]) {
            int v0 = pts[i][0], p0 = pts[i][1], v1 = pts[i-1][0], p1 = pts[i-1][1];
            return p0 + (mv - v0) * (p1 - p0) / (v1 - v0);
        }
    return 0;
}
