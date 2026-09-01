/**
 * Creates a mutable bit writer that packs appended bits into QR codewords.
 */
function createBitBuffer() {
    const bits = [];
    return {
        get length() {
            return bits.length;
        },
        append(value, bitLength) {
            if (bitLength < 0 || bitLength > 31 || value >>> bitLength !== 0) {
                throw new RangeError(`Value ${value} does not fit in ${bitLength} bits`);
            }
            for (let i = bitLength - 1; i >= 0; i--) {
                bits.push((value >>> i) & 1);
            }
        },
        toCodewords() {
            const result = [];
            for (let i = 0; i < bits.length; i += 8) {
                let value = 0;
                for (let j = 0; j < 8; j++) {
                    value = (value << 1) | (bits[i + j] ?? 0);
                }
                result.push(value);
            }
            return result;
        }
    };
}

/**
 * Builds the Reed-Solomon generator polynomial coefficients used by QR Code.
 */
function reedSolomonComputeDivisor(degree) {
    if (degree < 1 || degree > 255) {
        throw new RangeError("Reed-Solomon degree must be between 1 and 255");
    }
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < result.length; j++) {
            result[j] = reedSolomonMultiply(result[j], root);
            if (j + 1 < result.length) {
                result[j] ^= result[j + 1];
            }
        }
        root = reedSolomonMultiply(root, 0x02);
    }
    return result;
}
function reedSolomonComputeRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const byte of data) {
        const head = result.shift();
        if (head === undefined) {
            throw new Error("Invalid Reed-Solomon divisor");
        }
        const factor = byte ^ head;
        result.push(0);
        for (let i = 0; i < divisor.length; i++) {
            result[i] = (result[i] ?? 0) ^ reedSolomonMultiply(divisor[i] ?? 0, factor);
        }
    }
    return result;
}
function reedSolomonMultiply(x, y) {
    if ((x >>> 8) !== 0 || (y >>> 8) !== 0) {
        throw new RangeError("Reed-Solomon operands must be bytes");
    }
    let result = 0;
    for (let i = 7; i >= 0; i--) {
        // GF(2^8) multiplication modulo x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
        result = (result << 1) ^ ((result >>> 7) * 0x11d);
        result ^= ((y >>> i) & 1) * x;
    }
    return result & 0xff;
}

const ECC_FORMAT_BITS = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2
};
const ECC_CODEWORDS_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
};
const NUM_ERROR_CORRECTION_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
};
const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function getErrorCorrectionFormatBits(errorCorrectionLevel) {
    return ECC_FORMAT_BITS[errorCorrectionLevel];
}
function getAlphanumericValue(char) {
    return ALPHANUMERIC_CHARSET.indexOf(char);
}
function isAlphanumericChar(char) {
    return getAlphanumericValue(char) >= 0;
}
function canFitDataBits(dataBits, version, errorCorrectionLevel) {
    return dataBits <= getDataCapacityBits(version, errorCorrectionLevel);
}
function getDataCapacityBits(version, errorCorrectionLevel) {
    return getNumDataCodewords(version, errorCorrectionLevel) * 8;
}
function getErrorCorrectionBlockLayout(version, errorCorrectionLevel) {
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[errorCorrectionLevel][version];
    const blockEccLength = ECC_CODEWORDS_PER_BLOCK[errorCorrectionLevel][version];
    if (numBlocks === undefined || blockEccLength === undefined) {
        throw new RangeError(`Invalid QR version ${version}`);
    }
    const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLength = Math.floor(rawCodewords / numBlocks);
    return {
        rawCodewords,
        numBlocks,
        blockEccLength,
        numShortBlocks,
        shortDataBlockLength: shortBlockLength - blockEccLength
    };
}
/**
 * Number of writable modules after subtracting function patterns, before byte rounding.
 */
function getNumRawDataModules(version) {
    let result = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const numAlign = Math.floor(version / 7) + 2;
        result -= (25 * numAlign - 10) * numAlign - 55;
        if (version >= 7) {
            result -= 36;
        }
    }
    return result;
}
function getNumDataCodewords(version, errorCorrectionLevel) {
    const { rawCodewords, blockEccLength, numBlocks } = getErrorCorrectionBlockLayout(version, errorCorrectionLevel);
    return rawCodewords - blockEccLength * numBlocks;
}

