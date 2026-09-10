// Host test: the options-card parser against the card the brain's tests export.
//   cc -I main -I main/crypto -I $IDF_PATH/components/json/cJSON test/options_test.c main/proposal.c \
//      main/crypto/tx.c main/crypto/rlp.c main/crypto/keccak.c $IDF_PATH/components/json/cJSON/cJSON.c -o /tmp/options_test \
//   && /tmp/options_test ../brain/test/vectors/options.json
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "proposal.h"

static char *slurp(const char *path, size_t *n)
{
    FILE *f = fopen(path, "rb"); if (!f) { perror(path); exit(2); }
    fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
    char *b = malloc((size_t)len + 1); fread(b, 1, (size_t)len, f); b[len] = 0; fclose(f);
    *n = (size_t)len; return b;
}

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: options_test card.json\n"); return 2; }
    size_t n; char *json = slurp(argv[1], &n);
    amulet_options_t o; char err[64] = "";
    int fails = 0;
    if (!options_parse(json, n, &o, err, sizeof err)) { printf("FAIL parse: %s\n", err); return 1; }
    printf("card %s asset %s: %u venues, footer \"%s\", block %llu, expires %lld\n", o.id, o.asset, o.n, o.footer, (unsigned long long)o.evidence_block, (long long)o.expires_at);
    for (int i = 0; i < o.n; i++) printf("  %u %-12s %-24s %u.%02u%%\n", o.items[i].idx, o.items[i].protocol, o.items[i].human, o.items[i].apy_bps / 100, o.items[i].apy_bps % 100);
    if (o.n != 3) { printf("FAIL expected 3 venues\n"); fails++; }
    if (strcmp(o.asset, "WETH")) { printf("FAIL asset\n"); fails++; }
    if (o.items[0].apy_bps != 397 || strcmp(o.items[0].human, "Spark")) { printf("FAIL first row\n"); fails++; }
    if (o.items[2].idx != 2) { printf("FAIL idx\n"); fails++; }
    if (!options_expired(&o, o.expires_at + 1) || options_expired(&o, o.expires_at - 1) || options_expired(&o, 0)) { printf("FAIL expiry\n"); fails++; }

    // Refusals: a proposal is not a card; an empty card is not a card.
    const char *prop = "{\"type\":\"proposal\",\"id\":\"x\"}";
    if (options_parse(prop, strlen(prop), &o, err, sizeof err)) { printf("FAIL accepted a proposal\n"); fails++; }
    const char *empty = "{\"type\":\"options\",\"id\":\"x\",\"asset\":\"WETH\",\"items\":[]}";
    if (options_parse(empty, strlen(empty), &o, err, sizeof err)) { printf("FAIL accepted an empty card\n"); fails++; }
    // More than three rows: the extra ones are dropped, not fatal.
    const char *four = "{\"type\":\"options\",\"id\":\"x\",\"asset\":\"WETH\",\"items\":["
        "{\"idx\":0,\"human\":\"a\",\"apyBps\":1},{\"idx\":1,\"human\":\"b\",\"apyBps\":2},"
        "{\"idx\":2,\"human\":\"c\",\"apyBps\":3},{\"idx\":3,\"human\":\"d\",\"apyBps\":4}]}";
    if (!options_parse(four, strlen(four), &o, err, sizeof err) || o.n != 3) { printf("FAIL four rows: %s\n", err); fails++; }
    printf("%s\n", fails ? "FAILED" : "options parser ok");
    return fails ? 1 : 0;
}
