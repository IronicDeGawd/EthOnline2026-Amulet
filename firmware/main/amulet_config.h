#pragma once
#define AMULET_IDLE_MS      30000   // HOME -> reactor face after this much no touch
#define AMULET_TZ           "IST-5:30"   // POSIX TZ for the clock on HOME
#define AMULET_CHAIN_ID     11155111ULL                                  // Sepolia
#define AMULET_RPC_URL      "https://ethereum-sepolia-rpc.publicnode.com"
#define AMULET_TEST_VALUE_WEI 100000000000000ULL                          // 0.0001 ETH
#define AMULET_TX_TYPE      2   // 2 = EIP-1559 (type 2), 0 = legacy (EIP-155)
#define AMULET_BRAIN_ENABLED 0   // 0 until the agent exists; avoids reconnect spam at the
                                 // day-0 placeholder endpoint. Set 1 with a ws:// LAN URL.
#define AMULET_FAKE_PROPOSAL 1   // 1 = inject a local proposal at boot so the UI and
                                 // signing flow can be rehearsed before the brain exists
#define AMULET_TEST_WITH_CALLDATA 0   // 1 = send a fake contract call (needs Blind signing on the Nano X)

// ---- Seeed Round Display for XIAO (v1.1) pin map ----
// XIAO ESP32-S3 D-number -> GPIO: D0=1 D1=2 D2=3 D3=4 D4=5 D5=6 D6=43 D7=44 D8=7 D9=8 D10=9
#define AMULET_PIN_LCD_SCK   7    // D8
#define AMULET_PIN_LCD_MOSI  9    // D10
#define AMULET_PIN_LCD_CS    2    // D1
#define AMULET_PIN_LCD_DC    4    // D3
#define AMULET_PIN_LCD_BL   43    // D6  -- needs the v1.1 KE switch to enable it
#define AMULET_PIN_I2C_SDA   5    // D4  -- CST816S touch + PCF8563 RTC
#define AMULET_PIN_I2C_SCL   6    // D5
#define AMULET_PIN_TP_INT   44    // D7
#define AMULET_PIN_MOTOR     8    // D9  -- MISO, unused: panel is write-only and SD is never init'd
// D2 (GPIO3) is the TF card chip-select. Left alone: the card slot is unused.