const MODE_INDICATORS = {
    numeric: 0b0001,
    alphanumeric: 0b0010,
    byte: 0b0100
};
const CHARACTER_COUNT_BITS = {
    numeric: [10, 12, 14],
    alphanumeric: [9, 11, 13],
    byte: [8, 16, 16]
};
const textEncoder = new TextEncoder();
function makeSegment(input, requestedMode = "auto") {
    if (input instanceof Uint8Array) {
        if (requestedMode !== "auto" && requestedMode !== "byte") {
            throw new TypeError("Uint8Array input can only be encoded in byte mode");
        }
        return makeByteSegment(input);
    }
    const mode = requestedMode === "auto" ? pickTextMode(input) : requestedMode;
    if (mode === "numeric") {
        return makeNumericSegment(input);
    }
    if (mode === "alphanumeric") {
        return makeAlphanumericSegment(input);
    }
    return makeByteSegment(textEncoder.encode(input));
}
function getTotalBits(segment, version) {
    const countBits = getCharacterCountBits(segment.mode, version);
    if (segment.characterCount >= 1 << countBits) {
        return undefined;
    }
    return 4 + countBits + segment.dataBitLength;
}
function appendSegment(buffer, segment, version) {
    buffer.append(MODE_INDICATORS[segment.mode], 4);
    buffer.append(segment.characterCount, getCharacterCountBits(segment.mode, version));
    segment.appendData(buffer);
}
function pickTextMode(input) {
    // Numeric and alphanumeric modes pack more characters into fewer bits than byte mode.
    if (/^[0-9]*$/.test(input)) {
        return "numeric";
    }
    if ([...input].every(isAlphanumericChar)) {
        return "alphanumeric";
    }
    return "byte";
}
function makeNumericSegment(input) {
    if (!/^[0-9]*$/.test(input)) {
        throw new TypeError("Numeric QR mode only accepts digits 0-9");
    }
    return {
        mode: "numeric",
        characterCount: input.length,
        // Numeric mode stores groups of 3, 2, and 1 digits in 10, 7, and 4 bits.
        dataBitLength: Math.floor(input.length / 3) * 10 + (input.length % 3 === 1 ? 4 : input.length % 3 === 2 ? 7 : 0),
        appendData(buffer) {
            for (let i = 0; i < input.length; i += 3) {
                const chunk = input.slice(i, i + 3);
                buffer.append(Number.parseInt(chunk, 10), chunk.length === 3 ? 10 : chunk.length === 2 ? 7 : 4);
            }
        }
    };
}
function makeAlphanumericSegment(input) {
    const indexes = [...input].map(getAlphanumericValue);
    if (indexes.some((index) => index < 0)) {
        throw new TypeError("Alphanumeric QR mode only accepts digits, uppercase letters, space, and $%*+-./:");
    }
    return {
        mode: "alphanumeric",
        characterCount: indexes.length,
        // Alphanumeric mode stores pairs as a base-45 value, with a 6-bit tail.
        dataBitLength: Math.floor(indexes.length / 2) * 11 + (indexes.length % 2) * 6,
        appendData(buffer) {
            for (let i = 0; i < indexes.length; i += 2) {
                const first = indexes[i];
                const second = indexes[i + 1];
                if (first === undefined) {
                    throw new Error("Invalid alphanumeric index");
                }
                if (second === undefined) {
                    buffer.append(first, 6);
                }
                else {
                    buffer.append(first * 45 + second, 11);
                }
            }
        }
    };
}
function makeByteSegment(bytes) {
    const data = new Uint8Array(bytes);
    return {
        mode: "byte",
        characterCount: data.length,
        dataBitLength: data.length * 8,
        appendData(buffer) {
            for (const byte of data) {
                buffer.append(byte, 8);
            }
        }
    };
}
function getCharacterCountBits(mode, version) {
    const groupIndex = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    return CHARACTER_COUNT_BITS[mode][groupIndex];
}

/**
 * Builds the data codeword stream before Reed-Solomon error correction.
 */
