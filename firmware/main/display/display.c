#include "display.h"
#include "amulet_config.h"
#include <string.h>
#include "esp_log.h"
#include "esp_check.h"
#include "driver/spi_master.h"
#include "driver/i2c_master.h"
#include "driver/ledc.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_gc9a01.h"
#include "esp_lcd_touch_cst816s.h"
#include "esp_lvgl_port.h"

static const char *TAG = "display";
static bool s_ready;

// The panel is write-only for us, so the SPI bus is declared with no MISO. That is what frees
// D9 (GPIO8) for the haptic motor — see context/research/parts.md.
#define LCD_H_RES 240
#define LCD_V_RES 240
#define LCD_BITS_PER_PIXEL 16

static lv_display_t *s_disp;

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
        .rotation = { .swap_xy = false, .mirror_x = false, .mirror_y = false },
    };
    s_disp = lvgl_port_add_disp(&disp_cfg);
    if (!s_disp) return ESP_FAIL;

    // Touch shares D4/D5 with the RTC.
    i2c_master_bus_config_t ibus = {
        .i2c_port = I2C_NUM_0, .sda_io_num = AMULET_PIN_I2C_SDA, .scl_io_num = AMULET_PIN_I2C_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7, .flags.enable_internal_pullup = true,
    };
    i2c_master_bus_handle_t ihandle = NULL;
    ESP_RETURN_ON_ERROR(i2c_new_master_bus(&ibus, &ihandle), TAG, "i2c bus");

    esp_lcd_panel_io_handle_t tp_io = NULL;
    esp_lcd_panel_io_i2c_config_t tp_io_cfg = ESP_LCD_TOUCH_IO_I2C_CST816S_CONFIG();
    ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_i2c(ihandle, &tp_io_cfg, &tp_io), TAG, "tp io");

    esp_lcd_touch_handle_t tp = NULL;
    const esp_lcd_touch_config_t tp_cfg = {
        .x_max = LCD_H_RES, .y_max = LCD_V_RES,
        .rst_gpio_num = -1, .int_gpio_num = AMULET_PIN_TP_INT,
        .flags = { .swap_xy = 0, .mirror_x = 0, .mirror_y = 0 },
    };
    ESP_RETURN_ON_ERROR(esp_lcd_touch_new_i2c_cst816s(tp_io, &tp_cfg, &tp), TAG, "cst816s");

    const lvgl_port_touch_cfg_t touch_cfg = { .disp = s_disp, .handle = tp };
    if (!lvgl_port_add_touch(&touch_cfg)) return ESP_FAIL;

    s_ready = true;
    display_backlight(100);
    ESP_LOGI(TAG, "display + touch up, LVGL %d.%d.%d", lv_version_major(), lv_version_minor(), lv_version_patch());
    return ESP_OK;
}
