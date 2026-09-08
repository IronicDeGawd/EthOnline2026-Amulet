#include "keccak.h"
#include <string.h>

static const uint64_t RC[24] = {
    0x0000000000000001ULL,0x0000000000008082ULL,0x800000000000808aULL,0x8000000080008000ULL,
    0x000000000000808bULL,0x0000000080000001ULL,0x8000000080008081ULL,0x8000000000008009ULL,
    0x000000000000008aULL,0x0000000000000088ULL,0x0000000080008009ULL,0x000000008000000aULL,
    0x000000008000808bULL,0x800000000000008bULL,0x8000000000008089ULL,0x8000000000008003ULL,
    0x8000000000008002ULL,0x8000000000000080ULL,0x000000000000800aULL,0x800000008000000aULL,
    0x8000000080008081ULL,0x8000000000008080ULL,0x0000000080000001ULL,0x8000000080008008ULL};
static const int ROT[24] = {1,3,6,10,15,21,28,36,45,55,2,14,27,41,56,8,25,43,62,18,39,61,20,44};
static const int PI[24]  = {10,7,11,17,18,3,5,16,8,21,24,4,15,23,19,13,12,2,20,14,22,9,6,1};

#define ROL(x, n) (((x) << (n)) | ((x) >> (64 - (n))))

static void keccakf(uint64_t s[25])
{
    for (int r = 0; r < 24; r++) {
        uint64_t bc[5], t;
        for (int i = 0; i < 5; i++) bc[i] = s[i] ^ s[i+5] ^ s[i+10] ^ s[i+15] ^ s[i+20];
        for (int i = 0; i < 5; i++) {
            t = bc[(i+4)%5] ^ ROL(bc[(i+1)%5], 1);
            for (int j = 0; j < 25; j += 5) s[j+i] ^= t;
        }
        t = s[1];
        for (int i = 0; i < 24; i++) { int j = PI[i]; bc[0] = s[j]; s[j] = ROL(t, ROT[i]); t = bc[0]; }
        for (int j = 0; j < 25; j += 5) {
            for (int i = 0; i < 5; i++) bc[i] = s[j+i];
            for (int i = 0; i < 5; i++) s[j+i] ^= (~bc[(i+1)%5]) & bc[(i+2)%5];
        }
        s[0] ^= RC[r];
    }
}

void keccak256(const uint8_t *in, size_t len, uint8_t out[32])
{
    uint64_t s[25]; uint8_t tmp[136]; const size_t rate = 136;
    memset(s, 0, sizeof s);
    while (len >= rate) {
        for (size_t i = 0; i < rate / 8; i++) { uint64_t w; memcpy(&w, in + 8*i, 8); s[i] ^= w; }
        keccakf(s); in += rate; len -= rate;
    }
    memset(tmp, 0, rate); memcpy(tmp, in, len);
    tmp[len] ^= 0x01; tmp[rate - 1] ^= 0x80;
    for (size_t i = 0; i < rate / 8; i++) { uint64_t w; memcpy(&w, tmp + 8*i, 8); s[i] ^= w; }
    keccakf(s);
    memcpy(out, s, 32);
}
