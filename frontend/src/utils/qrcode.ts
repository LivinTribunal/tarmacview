// minimal byte-mode QR code generator with no npm dependency - the
// package-lock is protected, so the field-hub connect QR is rendered inline.
// adapted from the public-domain "QR Code generator" algorithm by Project
// Nayuki: versions 1-40, all four ecc levels, automatic mask selection.

export type EccLevel = "L" | "M" | "Q" | "H";

const MIN_VERSION = 1;
const MAX_VERSION = 40;

// mask-penalty constants from the QR spec
const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

// error-correction level -> table row index (L=0, M=1, Q=2, H=3)
const ECC_ORDINAL: Record<EccLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
// ordinal -> the 2-bit value baked into the format-info bits
const ECC_FORMAT_BITS = [1, 0, 3, 2];

// ecc codewords per block, indexed [ordinal][version] (version 0 unused)
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// error-correction blocks per version, indexed [ordinal][version]
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

function appendBits(value: number, len: number, buffer: number[]): void {
  for (let i = len - 1; i >= 0; i--) buffer.push((value >>> i) & 1);
}

function toUtf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

// byte mode: 8-bit char count for v1-9, 16-bit for v10-40
function byteModeCharCountBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

function getNumRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function getNumDataCodewords(version: number, eclIdx: number): number {
  return (
    Math.floor(getNumRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[eclIdx][version] *
      NUM_ERROR_CORRECTION_BLOCKS[eclIdx][version]
  );
}

// ---- reed-solomon over GF(256) with primitive polynomial 0x11d ----

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = reedSolomonMultiply(root, 0x02);
  }
  return result;
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= reedSolomonMultiply(coef, factor);
    });
  }
  return result;
}

// splits the data codewords into blocks, appends ecc, and interleaves them
function addEccAndInterleave(
  data: number[],
  version: number,
  eclIdx: number,
): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eclIdx][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eclIdx][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const rsDiv = reedSolomonComputeDivisor(blockEccLen);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const ecc = reedSolomonComputeRemainder(dat, rsDiv);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      // skip the padding cell that short blocks carry at the data boundary
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(block[i]);
      }
    });
  }
  return result;
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

