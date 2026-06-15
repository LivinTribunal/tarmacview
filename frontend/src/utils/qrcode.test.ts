import { describe, it, expect } from "vitest";
import { encodeQrMatrix, qrMatrixToPath } from "./qrcode";

/** asserts the standard 7x7 finder pattern with its 1-module light separator. */
function assertFinder(matrix: boolean[][], cx: number, cy: number): void {
  const size = matrix.length;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      expect(matrix[y][x]).toBe(dist !== 2 && dist !== 4);
    }
  }
}

describe("encodeQrMatrix", () => {
  it("produces a square matrix sized version*4+17", () => {
    const m = encodeQrMatrix("https://192.168.8.50:8443");
    // 25-byte byte-mode payload at ecc M lands on version 2 (25x25)
    expect(m.length).toBe(25);
    expect(m.every((row) => row.length === 25)).toBe(true);
  });

  it("draws the three finder patterns at the corners", () => {
    const m = encodeQrMatrix("HUB");
    const size = m.length;
    assertFinder(m, 3, 3);
    assertFinder(m, size - 4, 3);
    assertFinder(m, 3, size - 4);
    // and NOT a finder in the bottom-right corner
    expect(m[size - 4][size - 4]).toBe(false);
  });

  it("draws alternating timing patterns on row and column 6", () => {
    const m = encodeQrMatrix("HUB");
    const size = m.length;
    // between the finders the timing track alternates dark/light
    for (let i = 8; i < size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  it("encodes a recoverable format-information block (ecc + mask)", () => {
    const m = encodeQrMatrix("HUB", "M");
    // read the 15 format bits from the first copy around the top-left finder
    const read = (x: number, y: number, i: number) => (m[y][x] ? 1 : 0) << i;
    let bits = 0;
    for (let i = 0; i <= 5; i++) bits |= read(8, i, i);
    bits |= read(8, 7, 6);
    bits |= read(8, 8, 7);
    bits |= read(7, 8, 8);
    for (let i = 9; i < 15; i++) bits |= read(14 - i, 8, i);
    const value = bits ^ 0x5412;
    // a valid format codeword has a zero BCH remainder against 0x537
    let rem = value;
    for (let i = 14; i >= 10; i--) {
      if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    }
    expect(rem & 0x3ff).toBe(0);
    // top 2 bits encode the ecc level - M maps to format bits 0
    expect((value >>> 13) & 0x3).toBe(0);
  });

  it("grows the version as the payload grows", () => {
    const small = encodeQrMatrix("A");
    const large = encodeQrMatrix("A".repeat(200));
    expect(large.length).toBeGreaterThan(small.length);
  });

  it("is deterministic for the same input", () => {
    const a = encodeQrMatrix("https://hub.local:8443");
    const b = encodeQrMatrix("https://hub.local:8443");
    expect(a).toEqual(b);
  });

  it("throws when the payload cannot fit any version", () => {
    expect(() => encodeQrMatrix("x".repeat(8000))).toThrow();
  });
});

describe("qrMatrixToPath", () => {
  it("emits one path segment per dark module, offset by the border", () => {
    const matrix = [
      [true, false],
      [false, true],
    ];
    const path = qrMatrixToPath(matrix, 4);
    expect(path).toBe("M4,4h1v1h-1zM5,5h1v1h-1z");
  });

  it("returns an empty string for an all-light matrix", () => {
    expect(qrMatrixToPath([[false, false], [false, false]])).toBe("");
  });
});
