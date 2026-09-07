"""Fake Ledger Nano X BLE peripheral for pendant transport testing.

Speaks the Ledger BLE framing (tag | seq u16 BE | len u16 BE on seq 0 | payload) with
the real Nano X UUIDs. Answers GET VERSION (0x00), ECHO (0x02), GET MTU (0x08) and a
tiny subset of Ethereum app APDUs (GET PUBLIC KEY, SIGN TX) with canned bytes.
It cannot rehearse pairing/bonding. Run:  python fake_nano_x.py [--mtu 20]
"""
import argparse, asyncio, logging, sys
from bless import BlessServer, BlessGATTCharacteristic, GATTCharacteristicProperties, GATTAttributePermissions

SERVICE = "13d63400-2c97-0004-0000-4c6564676572"
NOTIFY  = "13d63400-2c97-0004-0001-4c6564676572"
WRITE   = "13d63400-2c97-0004-0002-4c6564676572"

TAG_VERSION, TAG_INIT, TAG_ECHO, TAG_APDU, TAG_MTU, TAG_ERR = 0x00, 0x01, 0x02, 0x05, 0x08, 0x0E

# Canned Ethereum app responses (not real keys — deterministic filler for byte-level tests).
FAKE_PUBKEY = bytes([0x04]) + bytes(range(1, 65))
FAKE_ADDR   = b"742d35cc6634c0532925a3b844bc454e4438f44e"
FAKE_SIG    = bytes([0x01]) + bytes([0xAA] * 32) + bytes([0xBB] * 32)

log = logging.getLogger("fake-ledger")


class FakeLedger:
    def __init__(self, mtu: int):
        self.mtu = mtu              # value we report in GET MTU; also our notify chunk size
        self.rx_tag = None
        self.rx_expected = 0
        self.rx_seq = 0
        self.rx_buf = bytearray()
        self.server: BlessServer | None = None
        self.loop = asyncio.get_event_loop()

    # ---- framing -------------------------------------------------------------
    def on_write(self, char: BlessGATTCharacteristic, value: bytearray, **kw):
        data = bytes(value)
        if len(data) < 3:
            log.warning("short frame %s", data.hex()); return
        tag, seq = data[0], int.from_bytes(data[1:3], "big")
        if seq == 0:
            if len(data) < 5: log.warning("short first frame"); return
            self.rx_tag, self.rx_expected = tag, int.from_bytes(data[3:5], "big")
            self.rx_buf = bytearray(data[5:]); self.rx_seq = 0
        else:
            if tag != self.rx_tag or seq != self.rx_seq + 1:
                log.error("seq/tag mismatch tag=%02x seq=%d (want %02x/%d)", tag, seq, self.rx_tag, self.rx_seq + 1)
                self.loop.call_soon(self.send, TAG_ERR, b"\x01"); return
            self.rx_seq = seq; self.rx_buf += data[3:]
        log.info("rx frame tag=%02x seq=%d len=%d (have %d/%d)", tag, seq, len(data), len(self.rx_buf), self.rx_expected)
        if len(self.rx_buf) >= self.rx_expected:
            payload = bytes(self.rx_buf[: self.rx_expected])
            self.loop.call_soon(self.handle, self.rx_tag, payload)

    def send(self, tag: int, payload: bytes):
        first_cap, cont_cap = self.mtu - 5, self.mtu - 3
        frames = [bytes([tag]) + (0).to_bytes(2, "big") + len(payload).to_bytes(2, "big") + payload[:first_cap]]
        rest, seq = payload[first_cap:], 1
        while rest:
            frames.append(bytes([tag]) + seq.to_bytes(2, "big") + rest[:cont_cap]); rest = rest[cont_cap:]; seq += 1
        asyncio.ensure_future(self._notify_frames(frames))

    async def _notify_frames(self, frames):
        ch = self.server.get_characteristic(NOTIFY)
        for f in frames:
            ch.value = bytearray(f)
            ok = self.server.update_value(SERVICE, NOTIFY)
            log.info("tx frame %s update_value=%s", f.hex(), ok)
            await asyncio.sleep(0.01)

    # ---- command handling ------------------------------------------------------
    def handle(self, tag: int, payload: bytes):
        if tag == TAG_VERSION: self.send(TAG_VERSION, b"\x00\x00\x00\x00")
        elif tag == TAG_INIT:  self.rx_buf.clear(); self.send(TAG_INIT, b"")
        elif tag == TAG_ECHO:  self.send(TAG_ECHO, payload)
        elif tag == TAG_MTU:   self.send(TAG_MTU, bytes([self.mtu]))
        elif tag == TAG_APDU:  self.send(TAG_APDU, self.apdu(payload))
        else:                  self.send(TAG_ERR, bytes([tag]))

    def apdu(self, a: bytes) -> bytes:
        if len(a) < 5: return b"\x67\x00"
        cla, ins, p1, p2, lc = a[0], a[1], a[2], a[3], a[4]
        data = a[5:5 + lc]
        log.info("APDU cla=%02x ins=%02x p1=%02x p2=%02x lc=%d data=%s", cla, ins, p1, p2, lc, data.hex())
        if cla != 0xE0: return b"\x6e\x00"
        if ins == 0x02:   # GET PUBLIC KEY → pubkey_len, pubkey, addr_len, addr ascii, [chaincode]
            n = data[0] if data else 0
            path = [int.from_bytes(data[1 + 4*i: 5 + 4*i], "big") for i in range(n)]
            log.info("  path %s", "/".join(f"{p & 0x7fffffff}{chr(39) if p & 0x80000000 else ''}" for p in path))
            return bytes([len(FAKE_PUBKEY)]) + FAKE_PUBKEY + bytes([len(FAKE_ADDR)]) + FAKE_ADDR + b"\x90\x00"
        if ins == 0x04:   # SIGN TX: first chunk (p1=00) has path; reply only on last chunk — we can't know, so reply every time
            return FAKE_SIG + b"\x90\x00" if p1 == 0x80 or True else b"\x90\x00"
        return b"\x6d\x00"


async def main(mtu: int):
    logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    dev = FakeLedger(mtu)
    server = BlessServer(name="Nano X FAKE", loop=asyncio.get_event_loop())
    dev.server = server
    server.write_request_func = dev.on_write
    server.read_request_func = lambda ch, **kw: ch.value
    await server.add_new_service(SERVICE)
    await server.add_new_characteristic(SERVICE, NOTIFY, GATTCharacteristicProperties.notify,
                                        None, GATTAttributePermissions.readable)
    await server.add_new_characteristic(SERVICE, WRITE, GATTCharacteristicProperties.write,
                                        None, GATTAttributePermissions.writeable)
    await server.start()
    log.info("advertising as 'Nano X FAKE' service %s mtu=%d — Ctrl-C to stop", SERVICE, mtu)
    try:
        while True: await asyncio.sleep(1)
    finally:
        await server.stop()

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--mtu", type=int, default=20)
    asyncio.run(main(ap.parse_args().mtu))
