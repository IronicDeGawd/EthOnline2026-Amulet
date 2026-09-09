file(GLOB ASSET_SRCS "${CMAKE_CURRENT_SOURCE_DIR}/assets/*.c")

idf_component_register(
    SRCS ${ASSET_SRCS} "app_main.c" "net/wifi.c" "net/ws.c" "ledger/ble_transport.c" "ledger/apdu_eth.c"
         "crypto/keccak.c" "crypto/rlp.c" "crypto/tx.c" "rpc/rpc.c" "display/display.c" "proposal.c" "ui/ui.c" "power/battery.c"
    INCLUDE_DIRS "." "net" "ledger" "crypto" "rpc" "display" "ui" "assets" "power"
    REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_websocket_client esp_http_client bt json esp_lcd esp_driver_spi esp_driver_i2c esp_driver_ledc esp_adc
             espressif__esp_lcd_gc9a01 espressif__esp_lvgl_port lvgl__lvgl
)
