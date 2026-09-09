idf_component_register(
    SRCS "app_main.c" "net/wifi.c" "net/ws.c" "ledger/ble_transport.c" "ledger/apdu_eth.c"
         "crypto/keccak.c" "crypto/rlp.c" "crypto/tx.c" "rpc/rpc.c" "display/display.c"
    INCLUDE_DIRS "." "net" "ledger" "crypto" "rpc" "display"
    REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_websocket_client esp_http_client bt json esp_lcd esp_driver_spi esp_driver_i2c esp_driver_ledc
             espressif__esp_lcd_gc9a01 espressif__esp_lcd_touch_cst816s espressif__esp_lvgl_port lvgl__lvgl
)