function createDataCodewords(segment, version, errorCorrectionLevel, dataUsedBits) {
    const dataCapacityBits = getDataCapacityBits(version, errorCorrectionLevel);
    const buffer = createBitBuffer();
    appendSegment(buffer, segment, version);
    if (buffer.length !== dataUsedBits) {
        throw new Error("Internal QR bit length mismatch");
    }
    // QR payloads end with a short terminator, byte alignment, then alternating pad bytes.
    buffer.append(0, Math.min(4, dataCapacityBits - buffer.length));
    buffer.append(0, (8 - (buffer.length % 8)) % 8);
    const codewords = buffer.toCodewords();
    for (let padByte = 0xec; codewords.length < dataCapacityBits / 8; padByte ^= 0xec ^ 0x11) {
        codewords.push(padByte);
    }
    return codewords;
}
/**
 * Splits data into QR blocks, appends Reed-Solomon parity, then interleaves them.
 */
function addErrorCorrectionAndInterleave(data, version, errorCorrectionLevel) {
    const layout = getErrorCorrectionBlockLayout(version, errorCorrectionLevel);
    const rsDivisor = reedSolomonComputeDivisor(layout.blockEccLength);
    const blocks = createBlocks(data, layout.numBlocks, layout.numShortBlocks, layout.shortDataBlockLength, rsDivisor);
    return interleaveBlocks(blocks, layout.rawCodewords, layout.shortDataBlockLength, layout.numShortBlocks);
}
function createBlocks(data, numBlocks, numShortBlocks, shortDataBlockLength, rsDivisor) {
    const blocks = [];
    let dataOffset = 0;
    // QR interleaves Reed-Solomon blocks column-wise; short blocks use a dummy byte
    // to make this loop shape match the spec tables without adding it to output.
    for (let i = 0; i < numBlocks; i++) {
        const dataBlockLength = shortDataBlockLength + (i < numShortBlocks ? 0 : 1);
        const dataBlock = Array.from(data.slice(dataOffset, dataOffset + dataBlockLength));
        dataOffset += dataBlockLength;
        const eccBlock = reedSolomonComputeRemainder(dataBlock, rsDivisor);
        const block = dataBlock.slice();
        if (i < numShortBlocks) {
            block.push(0);
        }
        block.push(...eccBlock);
        blocks.push(block);
    }
    return blocks;
}
function interleaveBlocks(blocks, rawCodewords, shortDataBlockLength, numShortBlocks) {
    const result = [];
    const blockLength = blocks[0]?.length;
    if (blockLength === undefined) {
        throw new Error("QR data must contain at least one block");
    }
    for (let i = 0; i < blockLength; i++) {
        for (let j = 0; j < blocks.length; j++) {
            if (i !== shortDataBlockLength || j >= numShortBlocks) {
                const value = blocks[j]?.[i];
                if (value !== undefined) {
                    result.push(value);
                }
            }
        }
    }
    if (result.length !== rawCodewords) {
        throw new Error("Internal QR interleaving length mismatch");
    }
    return result;
}

/**
 * Creates the mutable matrix used while building a QR symbol.
 */
function createMatrixState(version, errorCorrectionLevel) {
    const size = version * 4 + 17;
    return {
        version,
        size,
        errorCorrectionLevel,
        modules: createMatrix(size, false),
        isFunction: createMatrix(size, false)
    };
}
function setFunctionModule(state, x, y, isDark) {
    state.modules[y][x] = isDark;
    state.isFunction[y][x] = true;
}
/**
 * Places interleaved data/ecc codewords into non-function modules.
 */
function drawCodewords(state, data) {
    let bitIndex = 0;
    // Data bits move upward/downward through two-column stripes from the lower right.
    for (let right = state.size - 1; right >= 1; right -= 2) {
        if (right === 6) {
            right = 5;
        }
        for (let vertical = 0; vertical < state.size; vertical++) {
            const upward = ((right + 1) & 2) === 0;
            const y = upward ? state.size - 1 - vertical : vertical;
            drawCodewordColumnPair(state, data, right, y, bitIndex);
            bitIndex += countWritableModulesInPair(state, right, y);
        }
    }
}
/**
 * Toggles non-function modules according to a QR mask pattern.
 */
