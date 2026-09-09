#include "display.h"
#include "amulet_config.h"
#include <string.h>
#include "esp_log.h"
#include "esp_check.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/spi_master.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "driver/gpio.h"
#include "esp_rom_sys.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_gc9a01.h"
#include "esp_lvgl_port.h"

static const char *TAG = "display";
static bool s_ready;

// The panel is write-only for us, so the SPI bus is declared with no MISO. That is what frees
// D9 (GPIO8) for the haptic motor — see context/research/parts.md.
#define LCD_H_RES 240
#define LCD_V_RES 240
#define LCD_BITS_PER_PIXEL 16

static lv_display_t *s_disp;
static i2c_master_dev_handle_t s_touch;

bool display_ready(void) { return s_ready; }

void display_backlight(uint8_t percent)
{
    if (percent > 100) percent = 100;
    uint32_t duty = (255 * percent) / 100;
    ledc_set_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0, duty);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, LEDC_CHANNEL_0);
}

static void backlight_init(void)
{
    ledc_timer_config_t t = {
        .speed_mode = LEDC_LOW_SPEED_MODE, .duty_resolution = LEDC_TIMER_8_BIT,
        .timer_num = LEDC_TIMER_0, .freq_hz = 5000, .clk_cfg = LEDC_AUTO_CLK,
    };
    ledc_timer_config(&t);
    ledc_channel_config_t c = {
        .gpio_num = AMULET_PIN_LCD_BL, .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel = LEDC_CHANNEL_0, .timer_sel = LEDC_TIMER_0, .duty = 0, .hpoint = 0,
    };
    ledc_channel_config(&c);
}

#define CHSC6X_ADDR       0x2e
#define CHSC6X_READ_LEN   5

// INT is a PULSE, not a level: the CHSC6X strobes it on each new touch report rather than
// holding it low for the duration of a press. Reading the pin's instantaneous level therefore
// reports "released" between reports, which broke hold-to-confirm — the progress ring reset
// several times a second while a finger was clearly down.
//
// So the pin is not read at all, and the controller itself is polled for the truth. A press
// is latched for HOLD_LATCH_MS past the last valid report, which bridges the gap between
// reports without making a real release feel sluggish.
#define HOLD_LATCH_MS 80

static uint32_t s_last_valid_ms;
static int16_t  s_last_x, s_last_y;

