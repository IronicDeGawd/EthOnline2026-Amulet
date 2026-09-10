// An agent's face, small enough to live in an ENS text record and be read by the pendant
// itself rather than handed to it by the brain. Sixteen rows of sixteen pixels, one bit each,
// plus a colour: 35 bytes, 48 characters of base64. The same drawing also goes into the
// standard `avatar` record as an SVG, so a wallet shows the agent the same way the wrist does.
export const FACE_PX = 16;

export interface Face {
  colour: string; // "RRGGBB"
  rows: string[]; // FACE_PX strings of FACE_PX characters, "." empty and anything else ink
}

// Hand-drawn so each one reads at a glance on a 32 mm screen: a shield that guards, an arrow
// that pays down, a sprout that looks for yield.
export const FACES: Record<string, Face> = {
  // A little guard robot: an antenna, two eyes punched out of the head, a mouth slot, feet.
  repay: {
    colour: "2f9e44",
    rows: [
      "................",
      ".......##.......",
      ".......##.......",
      "...##########...",
      "..############..",
      "..############..",
      "..##..####..##..",
      "..##..####..##..",
      "..############..",
      "..###......###..",
      "..############..",
      "...##########...",
      "....##....##....",
      "....##....##....",
      "...###....###...",
      "................",
    ],
  },
  // A sprout in a pot: two leaves, a stem, and a pot to stand in.
  yield: {
    colour: "b8901f",
    rows: [
      "................",
      ".....##...##....",
      "....####.####...",
      "....#########...",
      ".....#######....",
      "......#####.....",
      ".......###......",
      ".......###......",
      "....#..###..#...",
      "...###.###.###..",
      "...#########.#..",
      "....#######.....",
      ".......###......",
      "................",
      "...##########...",
      "...##########...",
    ],
  },
};

// Rows to bits, most significant bit leftmost, two bytes per row.
export function packFace(f: Face): Uint8Array {
  const out = new Uint8Array(3 + (FACE_PX * FACE_PX) / 8);
  out[0] = parseInt(f.colour.slice(0, 2), 16);
  out[1] = parseInt(f.colour.slice(2, 4), 16);
  out[2] = parseInt(f.colour.slice(4, 6), 16);
  f.rows.forEach((row, y) => {
    for (let x = 0; x < FACE_PX; x++) {
      if (row[x] && row[x] !== ".") out[3 + y * 2 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  });
  return out;
}

export function faceRecord(f: Face): string {
  return Buffer.from(packFace(f)).toString("base64");
}

// The same drawing as an SVG data URI, so any wallet that reads `avatar` shows the agent's
// face too. One rect per run of ink keeps it small.
export function faceAvatar(f: Face): string {
  const parts: string[] = [];
  f.rows.forEach((row, y) => {
    let x = 0;
    while (x < FACE_PX) {
      if (row[x] && row[x] !== ".") {
        let w = 1;
        while (x + w < FACE_PX && row[x + w] && row[x + w] !== ".") w++;
        parts.push(`<rect x="${x}" y="${y}" width="${w}" height="1"/>`);
        x += w;
      } else x++;
    }
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FACE_PX} ${FACE_PX}" shape-rendering="crispEdges">` +
    `<rect width="${FACE_PX}" height="${FACE_PX}" fill="#0b1018"/>` +
    `<g fill="#${f.colour}">${parts.join("")}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