function applyMask(state, mask) {
    for (let y = 0; y < state.size; y++) {
        for (let x = 0; x < state.size; x++) {
            if (!state.isFunction[y][x] && getMaskBit(mask, x, y)) {
                state.modules[y][x] = !state.modules[y][x];
            }
        }
    }
}
/**
 * Freezes the mutable matrix into the public immutable QR code shape.
 */
function toQrCode(state, maskPattern) {
    const modules = state.modules.map((row) => row.slice());
    const size = state.size;
    return {
        version: state.version,
        size,
        errorCorrectionLevel: state.errorCorrectionLevel,
        maskPattern,
        modules,
        isDark(row, column) {
            if (row < 0 || row >= size || column < 0 || column >= size || !Number.isInteger(row) || !Number.isInteger(column)) {
                throw new RangeError("QR module coordinates are out of range");
            }
            return modules[row][column];
        }
    };
}
function drawCodewordColumnPair(state, data, right, y, startBitIndex) {
    let bitIndex = startBitIndex;
    for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (!state.isFunction[y][x]) {
            const byte = data[bitIndex >>> 3];
            state.modules[y][x] = byte === undefined ? false : (((byte >>> (7 - (bitIndex & 7))) & 1) !== 0);
            bitIndex++;
        }
    }
}
function countWritableModulesInPair(state, right, y) {
    let result = 0;
    for (let j = 0; j < 2; j++) {
        if (!state.isFunction[y][right - j]) {
            result++;
        }
    }
    return result;
}
function createMatrix(size, value) {
    return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}
function getMaskBit(mask, x, y) {
    switch (mask) {
        case 0:
            return (x + y) % 2 === 0;
        case 1:
            return y % 2 === 0;
        case 2:
            return x % 3 === 0;
        case 3:
            return (x + y) % 3 === 0;
        case 4:
            return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5:
            return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6:
            return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case 7:
            return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        default:
            throw new RangeError("mask must be an integer from 0 to 7");
    }
}

/**
 * Draws all reserved QR function modules before data placement.
 */
function drawFunctionPatterns(state) {
    drawFinderPattern(state, 3, 3);
    drawFinderPattern(state, state.size - 4, 3);
    drawFinderPattern(state, 3, state.size - 4);
    drawTimingPatterns(state);
    drawAlignmentPatterns(state);
    drawFormatBits(state, 0);
    drawVersionBits(state);
}
/**
 * Draws error-correction and mask metadata into the QR format information areas.
 */