function buildMatrix(
  version: number,
  eclIdx: number,
  allCodewords: number[],
): boolean[][] {
  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    new Array<boolean>(size).fill(false),
  );

  function setFunctionModule(x: number, y: number, isDark: boolean): void {
    modules[y][x] = isDark;
    isFunction[y][x] = true;
  }

  function drawFinderPattern(cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = cx + dx;
        const yy = cy + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) {
          setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  function drawAlignmentPattern(cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        setFunctionModule(
          cx + dx,
          cy + dy,
          Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
        );
      }
    }
  }

  function drawFormatBits(mask: number): void {
    const dataVal = (ECC_FORMAT_BITS[eclIdx] << 3) | mask;
    let rem = dataVal;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((dataVal << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getBit(bits, i));
    setFunctionModule(8, 7, getBit(bits, 6));
    setFunctionModule(8, 8, getBit(bits, 7));
    setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getBit(bits, i));
    for (let i = 0; i < 8; i++) setFunctionModule(size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) setFunctionModule(8, size - 15 + i, getBit(bits, i));
    setFunctionModule(8, size - 8, true);
  }

  function drawVersion(): void {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunctionModule(a, b, bit);
      setFunctionModule(b, a, bit);
    }
  }

  // timing patterns
  for (let i = 0; i < size; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }
  // three finder patterns (top-left, top-right, bottom-left)
  drawFinderPattern(3, 3);
  drawFinderPattern(size - 4, 3);
  drawFinderPattern(3, size - 4);
  // alignment patterns, skipping the three finder corners
  const alignPos = alignmentPositions(version, size);
  const numAlign = alignPos.length;
  for (let i = 0; i < numAlign; i++) {
    for (let j = 0; j < numAlign; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === numAlign - 1) ||
        (i === numAlign - 1 && j === 0);
      if (!corner) drawAlignmentPattern(alignPos[i], alignPos[j]);
    }
  }
  // reserve the configuration cells (real values drawn after masking)
  drawFormatBits(0);
  drawVersion();

  // place the data + ecc codewords in the zigzag pattern
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    const col = right === 6 ? 5 : right; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = col - j;
        const upward = ((col + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && bitIndex < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  function applyMask(mask: number): void {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) modules[y][x] = !modules[y][x];
      }
    }
  }

  function finderPenaltyCountPatterns(runHistory: number[]): number {
    const n = runHistory[1];
    const core =
      n > 0 &&
      runHistory[2] === n &&
      runHistory[3] === n * 3 &&
      runHistory[4] === n &&
      runHistory[5] === n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0)
    );
  }

  function finderPenaltyAddHistory(runLength: number, runHistory: number[]): void {
    if (runHistory[0] === 0) runLength += size; // light border on the first run
    runHistory.pop();
    runHistory.unshift(runLength);
  }

  function finderPenaltyTerminate(
    runColor: boolean,
    runLength: number,
    runHistory: number[],
  ): number {
    if (runColor) {
      finderPenaltyAddHistory(runLength, runHistory);
      runLength = 0;
    }
    runLength += size; // light border on the final run
    finderPenaltyAddHistory(runLength, runHistory);
    return finderPenaltyCountPatterns(runHistory);
  }

  // penalty contributed by one row/column scan (N1 runs + N3 finder patterns)
  function scanAxis(at: (i: number) => boolean): number {
    let penalty = 0;
    let runColor = false;
    let runLen = 0;
    const runHistory = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < size; i++) {
      if (at(i) === runColor) {
        runLen++;
        if (runLen === 5) penalty += PENALTY_N1;
        else if (runLen > 5) penalty++;
      } else {
        finderPenaltyAddHistory(runLen, runHistory);
        if (!runColor) penalty += finderPenaltyCountPatterns(runHistory) * PENALTY_N3;
        runColor = at(i);
        runLen = 1;
      }
    }
    penalty += finderPenaltyTerminate(runColor, runLen, runHistory) * PENALTY_N3;
    return penalty;
  }

  function getPenaltyScore(): number {
    let result = 0;
    // runs in rows
    for (let y = 0; y < size; y++) result += scanAxis((x) => modules[y][x]);
    // runs in columns
    for (let x = 0; x < size; x++) result += scanAxis((y) => modules[y][x]);
    // 2x2 blocks of one color
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          result += PENALTY_N2;
        }
      }
    }
    // dark/light balance
    let dark = 0;
    for (const row of modules) for (const c of row) if (c) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * PENALTY_N4;
    return result;
  }

  // pick the mask with the lowest penalty
  let bestMask = 0;
  let minPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormatBits(mask);
    const penalty = getPenaltyScore();
    if (penalty < minPenalty) {
      bestMask = mask;
      minPenalty = penalty;
    }
    applyMask(mask); // xor is its own inverse
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);

  return modules;
}

/**
 * encodes `text` into a square QR matrix (true = dark module, no quiet zone).
 * throws when the text is too long for the largest QR version at this ecc.
 */
export function encodeQrMatrix(text: string, ecl: EccLevel = "M"): boolean[][] {
  const eclIdx = ECC_ORDINAL[ecl];
  const data = toUtf8Bytes(text);

  // smallest version that fits byte-mode data at this ecc level
  let version = MIN_VERSION;
  let dataCapacityBits = 0;
  for (;; version++) {
    if (version > MAX_VERSION) throw new Error("data too long for a QR code");
    dataCapacityBits = getNumDataCodewords(version, eclIdx) * 8;
    const usedBits = 4 + byteModeCharCountBits(version) + data.length * 8;
    if (usedBits <= dataCapacityBits) break;
  }

  const bb: number[] = [];
  appendBits(0x4, 4, bb); // byte mode indicator
  appendBits(data.length, byteModeCharCountBits(version), bb);
  for (const b of data) appendBits(b, 8, bb);

  // terminator, byte alignment, then alternating pad bytes
  appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
  appendBits(0, (8 - (bb.length % 8)) % 8, bb);
  for (let pad = 0xec; bb.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bb);
  }

  const dataCodewords = new Array<number>(bb.length / 8).fill(0);
  bb.forEach((bit, i) => {
    dataCodewords[i >>> 3] |= bit << (7 - (i & 7));
  });

  const allCodewords = addEccAndInterleave(dataCodewords, version, eclIdx);
  return buildMatrix(version, eclIdx, allCodewords);
}

/**
 * builds an SVG `<path>` d-string covering the dark modules, in module units,
 * offset by `border` quiet-zone modules. pair with a viewBox of
 * `0 0 (size + 2*border) (size + 2*border)`.
 */
export function qrMatrixToPath(matrix: boolean[][], border = 0): string {
  const parts: string[] = [];
  for (let y = 0; y < matrix.length; y++) {
    for (let x = 0; x < matrix.length; x++) {
      if (matrix[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}