// The CHSC6X answers a plain 5-byte read with no register address:
//   [0] = 1 when a point is valid, [2] = x, [4] = y. Coordinates are already 0..239.
// Out-of-range values arrive alongside a valid flag occasionally, as Seeed's own
// esp_lcd_touch_chsc6x guards against; unchecked they fling the pointer to a corner.
static void chsc6x_read(lv_indev_t *indev, lv_indev_data_t *data)
{
    (void)indev;
    uint8_t buf[CHSC6X_READ_LEN] = {0};
    bool valid = (i2c_master_receive(s_touch, buf, sizeof buf, 50) == ESP_OK) &&
                 buf[0] == 0x01 && buf[2] < LCD_H_RES && buf[4] < LCD_V_RES;

    uint32_t now = lv_tick_get();
    if (valid) {
        s_last_x = buf[2];
        s_last_y = buf[4];
        s_last_valid_ms = now;
    }

    // Hold the last known coordinates while the latch stands, so a dropped report does not
    // make the pointer jump mid-gesture.
    if (s_last_valid_ms && (now - s_last_valid_ms) < HOLD_LATCH_MS) {
        data->point.x = s_last_x;
        data->point.y = s_last_y;
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

esp_err_t display_init(void)
{
    backlight_init();

    spi_bus_config_t bus = {
        .sclk_io_num = AMULET_PIN_LCD_SCK,
        .mosi_io_num = AMULET_PIN_LCD_MOSI,
        .miso_io_num = -1,                       // deliberately unused; D9 belongs to the motor
        .quadwp_io_num = -1, .quadhd_io_num = -1,
        .max_transfer_sz = LCD_H_RES * 80 * sizeof(uint16_t),
    };
    ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO), TAG, "spi bus");

    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_cfg = GC9A01_PANEL_IO_SPI_CONFIG(
        AMULET_PIN_LCD_CS, AMULET_PIN_LCD_DC, NULL, NULL);
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi((esp_lcd_spi_bus_handle_t)SPI2_HOST, &io_cfg, &io),
                        TAG, "panel io");

    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_dev_config_t pcfg = {
        .reset_gpio_num = -1,                    // RST is not broken out on this board
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
        .bits_per_pixel = LCD_BITS_PER_PIXEL,
    };
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_gc9a01(io, &pcfg, &panel), TAG, "gc9a01");
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));   // GC9A01 wants inverted
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    const lvgl_port_cfg_t lv_cfg = ESP_LVGL_PORT_INIT_CONFIG();
    ESP_RETURN_ON_ERROR(lvgl_port_init(&lv_cfg), TAG, "lvgl port");

    const lvgl_port_display_cfg_t disp_cfg = {
        .io_handle = io, .panel_handle = panel,
        .buffer_size = LCD_H_RES * 40, .double_buffer = false,
        .hres = LCD_H_RES, .vres = LCD_V_RES, .monochrome = false,
        // Verified on hardware 2026-09-09: this panel needs X mirrored, Y left alone,
        // no swap_xy. Text reads correctly and the RGB bar order is right.
        .rotation = { .swap_xy = false, .mirror_x = true, .mirror_y = false },
        // RGB565 is two bytes per pixel and this panel expects them big-endian, while LVGL
        // renders little-endian. Without swap_bytes the colour fields straddle the byte
        // boundary and everything comes out a wrong pastel (red renders as pink).
        .flags = { .swap_bytes = true, .buff_dma = true },
    };
    s_disp = lvgl_port_add_disp(&disp_cfg);
    if (!s_disp) return ESP_FAIL;

    // The panel is usable now. Mark ready and light the backlight BEFORE touch is attempted:
    // a silent touch controller must never leave the screen dark.
    s_ready = true;
    display_backlight(100);
    ESP_LOGI(TAG, "panel up, LVGL %d.%d.%d, backlight on",
             lv_version_major(), lv_version_minor(), lv_version_patch());

    // Touch shares D4/D5 with the RTC.
    i2c_master_bus_config_t ibus = {
        .i2c_port = I2C_NUM_0, .sda_io_num = AMULET_PIN_I2C_SDA, .scl_io_num = AMULET_PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t ihandle = NULL;
    if (i2c_new_master_bus(&ibus, &ihandle) != ESP_OK) {
        ESP_LOGW(TAG, "i2c bus failed — display stays up, no touch input");
        return ESP_OK;
    }

    // Who is actually on this bus? The RTC (PCF8563, 0x51) shares it with the touch
    // controller (CST816S, 0x15). Seeing the RTC but not the touch proves the pins are right
    // and the touch panel is the problem; seeing neither points at the pins or the FPC.
    ESP_LOGI(TAG, "scanning I2C bus (SDA=%d SCL=%d)", AMULET_PIN_I2C_SDA, AMULET_PIN_I2C_SCL);
    int found = 0;
    for (uint8_t a = 0x08; a < 0x78; a++) {
        if (i2c_master_probe(ihandle, a, 50) == ESP_OK) {
            const char *who = (a == 0x15) ? " (CST816S touch)" : (a == 0x51) ? " (PCF8563 RTC)" : "";
            ESP_LOGI(TAG, "  found 0x%02x%s", a, who);
            found++;
        }
    }
    if (!found) ESP_LOGW(TAG, "  nothing on the bus — check the I2C pins and the touch FPC seating");

    // This board carries a **CHSC6X** touch controller at 0x2E, not the CST816S at 0x15 that
    // the esp_lcd_touch_cst816s component expects. Seeed's own Arduino library
    // (Seeed_Arduino_RoundDisplay, src/lv_xiao_round_screen.h) confirms it: CHSC6X_I2C_ID 0x2e,
    // a 5-byte raw read with no register address, and the INT pin as the pressed flag.
    // It also only appears on the bus after a real power-on reset, because TP_RST shares the
    // LCD's RC reset net (v1.1 schematic, FPC pin 12) rather than any XIAO GPIO.
    if (i2c_master_bus_add_device(ihandle,
            &(i2c_device_config_t){ .dev_addr_length = I2C_ADDR_BIT_LEN_7,
                                    .device_address = CHSC6X_ADDR,
                                    .scl_speed_hz = 400000 },
            &s_touch) != ESP_OK) {
        ESP_LOGW(TAG, "could not add touch device — display stays up, no touch input");
        return ESP_OK;
    }

    // INT is not read (see chsc6x_read: it pulses rather than holding), but keep it pulled
    // up and configured — floating is worse, and it is the natural wake source later.
    gpio_config_t intcfg = {
        .pin_bit_mask = 1ULL << AMULET_PIN_TP_INT,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&intcfg));

    lv_indev_t *indev = lv_indev_create();
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_display(indev, s_disp);
    lv_indev_set_read_cb(indev, chsc6x_read);

    ESP_LOGI(TAG, "touch up (CHSC6X @ 0x%02x, INT on GPIO%d)", CHSC6X_ADDR, AMULET_PIN_TP_INT);
    return ESP_OK;
}