function drawFormatBits(state, mask) {
    const data = (getErrorCorrectionFormatBits(state.errorCorrectionLevel) << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) {
        remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    }
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i++) {
        setFunctionModule(state, 8, i, getBit(bits, i));
    }
    setFunctionModule(state, 8, 7, getBit(bits, 6));
    setFunctionModule(state, 8, 8, getBit(bits, 7));
    setFunctionModule(state, 7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) {
        setFunctionModule(state, 14 - i, 8, getBit(bits, i));
    }
    for (let i = 0; i < 8; i++) {
        setFunctionModule(state, state.size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i++) {
        setFunctionModule(state, 8, state.size - 15 + i, getBit(bits, i));
    }
    setFunctionModule(state, 8, state.size - 8, true);
}
function drawFinderPattern(state, centerX, centerY) {
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const x = centerX + dx;
            const y = centerY + dy;
            if (x >= 0 && x < state.size && y >= 0 && y < state.size) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                setFunctionModule(state, x, y, distance !== 2 && distance !== 4);
            }
        }
    }
}
function drawTimingPatterns(state) {
    for (let i = 8; i < state.size - 8; i++) {
        setFunctionModule(state, 6, i, i % 2 === 0);
        setFunctionModule(state, i, 6, i % 2 === 0);
    }
}
function drawAlignmentPatterns(state) {
    const alignments = getAlignmentPatternPositions(state.version);
    for (const y of alignments) {
        for (const x of alignments) {
            if (!state.isFunction[y][x]) {
                drawAlignmentPattern(state, x, y);
            }
        }
    }
}
function drawAlignmentPattern(state, centerX, centerY) {
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
            setFunctionModule(state, centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }
}
function drawVersionBits(state) {
    if (state.version < 7) {
        return;
    }
    let remainder = state.version;
    for (let i = 0; i < 12; i++) {
        remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = (state.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
        const bit = getBit(bits, i);
        const a = state.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunctionModule(state, a, b, bit);
        setFunctionModule(state, b, a, bit);
    }
}
function getAlignmentPatternPositions(version) {
    if (version === 1) {
        return [];
    }
    const size = version * 4 + 17;
    const count = Math.floor(version / 7) + 2;
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];
    for (let position = size - 7; result.length < count; position -= step) {
        result.splice(1, 0, position);
    }
    return result;
}
function getBit(value, index) {
    return ((value >>> index) & 1) !== 0;
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;
/**
 * Pure QR mask penalty score for an already-masked module matrix.
 */
function getPenaltyScore(modules) {
    return (countRunPenalty(modules) +
        countBlockPenalty(modules) +
        countFinderLikePatternPenalty(modules) +
        countBalancePenalty(modules));
}
function countRunPenalty(modules) {
    let result = 0;
    for (const row of modules) {
        result += countLineRunPenalty(row);
    }
    for (let column = 0; column < modules.length; column++) {
        result += countLineRunPenalty(modules.map((row) => row[column] ?? false));
    }
    return result;
}
function countBlockPenalty(modules) {
    let result = 0;
    for (let y = 0; y < modules.length - 1; y++) {
        for (let x = 0; x < modules.length - 1; x++) {
            const color = modules[y]?.[x];
            if (color === modules[y]?.[x + 1] && color === modules[y + 1]?.[x] && color === modules[y + 1]?.[x + 1]) {
                result += PENALTY_N2;
            }
        }
    }
    return result;
}
function countFinderLikePatternPenalty(modules) {
    const size = modules.length;
    let result = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size - 10; x++) {
            if (hasFinderLikePattern((offset) => modules[y]?.[x + offset] ?? false)) {
                result += PENALTY_N3;
            }
        }
    }
    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size - 10; y++) {
            if (hasFinderLikePattern((offset) => modules[y + offset]?.[x] ?? false)) {
                result += PENALTY_N3;
            }
        }
    }
    return result;
}
function countBalancePenalty(modules) {
    let dark = 0;
    for (const row of modules) {
        for (const module of row) {
            if (module) {
                dark++;
            }
        }
    }
    const total = modules.length * modules.length;
    const fivePercentSteps = Math.floor(Math.abs(dark * 20 - total * 10) / total);
    return fivePercentSteps * PENALTY_N4;
}
function countLineRunPenalty(line) {
    let result = 0;
    let runColor = false;
    let runLength = 0;
    for (const module of line) {
        if (module === runColor) {
            runLength++;
            if (runLength === 5) {
                result += PENALTY_N1;
            }
            else if (runLength > 5) {
                result++;
            }
        }
        else {
            runColor = module;
            runLength = 1;
        }
    }
    return result;
}
function hasFinderLikePattern(get) {
    // Penalize the 1:1:3:1:1 finder-like run with four light modules on either side.
    return (get(0) &&
        !get(1) &&
        get(2) &&
        get(3) &&
        get(4) &&
        !get(5) &&
        get(6) &&
        !get(7) &&
        !get(8) &&
        !get(9) &&
        !get(10)) || (!get(0) &&
        !get(1) &&
        !get(2) &&
        !get(3) &&
        get(4) &&
        !get(5) &&
        get(6) &&
        get(7) &&
        get(8) &&
        !get(9) &&
        get(10));
}

/**
 * Applies all eight mask patterns and returns the one with the lowest penalty score.
 */
function findBestMask(state) {
    let bestMask = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (let mask = 0; mask < 8; mask++) {
        const penalty = scoreMask(state, mask);
        if (penalty < bestPenalty) {
            bestMask = mask;
            bestPenalty = penalty;
        }
    }
    return bestMask;
}
function scoreMask(state, mask) {
    applyMask(state, mask);
    drawFormatBits(state, mask);
    const penalty = getPenaltyScore(state.modules);
    applyMask(state, mask);
    return penalty;
}

/**
 * Builds and freezes a QR symbol from the final interleaved codeword stream.
 *
 * This module owns the mutable symbol layout sequence: function patterns,
 * reserved modules, data placement, mask selection/application, format bits,
 * and conversion to the public immutable `QrCode` shape.
 */
