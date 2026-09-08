#pragma once
#define AMULET_CHAIN_ID     11155111ULL                                  // Sepolia
#define AMULET_RPC_URL      "https://ethereum-sepolia-rpc.publicnode.com"
#define AMULET_TEST_VALUE_WEI 100000000000000ULL                          // 0.0001 ETH
#define AMULET_TX_TYPE      2   // 2 = EIP-1559 (type 2), 0 = legacy (EIP-155)
#define AMULET_TEST_WITH_CALLDATA 0   // 1 = send a fake contract call (needs Blind signing on the Nano X)
