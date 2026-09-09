// Host test for main/policy/policy.c against the vectors the brain's tests export, so both
// sides of the wire agree on what "inside the policy" means.
//   cc -I main -I main/policy -I $IDF_PATH/components/json/cJSON \
//      test/policy_test.c main/policy/policy.c $IDF_PATH/components/json/cJSON/cJSON.c -o /tmp/policy_test \
//   && /tmp/policy_test ../brain/test/vectors/policy.json
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "cJSON.h"
#include "policy.h"

static char *slurp(const char *path)
{
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(2); }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)n + 1); fread(b, 1, (size_t)n, f); b[n] = 0; fclose(f); return b;
}

// Quantity hex ("0x2386f26fc10000", any length) right-aligned into 32 bytes.
static bool qty_to_be32(const char *hex, uint8_t out[32])
{
    if (hex[0] == '0' && hex[1] == 'x') hex += 2;
    size_t n = strlen(hex);
    if (n > 64) return false;
    char padded[65]; memset(padded, '0', 64 - n); memcpy(padded + 64 - n, hex, n); padded[64] = 0;
    return policy_hex_to_bytes(padded, out, 32);
}

static const char *str(cJSON *o, const char *k) { cJSON *v = cJSON_GetObjectItem(o, k); return v && cJSON_IsString(v) ? v->valuestring : NULL; }

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: policy_test vectors.json\n"); return 2; }
    cJSON *root = cJSON_Parse(slurp(argv[1]));
    if (!root) { fprintf(stderr, "bad json\n"); return 2; }
    cJSON *pol = cJSON_GetObjectItem(root, "policy");
    int64_t now = (int64_t)cJSON_GetObjectItem(root, "now")->valuedouble;

    policy_t p;
    if (!policy_parse(&p, str(pol, "amulet.version"), str(pol, "amulet.chain"), str(pol, "amulet.allowed"),
                      str(pol, "amulet.max_value_wei"), str(pol, "amulet.tier1_hf"), str(pol, "amulet.tier2_hf"))) {
        fprintf(stderr, "policy_parse failed\n"); return 1;
    }
    printf("policy v%u chain %llu, %u targets, tiers %u/%u\n", p.version, (unsigned long long)p.chain, p.nallowed, p.tier1_hf_x100, p.tier2_hf_x100);

    int fails = 0, n = 0;
    cJSON *v;
    cJSON_ArrayForEach(v, cJSON_GetObjectItem(root, "vectors")) {
        cJSON *tx = cJSON_GetObjectItem(v, "tx");
        amulet_proposal_t q; memset(&q, 0, sizeof q);
        q.tier = 2;
        q.chain_id = (uint64_t)cJSON_GetObjectItem(tx, "chainId")->valuedouble;
        q.gas = (uint64_t)cJSON_GetObjectItem(tx, "gas")->valuedouble;
        q.expires_at = (int64_t)cJSON_GetObjectItem(tx, "expiresAt")->valuedouble;
        if (!policy_hex_to_bytes(str(tx, "to"), q.to, 20)) { printf("bad to\n"); return 1; }
        if (!qty_to_be32(str(tx, "value"), q.value)) { printf("bad value\n"); return 1; }
        const char *data = str(tx, "data");
        q.data_len = (strlen(data) - 2) / 2;
        if (q.data_len && !policy_hex_to_bytes(data, q.data, q.data_len)) { printf("bad data\n"); return 1; }
        bool expect = cJSON_IsTrue(cJSON_GetObjectItem(v, "expect"));
        char reason[POLICY_REASON_LEN] = "";
        bool got = policy_within(&p, &q, now, reason, sizeof reason);
        n++;
        if (got != expect) fails++;
        printf("%s %-40s -> %s%s%s\n", got == expect ? "ok  " : "FAIL", str(v, "name"), got ? "within" : "refused", reason[0] ? ": " : "", reason);
    }
    // Advisories are never refused, whatever the policy says.
    amulet_proposal_t adv; memset(&adv, 0, sizeof adv); adv.tier = 0; adv.chain_id = 1;
    if (!policy_within(&p, &adv, now, NULL, 0)) { printf("FAIL advisory refused\n"); fails++; }
    policy_t none; memset(&none, 0, sizeof none);
    amulet_proposal_t t2; memset(&t2, 0, sizeof t2); t2.tier = 2;
    if (policy_within(&none, &t2, now, NULL, 0)) { printf("FAIL no policy accepted a tier-2\n"); fails++; }
    printf("%d vectors, %d failed\n", n, fails);
    return fails ? 1 : 0;
}