function createQrSymbol(version, errorCorrectionLevel, codewords, requestedMaskPattern) {
    const matrix = createMatrixState(version, errorCorrectionLevel);
    drawFunctionPatterns(matrix);
    drawCodewords(matrix, codewords);
    const selectedMask = requestedMaskPattern ?? findBestMask(matrix);
    applyMask(matrix, selectedMask);
    drawFormatBits(matrix, selectedMask);
    return toQrCode(matrix, selectedMask);
}

const MIN_VERSION = 1;
const MAX_VERSION = 40;
function validateVersion(version) {
    if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
        throw new RangeError("QR version must be an integer from 1 to 40");
    }
}
function validateMaskPattern(maskPattern) {
    if (!Number.isInteger(maskPattern) || maskPattern < 0 || maskPattern > 7) {
        throw new RangeError("maskPattern must be an integer from 0 to 7");
    }
}
function validateErrorCorrectionLevel(level) {
    if (level !== "L" && level !== "M" && level !== "Q" && level !== "H") {
        throw new RangeError("errorCorrectionLevel must be L, M, Q, or H");
    }
}

/**
 * Generates a QR Code Model 2 matrix from a string or byte payload.
 */
function createQrCode(input, options = {}) {
    const errorCorrectionLevel = resolveErrorCorrectionLevel(options);
    const { minVersion, maxVersion } = resolveVersionRange(options);
    const maskPattern = resolveMaskPattern(options);
    const segment = makeSegment(input, options.mode ?? "auto");
    const { version, dataUsedBits } = chooseVersion(segment, minVersion, maxVersion, errorCorrectionLevel);
    const dataCodewords = createDataCodewords(segment, version, errorCorrectionLevel, dataUsedBits);
    const allCodewords = addErrorCorrectionAndInterleave(dataCodewords, version, errorCorrectionLevel);
    return createQrSymbol(version, errorCorrectionLevel, allCodewords, maskPattern);
}
function resolveErrorCorrectionLevel(options) {
    const errorCorrectionLevel = options.errorCorrectionLevel ?? "M";
    validateErrorCorrectionLevel(errorCorrectionLevel);
    return errorCorrectionLevel;
}
function resolveVersionRange(options) {
    const minVersion = options.version ?? options.minVersion ?? MIN_VERSION;
    const maxVersion = options.version ?? options.maxVersion ?? MAX_VERSION;
    validateVersion(minVersion);
    validateVersion(maxVersion);
    if (minVersion > maxVersion) {
        throw new RangeError("minVersion must be less than or equal to maxVersion");
    }
    return { minVersion, maxVersion };
}
function resolveMaskPattern(options) {
    if (options.maskPattern === undefined) {
        return undefined;
    }
    validateMaskPattern(options.maskPattern);
    return options.maskPattern;
}
function chooseVersion(segment, minVersion, maxVersion, errorCorrectionLevel) {
    for (let version = minVersion; version <= maxVersion; version++) {
        const dataUsedBits = getTotalBits(segment, version);
        if (dataUsedBits !== undefined && canFitDataBits(dataUsedBits, version, errorCorrectionLevel)) {
            return { version, dataUsedBits };
        }
    }
    throw new RangeError(`Input data does not fit in QR versions ${minVersion}-${maxVersion} with error correction ${errorCorrectionLevel}`);
}

const DEFAULT_MODULE_SIZE = 4;
const DEFAULT_MARGIN = 4;
const DEFAULT_FOREGROUND = "#000";
const DEFAULT_BACKGROUND = "#fff";
const DEFAULT_ICON_SIZE_RATIO = 0.18;
const DEFAULT_ICON_PADDING_RATIO = 0.03;
const DEFAULT_ICON_BACKGROUND = "#fff";
/**
 * Renders a QR matrix as a standalone SVG string.
 */
