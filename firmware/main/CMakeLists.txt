idf_component_register(
    SRCS "app_main.c" "net/wifi.c" "net/ws.c" "ledger/ble_transport.c" "ledger/apdu_eth.c"
    INCLUDE_DIRS "." "net" "ledger"
    REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_websocket_client bt json
)
