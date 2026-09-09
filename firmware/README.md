# firmware — Amulet pendant (ESP-IDF v5.5, XIAO ESP32-S3)

Day-0 build: WiFi + WSS echo + BLE scan. Serial only.

```sh
. ~/esp/esp-idf/export.sh
cp main/secrets.h.example main/secrets.h   # fill in WiFi
idf.py set-target esp32s3
idf.py build
idf.py -p /dev/cu.usbmodem* flash monitor
```
