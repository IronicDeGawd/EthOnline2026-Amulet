#pragma once
// Typed-data signing on the Nano X, so the device shows words instead of bytes.
//
// The Ethereum app will not decode our contract calldata — that needs a descriptor Ledger
// signs and publishes, and only for mainnet contracts. It will lay out an EIP-712 message
// from the message itself, with nothing registered anywhere. So the pendant builds the
// intent here, field by field, and the device shows the same sentence the screen shows.
//
// The message is fixed:
//   EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)
//   Action(string summary,string action,address market,uint256 amount,uint256 nonce,uint256 deadline)
//
// Note for the wearer: on a Nano X the message fields appear only with "Verbose EIP712"
// enabled in the Ethereum app settings; otherwise the device shows the domain and a hash.
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    const char *summary;      // "Repay 0.0062 ETH on Sim-A" — inside the signature
    const char *action;       // "Repay" | "Supply" | "Withdraw" | "Borrow"
    uint8_t market[20];
    uint8_t amount[32];       // big-endian
    uint8_t nonce[32];
    uint8_t deadline[32];
    uint64_t chain_id;
    uint8_t verifying_contract[20];   // the AmuletAccount
} eip712_action_t;

// Runs the whole exchange with the Ledger and returns the 65-byte signature as r||s||v,
// which is what AmuletAccount.execute expects. `sw` gets the last status word on failure.
// Returns 0 on success.
int eip712_sign_action(const uint32_t *path, uint8_t path_n, const eip712_action_t *a,
                       uint8_t sig_rsv[65], uint16_t *sw);

// Exposed for the host test: builds one struct-definition APDU for a field.
size_t eip712_field_def(uint8_t *buf, size_t cap, uint8_t type_desc, uint8_t type_size,
                        const char *key);
size_t eip712_struct_name(uint8_t *buf, size_t cap, uint8_t ins, const char *name);
size_t eip712_field_value(uint8_t *buf, size_t cap, const uint8_t *val, size_t len);
