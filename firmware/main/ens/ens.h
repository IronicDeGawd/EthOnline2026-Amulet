#pragma once
// Reads the policy records from the ENSv2 resolver on Sepolia (eth_call text(node,key))
// and keeps the last good copy in NVS, so a pendant that boots without the network still
// enforces the policy it last saw.
#include <stdbool.h>
#include <stdint.h>
#include "policy.h"

// Reads one agent's name: its policy records and its face. `label` is the subname, so
// "repay" reads repay.<parent>.eth. On success `out` holds the agent and true is returned;
// on failure `out` is left as it was.
//
// An empty version record on a name that answered is NOT a network problem — it means the
// Ledger blanked that agent's policy, or the name lapsed. `revoked` is set in that case and
// the caller drops the agent rather than keeping its cached policy alive.
bool ens_fetch_agent(const char *label, agent_t *out, bool *revoked);

// The agents saved last time, so a pendant that boots with no network still enforces what it
// last saw. Returns how many were restored.
int ens_load_cached(agent_t *out, int max);
void ens_save_cached(const agent_t *in, int n);

// One text record of a given name, for the log.
bool ens_text_of(const char *label, const char *key, char *out, size_t cap);
