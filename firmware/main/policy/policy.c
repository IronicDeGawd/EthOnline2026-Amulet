#include "policy.h"
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <ctype.h>

static int hexval(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// Exact-length hex (with or without 0x) into bytes. Own copy so the host test needs no
// other firmware file.
bool policy_hex_to_bytes(const char *hex, uint8_t *out, size_t len)
{
    if (hex[0] == '0' && (hex[1] == 'x' || hex[1] == 'X')) hex += 2;
    if (strlen(hex) != len * 2) return false;
    for (size_t i = 0; i < len; i++) {
        int a = hexval(hex[2 * i]), b = hexval(hex[2 * i + 1]);
        if (a < 0 || b < 0) return false;
        out[i] = (uint8_t)((a << 4) | b);
    }
    return true;
}

// Decimal string to a 32-byte big-endian number: multiply-by-ten across the bytes.
bool policy_dec_to_be32(const char *dec, uint8_t out[32])
{
    memset(out, 0, 32);
    if (!*dec) return false;
    for (; *dec; dec++) {
        if (!isdigit((unsigned char)*dec)) return false;
        unsigned carry = (unsigned)(*dec - '0');
        for (int i = 31; i >= 0; i--) {
            unsigned v = out[i] * 10u + carry;
            out[i] = (uint8_t)(v & 0xff);
            carry = v >> 8;
        }
        if (carry) return false;   // more than 256 bits
    }
    return true;
}

// "1.40" -> 140; tolerant of "1.4" and "1".
static bool parse_x100(const char *s, uint16_t *out)
{
    if (!s || !*s) return false;
    unsigned whole = 0, frac = 0, digits = 0;
    for (; isdigit((unsigned char)*s); s++) whole = whole * 10 + (unsigned)(*s - '0');
    if (*s == '.') for (s++; isdigit((unsigned char)*s) && digits < 2; s++, digits++) frac = frac * 10 + (unsigned)(*s - '0');
    if (digits == 1) frac *= 10;
    *out = (uint16_t)(whole * 100 + frac);
    return true;
}

// "0xTarget:0xsel,0xsel;0xTarget:0xsel"
static bool parse_allowed(policy_t *p, const char *s)
{
    p->nallowed = 0;
    while (*s) {
        if (p->nallowed == POLICY_MAX_TARGETS) return false;
        policy_target_t *t = &p->allowed[p->nallowed];
        memset(t, 0, sizeof *t);
        const char *colon = strchr(s, ':');
        const char *end = strchr(s, ';');
        if (!end) end = s + strlen(s);
        if (!colon || colon > end) return false;
        char addr[43];
        size_t alen = (size_t)(colon - s);
        if (alen >= sizeof addr) return false;
        memcpy(addr, s, alen); addr[alen] = 0;
        if (!policy_hex_to_bytes(addr, t->addr, 20)) return false;
        const char *q = colon + 1;
        while (q < end) {
            if (t->nsel == POLICY_MAX_SELECTORS) return false;
            const char *comma = memchr(q, ',', (size_t)(end - q));
            const char *e = comma ? comma : end;
            char sel[11];
            size_t slen = (size_t)(e - q);
            if (slen >= sizeof sel) return false;
            memcpy(sel, q, slen); sel[slen] = 0;
            if (!policy_hex_to_bytes(sel, t->sel[t->nsel], 4)) return false;
            t->nsel++;
            q = comma ? comma + 1 : end;
        }
        p->nallowed++;
        s = *end ? end + 1 : end;
    }
    return p->nallowed > 0;
}

bool policy_parse(policy_t *p, const char *version, const char *chain, const char *allowed,
                  const char *max_value_wei, const char *tier1_hf, const char *tier2_hf)
{
    memset(p, 0, sizeof *p);
    if (!version || !chain || !allowed || !max_value_wei) return false;
    p->version = (uint32_t)strtoul(version, NULL, 10);
    p->chain = strtoull(chain, NULL, 10);
    if (p->version == 0 || p->chain == 0) return false;
    if (!parse_allowed(p, allowed)) return false;
    if (!policy_dec_to_be32(max_value_wei, p->max_value_wei)) return false;
    if (!parse_x100(tier1_hf, &p->tier1_hf_x100)) p->tier1_hf_x100 = 140;
    if (!parse_x100(tier2_hf, &p->tier2_hf_x100)) p->tier2_hf_x100 = 125;
    p->valid = true;
    return true;
}

static void say(char *reason, size_t cap, const char *s) { if (reason && cap) snprintf(reason, cap, "%s", s); }

bool policy_within(const policy_t *p, const amulet_proposal_t *q, int64_t now_unix, char *reason, size_t cap)
{
    if (q->tier == 0) return true;   // advisory: nothing to sign
    if (!p || !p->valid) { say(reason, cap, "No policy on the pendant yet"); return false; }
    if (q->chain_id != p->chain) { say(reason, cap, "Wrong chain for this policy"); return false; }
    const policy_target_t *t = NULL;
    for (int i = 0; i < p->nallowed; i++) if (!memcmp(p->allowed[i].addr, q->to, 20)) { t = &p->allowed[i]; break; }
    if (!t) { say(reason, cap, "Target is not in the policy"); return false; }
    if (q->data_len > 0) {
        bool ok = false;
        if (q->data_len >= 4) for (int i = 0; i < t->nsel; i++) if (!memcmp(t->sel[i], q->data, 4)) { ok = true; break; }
        if (!ok) { say(reason, cap, "Call not allowed on this target"); return false; }
    }
    if (memcmp(q->value, p->max_value_wei, 32) > 0) { say(reason, cap, "Value over the policy cap"); return false; }
    if (q->gas < 21000 || q->gas > 10000000) { say(reason, cap, "Gas limit out of range"); return false; }
    if (q->expires_at && now_unix && now_unix > q->expires_at) { say(reason, cap, "Proposal already expired"); return false; }
    return true;
}