function renderSvg(qr, options = {}) {
    const moduleSize = options.moduleSize ?? DEFAULT_MODULE_SIZE;
    const margin = options.margin ?? DEFAULT_MARGIN;
    const foreground = options.foreground ?? DEFAULT_FOREGROUND;
    const background = options.background ?? DEFAULT_BACKGROUND;
    if (!Number.isFinite(moduleSize) || moduleSize <= 0) {
        throw new RangeError("moduleSize must be a positive number");
    }
    if (!Number.isFinite(margin) || margin < 0) {
        throw new RangeError("margin must be a non-negative number");
    }
    const viewBoxSize = qr.size + margin * 2;
    const outputSize = viewBoxSize * moduleSize;
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${formatNumber(viewBoxSize)} ${formatNumber(viewBoxSize)}" width="${formatNumber(outputSize)}" height="${formatNumber(outputSize)}" shape-rendering="crispEdges" role="img">`
    ];
    if (options.title !== undefined) {
        parts.push(`<title>${escapeText(options.title)}</title>`);
    }
    parts.push(`<rect width="100%" height="100%" fill="${escapeAttribute(background)}"/>`);
    // One path is much smaller than one rect per dark module and keeps the SVG easy to embed.
    parts.push(`<path fill="${escapeAttribute(foreground)}" d="${makePathData(qr, margin)}"/>`);
    if (options.icon !== undefined) {
        parts.push(renderIcon(qr.size, margin, options.icon));
    }
    parts.push("</svg>");
    return parts.join("");
}
function makePathData(qr, margin) {
    const commands = [];
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (qr.modules[y]?.[x]) {
                commands.push(`M${formatNumber(x + margin)} ${formatNumber(y + margin)}h1v1h-1z`);
            }
        }
    }
    return commands.join("");
}
function renderIcon(size, margin, icon) {
    const sizeRatio = icon.sizeRatio ?? DEFAULT_ICON_SIZE_RATIO;
    const paddingRatio = icon.paddingRatio ?? DEFAULT_ICON_PADDING_RATIO;
    const background = icon.background ?? DEFAULT_ICON_BACKGROUND;
    const radius = icon.radius ?? 0;
    if (!Number.isFinite(sizeRatio) || sizeRatio <= 0 || sizeRatio >= 0.5) {
        throw new RangeError("icon.sizeRatio must be greater than 0 and less than 0.5");
    }
    if (!Number.isFinite(paddingRatio) || paddingRatio < 0 || paddingRatio >= 0.25) {
        throw new RangeError("icon.paddingRatio must be greater than or equal to 0 and less than 0.25");
    }
    if (!Number.isFinite(radius) || radius < 0) {
        throw new RangeError("icon.radius must be a non-negative number");
    }
    const iconSize = size * sizeRatio;
    const padding = size * paddingRatio;
    const patchSize = iconSize + padding * 2;
    const center = margin + size / 2;
    const patchX = center - patchSize / 2;
    const iconX = center - iconSize / 2;
    const radiusAttribute = radius > 0 ? ` rx="${formatNumber(radius)}" ry="${formatNumber(radius)}"` : "";
    return [
        `<rect x="${formatNumber(patchX)}" y="${formatNumber(patchX)}" width="${formatNumber(patchSize)}" height="${formatNumber(patchSize)}" fill="${escapeAttribute(background)}"${radiusAttribute}/>`,
        `<image href="${escapeAttribute(icon.href)}" x="${formatNumber(iconX)}" y="${formatNumber(iconX)}" width="${formatNumber(iconSize)}" height="${formatNumber(iconSize)}" preserveAspectRatio="xMidYMid meet"/>`
    ].join("");
}
function escapeAttribute(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
function escapeText(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
function formatNumber(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * Convenience helper that creates a QR matrix and renders it as SVG.
 */
function toSvg(input, options = {}) {
    const qrOptions = {
        errorCorrectionLevel: options.errorCorrectionLevel ?? (options.icon === undefined ? "M" : "H")
    };
    if (options.version !== undefined)
        qrOptions.version = options.version;
    if (options.minVersion !== undefined)
        qrOptions.minVersion = options.minVersion;
    if (options.maxVersion !== undefined)
        qrOptions.maxVersion = options.maxVersion;
    if (options.maskPattern !== undefined)
        qrOptions.maskPattern = options.maskPattern;
    if (options.mode !== undefined)
        qrOptions.mode = options.mode;
    return renderSvg(createQrCode(input, qrOptions), options);
}

export { createQrCode, renderSvg, toSvg };
//# sourceMappingURL=index.js.map
