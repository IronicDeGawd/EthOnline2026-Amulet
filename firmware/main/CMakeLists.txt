idf_component_register(
    SRCS "app_main.c" "net/wifi.c" "net/ws.c" "ledger/ble_transport.c" "ledger/apdu_eth.c"
         "crypto/keccak.c" "crypto/rlp.c" "crypto/tx.c" "rpc/rpc.c"
    INCLUDE_DIRS "." "net" "ledger" "crypto" "rpc"
    REQUIRES nvs_flash esp_wifi esp_event esp_netif esp_websocket_client esp_http_client bt json
)
