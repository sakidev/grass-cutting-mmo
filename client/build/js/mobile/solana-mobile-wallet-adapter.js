(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// Main entry point for browserified Solana Mobile Wallet Adapter
const { 
  transact,
  SolanaMobileWalletAdapterError,
  SolanaMobileWalletAdapterErrorCode,
  SolanaMobileWalletAdapterProtocolError,
  SolanaMobileWalletAdapterProtocolErrorCode
} = require('@solana-mobile/mobile-wallet-adapter-protocol');

// Export everything to the global window object for vanilla JS usage
module.exports.SolanaMobileWalletAdapter = {
  transact,
  SolanaMobileWalletAdapterError,
  SolanaMobileWalletAdapterErrorCode,
  SolanaMobileWalletAdapterProtocolError,
  SolanaMobileWalletAdapterProtocolErrorCode,
  
  // Helper function for easier usage
  async connectWallet() {
    console.log(">>> CONNECTING TO WALLET");
    return await transact(async (wallet) => {
      try {
        console.log(">>> AUTHORIZING WALLET");
        const authResult = await wallet.authorize({
          cluster: window.PRODUCTION ? 'mainnet-beta' : 'devnet',
          identity: {
            name: 'FLAPN',
            uri: "https://flapn.fun",
            icon: 'favicon.ico'
          }
        });
        console.log(">>> AUTHORIZATION RESULT", authResult);

        return authResult;
      } catch (error) {
        console.error('Authorization failed:', error);
        throw error;
      }
    });
  },

  // Helper function to sign messages
  async signMessages(authToken, messages) {
    return await transact(async (wallet) => {
      const { signed_payloads } = await wallet.signMessages({
        auth_token: authToken,
        payloads: messages
      });
      return signed_payloads;
    });
  },

  // Helper function to sign transactions
  async signTransactions(authToken, transactions) {
    return await transact(async (wallet) => {
      const { signed_transactions } = await wallet.signTransactions({
        auth_token: authToken,
        transactions: transactions
      });
      return signed_transactions;
    });
  },

  // Helper function to sign and send transactions
  async signAndSendTransactions(authToken, transactions) {
    return await transact(async (wallet) => {
      const { signatures } = await wallet.signAndSendTransactions({
        auth_token: authToken,
        transactions: transactions
      });
      return signatures;
    });
  }
};

window.SolanaMobileWalletAdapter = module.exports.SolanaMobileWalletAdapter;
},{"@solana-mobile/mobile-wallet-adapter-protocol":14}],2:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wNAF = void 0;
exports.negateCt = negateCt;
exports.normalizeZ = normalizeZ;
exports.mulEndoUnsafe = mulEndoUnsafe;
exports.pippenger = pippenger;
exports.precomputeMSMUnsafe = precomputeMSMUnsafe;
exports.validateBasic = validateBasic;
exports._createCurveFields = _createCurveFields;
/**
 * Methods for elliptic curve multiplication by scalars.
 * Contains wNAF, pippenger.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const modular_ts_1 = require("./modular.js");
const _0n = BigInt(0);
const _1n = BigInt(1);
function negateCt(condition, item) {
    const neg = item.negate();
    return condition ? neg : item;
}
/**
 * Takes a bunch of Projective Points but executes only one
 * inversion on all of them. Inversion is very slow operation,
 * so this improves performance massively.
 * Optimization: converts a list of projective points to a list of identical points with Z=1.
 */
function normalizeZ(c, points) {
    const invertedZs = (0, modular_ts_1.FpInvertBatch)(c.Fp, points.map((p) => p.Z));
    return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
    if (!Number.isSafeInteger(W) || W <= 0 || W > bits)
        throw new Error('invalid window size, expected [1..' + bits + '], got W=' + W);
}
function calcWOpts(W, scalarBits) {
    validateW(W, scalarBits);
    const windows = Math.ceil(scalarBits / W) + 1; // W=8 33. Not 32, because we skip zero
    const windowSize = 2 ** (W - 1); // W=8 128. Not 256, because we skip zero
    const maxNumber = 2 ** W; // W=8 256
    const mask = (0, utils_ts_1.bitMask)(W); // W=8 255 == mask 0b11111111
    const shiftBy = BigInt(W); // W=8 8
    return { windows, windowSize, mask, maxNumber, shiftBy };
}
function calcOffsets(n, window, wOpts) {
    const { windowSize, mask, maxNumber, shiftBy } = wOpts;
    let wbits = Number(n & mask); // extract W bits.
    let nextN = n >> shiftBy; // shift number by W bits.
    // What actually happens here:
    // const highestBit = Number(mask ^ (mask >> 1n));
    // let wbits2 = wbits - 1; // skip zero
    // if (wbits2 & highestBit) { wbits2 ^= Number(mask); // (~);
    // split if bits > max: +224 => 256-32
    if (wbits > windowSize) {
        // we skip zero, which means instead of `>= size-1`, we do `> size`
        wbits -= maxNumber; // -32, can be maxNumber - wbits, but then we need to set isNeg here.
        nextN += _1n; // +256 (carry)
    }
    const offsetStart = window * windowSize;
    const offset = offsetStart + Math.abs(wbits) - 1; // -1 because we skip zero
    const isZero = wbits === 0; // is current window slice a 0?
    const isNeg = wbits < 0; // is current window slice negative?
    const isNegF = window % 2 !== 0; // fake random statement for noise
    const offsetF = offsetStart; // fake offset for noise
    return { nextN, offset, isZero, isNeg, isNegF, offsetF };
}
function validateMSMPoints(points, c) {
    if (!Array.isArray(points))
        throw new Error('array expected');
    points.forEach((p, i) => {
        if (!(p instanceof c))
            throw new Error('invalid point at index ' + i);
    });
}
function validateMSMScalars(scalars, field) {
    if (!Array.isArray(scalars))
        throw new Error('array of scalars expected');
    scalars.forEach((s, i) => {
        if (!field.isValid(s))
            throw new Error('invalid scalar at index ' + i);
    });
}
// Since points in different groups cannot be equal (different object constructor),
// we can have single place to store precomputes.
// Allows to make points frozen / immutable.
const pointPrecomputes = new WeakMap();
const pointWindowSizes = new WeakMap();
function getW(P) {
    // To disable precomputes:
    // return 1;
    return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
    if (n !== _0n)
        throw new Error('invalid wNAF');
}
/**
 * Elliptic curve multiplication of Point by scalar. Fragile.
 * Table generation takes **30MB of ram and 10ms on high-end CPU**,
 * but may take much longer on slow devices. Actual generation will happen on
 * first call of `multiply()`. By default, `BASE` point is precomputed.
 *
 * Scalars should always be less than curve order: this should be checked inside of a curve itself.
 * Creates precomputation tables for fast multiplication:
 * - private scalar is split by fixed size windows of W bits
 * - every window point is collected from window's table & added to accumulator
 * - since windows are different, same point inside tables won't be accessed more than once per calc
 * - each multiplication is 'Math.ceil(CURVE_ORDER / 𝑊) + 1' point additions (fixed for any scalar)
 * - +1 window is neccessary for wNAF
 * - wNAF reduces table size: 2x less memory + 2x faster generation, but 10% slower multiplication
 *
 * @todo Research returning 2d JS array of windows, instead of a single window.
 * This would allow windows to be in different memory locations
 */
class wNAF {
    // Parametrized with a given Point class (not individual point)
    constructor(Point, bits) {
        this.BASE = Point.BASE;
        this.ZERO = Point.ZERO;
        this.Fn = Point.Fn;
        this.bits = bits;
    }
    // non-const time multiplication ladder
    _unsafeLadder(elm, n, p = this.ZERO) {
        let d = elm;
        while (n > _0n) {
            if (n & _1n)
                p = p.add(d);
            d = d.double();
            n >>= _1n;
        }
        return p;
    }
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @param point Point instance
     * @param W window size
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(point, W) {
        const { windows, windowSize } = calcWOpts(W, this.bits);
        const points = [];
        let p = point;
        let base = p;
        for (let window = 0; window < windows; window++) {
            base = p;
            points.push(base);
            // i=1, bc we skip 0
            for (let i = 1; i < windowSize; i++) {
                base = base.add(p);
                points.push(base);
            }
            p = base.double();
        }
        return points;
    }
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * More compact implementation:
     * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n) {
        // Scalar should be smaller than field order
        if (!this.Fn.isValid(n))
            throw new Error('invalid scalar');
        // Accumulators
        let p = this.ZERO;
        let f = this.BASE;
        // This code was first written with assumption that 'f' and 'p' will never be infinity point:
        // since each addition is multiplied by 2 ** W, it cannot cancel each other. However,
        // there is negate now: it is possible that negated element from low value
        // would be the same as high element, which will create carry into next window.
        // It's not obvious how this can fail, but still worth investigating later.
        const wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows; window++) {
            // (n === _0n) is handled and not early-exited. isEven and offsetF are used for noise
            const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
            n = nextN;
            if (isZero) {
                // bits are 0: add garbage to fake point
                // Important part for const-time getPublicKey: add random "noise" point to f.
                f = f.add(negateCt(isNegF, precomputes[offsetF]));
            }
            else {
                // bits are 1: add to result point
                p = p.add(negateCt(isNeg, precomputes[offset]));
            }
        }
        assert0(n);
        // Return both real and fake points: JIT won't eliminate f.
        // At this point there is a way to F be infinity-point even if p is not,
        // which makes it less const-time: around 1 bigint multiply.
        return { p, f };
    }
    /**
     * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
     * @param acc accumulator point to add result of multiplication
     * @returns point
     */
    wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
        const wo = calcWOpts(W, this.bits);
        for (let window = 0; window < wo.windows; window++) {
            if (n === _0n)
                break; // Early-exit, skip 0 value
            const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
            n = nextN;
            if (isZero) {
                // Window bits are 0: skip processing.
                // Move to next window.
                continue;
            }
            else {
                const item = precomputes[offset];
                acc = acc.add(isNeg ? item.negate() : item); // Re-using acc allows to save adds in MSM
            }
        }
        assert0(n);
        return acc;
    }
    getPrecomputes(W, point, transform) {
        // Calculate precomputes on a first run, reuse them after
        let comp = pointPrecomputes.get(point);
        if (!comp) {
            comp = this.precomputeWindow(point, W);
            if (W !== 1) {
                // Doing transform outside of if brings 15% perf hit
                if (typeof transform === 'function')
                    comp = transform(comp);
                pointPrecomputes.set(point, comp);
            }
        }
        return comp;
    }
    cached(point, scalar, transform) {
        const W = getW(point);
        return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
    }
    unsafe(point, scalar, transform, prev) {
        const W = getW(point);
        if (W === 1)
            return this._unsafeLadder(point, scalar, prev); // For W=1 ladder is ~x2 faster
        return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
    }
    // We calculate precomputes for elliptic curve point multiplication
    // using windowed method. This specifies window size and
    // stores precomputed values. Usually only base point would be precomputed.
    createCache(P, W) {
        validateW(W, this.bits);
        pointWindowSizes.set(P, W);
        pointPrecomputes.delete(P);
    }
    hasCache(elm) {
        return getW(elm) !== 1;
    }
}
exports.wNAF = wNAF;
/**
 * Endomorphism-specific multiplication for Koblitz curves.
 * Cost: 128 dbl, 0-256 adds.
 */
function mulEndoUnsafe(Point, point, k1, k2) {
    let acc = point;
    let p1 = Point.ZERO;
    let p2 = Point.ZERO;
    while (k1 > _0n || k2 > _0n) {
        if (k1 & _1n)
            p1 = p1.add(acc);
        if (k2 & _1n)
            p2 = p2.add(acc);
        acc = acc.double();
        k1 >>= _1n;
        k2 >>= _1n;
    }
    return { p1, p2 };
}
/**
 * Pippenger algorithm for multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 * 30x faster vs naive addition on L=4096, 10x faster than precomputes.
 * For N=254bit, L=1, it does: 1024 ADD + 254 DBL. For L=5: 1536 ADD + 254 DBL.
 * Algorithmically constant-time (for same L), even when 1 point + scalar, or when scalar = 0.
 * @param c Curve Point constructor
 * @param fieldN field over CURVE.N - important that it's not over CURVE.P
 * @param points array of L curve points
 * @param scalars array of L scalars (aka secret keys / bigints)
 */
function pippenger(c, fieldN, points, scalars) {
    // If we split scalars by some window (let's say 8 bits), every chunk will only
    // take 256 buckets even if there are 4096 scalars, also re-uses double.
    // TODO:
    // - https://eprint.iacr.org/2024/750.pdf
    // - https://tches.iacr.org/index.php/TCHES/article/view/10287
    // 0 is accepted in scalars
    validateMSMPoints(points, c);
    validateMSMScalars(scalars, fieldN);
    const plength = points.length;
    const slength = scalars.length;
    if (plength !== slength)
        throw new Error('arrays of points and scalars must have equal length');
    // if (plength === 0) throw new Error('array must be of length >= 2');
    const zero = c.ZERO;
    const wbits = (0, utils_ts_1.bitLen)(BigInt(plength));
    let windowSize = 1; // bits
    if (wbits > 12)
        windowSize = wbits - 3;
    else if (wbits > 4)
        windowSize = wbits - 2;
    else if (wbits > 0)
        windowSize = 2;
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const buckets = new Array(Number(MASK) + 1).fill(zero); // +1 for zero array
    const lastBits = Math.floor((fieldN.BITS - 1) / windowSize) * windowSize;
    let sum = zero;
    for (let i = lastBits; i >= 0; i -= windowSize) {
        buckets.fill(zero);
        for (let j = 0; j < slength; j++) {
            const scalar = scalars[j];
            const wbits = Number((scalar >> BigInt(i)) & MASK);
            buckets[wbits] = buckets[wbits].add(points[j]);
        }
        let resI = zero; // not using this will do small speed-up, but will lose ct
        // Skip first bucket, because it is zero
        for (let j = buckets.length - 1, sumI = zero; j > 0; j--) {
            sumI = sumI.add(buckets[j]);
            resI = resI.add(sumI);
        }
        sum = sum.add(resI);
        if (i !== 0)
            for (let j = 0; j < windowSize; j++)
                sum = sum.double();
    }
    return sum;
}
/**
 * Precomputed multi-scalar multiplication (MSM, Pa + Qb + Rc + ...).
 * @param c Curve Point constructor
 * @param fieldN field over CURVE.N - important that it's not over CURVE.P
 * @param points array of L curve points
 * @returns function which multiplies points with scaars
 */
function precomputeMSMUnsafe(c, fieldN, points, windowSize) {
    /**
     * Performance Analysis of Window-based Precomputation
     *
     * Base Case (256-bit scalar, 8-bit window):
     * - Standard precomputation requires:
     *   - 31 additions per scalar × 256 scalars = 7,936 ops
     *   - Plus 255 summary additions = 8,191 total ops
     *   Note: Summary additions can be optimized via accumulator
     *
     * Chunked Precomputation Analysis:
     * - Using 32 chunks requires:
     *   - 255 additions per chunk
     *   - 256 doublings
     *   - Total: (255 × 32) + 256 = 8,416 ops
     *
     * Memory Usage Comparison:
     * Window Size | Standard Points | Chunked Points
     * ------------|-----------------|---------------
     *     4-bit   |     520         |      15
     *     8-bit   |    4,224        |     255
     *    10-bit   |   13,824        |   1,023
     *    16-bit   |  557,056        |  65,535
     *
     * Key Advantages:
     * 1. Enables larger window sizes due to reduced memory overhead
     * 2. More efficient for smaller scalar counts:
     *    - 16 chunks: (16 × 255) + 256 = 4,336 ops
     *    - ~2x faster than standard 8,191 ops
     *
     * Limitations:
     * - Not suitable for plain precomputes (requires 256 constant doublings)
     * - Performance degrades with larger scalar counts:
     *   - Optimal for ~256 scalars
     *   - Less efficient for 4096+ scalars (Pippenger preferred)
     */
    validateW(windowSize, fieldN.BITS);
    validateMSMPoints(points, c);
    const zero = c.ZERO;
    const tableSize = 2 ** windowSize - 1; // table size (without zero)
    const chunks = Math.ceil(fieldN.BITS / windowSize); // chunks of item
    const MASK = (0, utils_ts_1.bitMask)(windowSize);
    const tables = points.map((p) => {
        const res = [];
        for (let i = 0, acc = p; i < tableSize; i++) {
            res.push(acc);
            acc = acc.add(p);
        }
        return res;
    });
    return (scalars) => {
        validateMSMScalars(scalars, fieldN);
        if (scalars.length > points.length)
            throw new Error('array of scalars must be smaller than array of points');
        let res = zero;
        for (let i = 0; i < chunks; i++) {
            // No need to double if accumulator is still zero.
            if (res !== zero)
                for (let j = 0; j < windowSize; j++)
                    res = res.double();
            const shiftBy = BigInt(chunks * windowSize - (i + 1) * windowSize);
            for (let j = 0; j < scalars.length; j++) {
                const n = scalars[j];
                const curr = Number((n >> shiftBy) & MASK);
                if (!curr)
                    continue; // skip zero scalars chunks
                res = res.add(tables[j][curr - 1]);
            }
        }
        return res;
    };
}
// TODO: remove
/** @deprecated */
function validateBasic(curve) {
    (0, modular_ts_1.validateField)(curve.Fp);
    (0, utils_ts_1.validateObject)(curve, {
        n: 'bigint',
        h: 'bigint',
        Gx: 'field',
        Gy: 'field',
    }, {
        nBitLength: 'isSafeInteger',
        nByteLength: 'isSafeInteger',
    });
    // Set defaults
    return Object.freeze({
        ...(0, modular_ts_1.nLength)(curve.n, curve.nBitLength),
        ...curve,
        ...{ p: curve.Fp.ORDER },
    });
}
function createField(order, field, isLE) {
    if (field) {
        if (field.ORDER !== order)
            throw new Error('Field.ORDER must match order: Fp == p, Fn == n');
        (0, modular_ts_1.validateField)(field);
        return field;
    }
    else {
        return (0, modular_ts_1.Field)(order, { isLE });
    }
}
/** Validates CURVE opts and creates fields */
function _createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
    if (FpFnLE === undefined)
        FpFnLE = type === 'edwards';
    if (!CURVE || typeof CURVE !== 'object')
        throw new Error(`expected valid ${type} CURVE object`);
    for (const p of ['p', 'n', 'h']) {
        const val = CURVE[p];
        if (!(typeof val === 'bigint' && val > _0n))
            throw new Error(`CURVE.${p} must be positive bigint`);
    }
    const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
    const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
    const _b = type === 'weierstrass' ? 'b' : 'd';
    const params = ['Gx', 'Gy', 'a', _b];
    for (const p of params) {
        // @ts-ignore
        if (!Fp.isValid(CURVE[p]))
            throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
    }
    CURVE = Object.freeze(Object.assign({}, CURVE));
    return { CURVE, Fp, Fn };
}

},{"../utils.js":8,"./modular.js":5}],3:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrimeEdwardsPoint = void 0;
exports.edwards = edwards;
exports.eddsa = eddsa;
exports.twistedEdwards = twistedEdwards;
/**
 * Twisted Edwards curve. The formula is: ax² + y² = 1 + dx²y².
 * For design rationale of types / exports, see weierstrass module documentation.
 * Untwisted Edwards curves exist, but they aren't used in real-world protocols.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const curve_ts_1 = require("./curve.js");
const modular_ts_1 = require("./modular.js");
// Be friendly to bad ECMAScript parsers by not using bigint literals
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _8n = BigInt(8);
function isEdValidXY(Fp, CURVE, x, y) {
    const x2 = Fp.sqr(x);
    const y2 = Fp.sqr(y);
    const left = Fp.add(Fp.mul(CURVE.a, x2), y2);
    const right = Fp.add(Fp.ONE, Fp.mul(CURVE.d, Fp.mul(x2, y2)));
    return Fp.eql(left, right);
}
function edwards(params, extraOpts = {}) {
    const validated = (0, curve_ts_1._createCurveFields)('edwards', params, extraOpts, extraOpts.FpFnLE);
    const { Fp, Fn } = validated;
    let CURVE = validated.CURVE;
    const { h: cofactor } = CURVE;
    (0, utils_ts_1._validateObject)(extraOpts, {}, { uvRatio: 'function' });
    // Important:
    // There are some places where Fp.BYTES is used instead of nByteLength.
    // So far, everything has been tested with curves of Fp.BYTES == nByteLength.
    // TODO: test and find curves which behave otherwise.
    const MASK = _2n << (BigInt(Fn.BYTES * 8) - _1n);
    const modP = (n) => Fp.create(n); // Function overrides
    // sqrt(u/v)
    const uvRatio = extraOpts.uvRatio ||
        ((u, v) => {
            try {
                return { isValid: true, value: Fp.sqrt(Fp.div(u, v)) };
            }
            catch (e) {
                return { isValid: false, value: _0n };
            }
        });
    // Validate whether the passed curve params are valid.
    // equation ax² + y² = 1 + dx²y² should work for generator point.
    if (!isEdValidXY(Fp, CURVE, CURVE.Gx, CURVE.Gy))
        throw new Error('bad curve params: generator point');
    /**
     * Asserts coordinate is valid: 0 <= n < MASK.
     * Coordinates >= Fp.ORDER are allowed for zip215.
     */
    function acoord(title, n, banZero = false) {
        const min = banZero ? _1n : _0n;
        (0, utils_ts_1.aInRange)('coordinate ' + title, n, min, MASK);
        return n;
    }
    function aextpoint(other) {
        if (!(other instanceof Point))
            throw new Error('ExtendedPoint expected');
    }
    // Converts Extended point to default (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    const toAffineMemo = (0, utils_ts_1.memoized)((p, iz) => {
        const { X, Y, Z } = p;
        const is0 = p.is0();
        if (iz == null)
            iz = is0 ? _8n : Fp.inv(Z); // 8 was chosen arbitrarily
        const x = modP(X * iz);
        const y = modP(Y * iz);
        const zz = Fp.mul(Z, iz);
        if (is0)
            return { x: _0n, y: _1n };
        if (zz !== _1n)
            throw new Error('invZ was invalid');
        return { x, y };
    });
    const assertValidMemo = (0, utils_ts_1.memoized)((p) => {
        const { a, d } = CURVE;
        if (p.is0())
            throw new Error('bad point: ZERO'); // TODO: optimize, with vars below?
        // Equation in affine coordinates: ax² + y² = 1 + dx²y²
        // Equation in projective coordinates (X/Z, Y/Z, Z):  (aX² + Y²)Z² = Z⁴ + dX²Y²
        const { X, Y, Z, T } = p;
        const X2 = modP(X * X); // X²
        const Y2 = modP(Y * Y); // Y²
        const Z2 = modP(Z * Z); // Z²
        const Z4 = modP(Z2 * Z2); // Z⁴
        const aX2 = modP(X2 * a); // aX²
        const left = modP(Z2 * modP(aX2 + Y2)); // (aX² + Y²)Z²
        const right = modP(Z4 + modP(d * modP(X2 * Y2))); // Z⁴ + dX²Y²
        if (left !== right)
            throw new Error('bad point: equation left != right (1)');
        // In Extended coordinates we also have T, which is x*y=T/Z: check X*Y == Z*T
        const XY = modP(X * Y);
        const ZT = modP(Z * T);
        if (XY !== ZT)
            throw new Error('bad point: equation left != right (2)');
        return true;
    });
    // Extended Point works in extended coordinates: (X, Y, Z, T) ∋ (x=X/Z, y=Y/Z, T=xy).
    // https://en.wikipedia.org/wiki/Twisted_Edwards_curve#Extended_coordinates
    class Point {
        constructor(X, Y, Z, T) {
            this.X = acoord('x', X);
            this.Y = acoord('y', Y);
            this.Z = acoord('z', Z, true);
            this.T = acoord('t', T);
            Object.freeze(this);
        }
        static CURVE() {
            return CURVE;
        }
        static fromAffine(p) {
            if (p instanceof Point)
                throw new Error('extended point not allowed');
            const { x, y } = p || {};
            acoord('x', x);
            acoord('y', y);
            return new Point(x, y, _1n, modP(x * y));
        }
        // Uses algo from RFC8032 5.1.3.
        static fromBytes(bytes, zip215 = false) {
            const len = Fp.BYTES;
            const { a, d } = CURVE;
            bytes = (0, utils_ts_1.copyBytes)((0, utils_ts_1._abytes2)(bytes, len, 'point'));
            (0, utils_ts_1._abool2)(zip215, 'zip215');
            const normed = (0, utils_ts_1.copyBytes)(bytes); // copy again, we'll manipulate it
            const lastByte = bytes[len - 1]; // select last byte
            normed[len - 1] = lastByte & ~0x80; // clear last bit
            const y = (0, utils_ts_1.bytesToNumberLE)(normed);
            // zip215=true is good for consensus-critical apps. =false follows RFC8032 / NIST186-5.
            // RFC8032 prohibits >= p, but ZIP215 doesn't
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            const max = zip215 ? MASK : Fp.ORDER;
            (0, utils_ts_1.aInRange)('point.y', y, _0n, max);
            // Ed25519: x² = (y²-1)/(dy²+1) mod p. Ed448: x² = (y²-1)/(dy²-1) mod p. Generic case:
            // ax²+y²=1+dx²y² => y²-1=dx²y²-ax² => y²-1=x²(dy²-a) => x²=(y²-1)/(dy²-a)
            const y2 = modP(y * y); // denominator is always non-0 mod p.
            const u = modP(y2 - _1n); // u = y² - 1
            const v = modP(d * y2 - a); // v = d y² + 1.
            let { isValid, value: x } = uvRatio(u, v); // √(u/v)
            if (!isValid)
                throw new Error('bad point: invalid y coordinate');
            const isXOdd = (x & _1n) === _1n; // There are 2 square roots. Use x_0 bit to select proper
            const isLastByteOdd = (lastByte & 0x80) !== 0; // x_0, last bit
            if (!zip215 && x === _0n && isLastByteOdd)
                // if x=0 and x_0 = 1, fail
                throw new Error('bad point: x=0 and x_0=1');
            if (isLastByteOdd !== isXOdd)
                x = modP(-x); // if x_0 != x mod 2, set x = p-x
            return Point.fromAffine({ x, y });
        }
        static fromHex(bytes, zip215 = false) {
            return Point.fromBytes((0, utils_ts_1.ensureBytes)('point', bytes), zip215);
        }
        get x() {
            return this.toAffine().x;
        }
        get y() {
            return this.toAffine().y;
        }
        precompute(windowSize = 8, isLazy = true) {
            wnaf.createCache(this, windowSize);
            if (!isLazy)
                this.multiply(_2n); // random number
            return this;
        }
        // Useful in fromAffine() - not for fromBytes(), which always created valid points.
        assertValidity() {
            assertValidMemo(this);
        }
        // Compare one point to another.
        equals(other) {
            aextpoint(other);
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const { X: X2, Y: Y2, Z: Z2 } = other;
            const X1Z2 = modP(X1 * Z2);
            const X2Z1 = modP(X2 * Z1);
            const Y1Z2 = modP(Y1 * Z2);
            const Y2Z1 = modP(Y2 * Z1);
            return X1Z2 === X2Z1 && Y1Z2 === Y2Z1;
        }
        is0() {
            return this.equals(Point.ZERO);
        }
        negate() {
            // Flips point sign to a negative one (-x, y in affine coords)
            return new Point(modP(-this.X), this.Y, this.Z, modP(-this.T));
        }
        // Fast algo for doubling Extended Point.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#doubling-dbl-2008-hwcd
        // Cost: 4M + 4S + 1*a + 6add + 1*2.
        double() {
            const { a } = CURVE;
            const { X: X1, Y: Y1, Z: Z1 } = this;
            const A = modP(X1 * X1); // A = X12
            const B = modP(Y1 * Y1); // B = Y12
            const C = modP(_2n * modP(Z1 * Z1)); // C = 2*Z12
            const D = modP(a * A); // D = a*A
            const x1y1 = X1 + Y1;
            const E = modP(modP(x1y1 * x1y1) - A - B); // E = (X1+Y1)2-A-B
            const G = D + B; // G = D+B
            const F = G - C; // F = G-C
            const H = D - B; // H = D-B
            const X3 = modP(E * F); // X3 = E*F
            const Y3 = modP(G * H); // Y3 = G*H
            const T3 = modP(E * H); // T3 = E*H
            const Z3 = modP(F * G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        // Fast algo for adding 2 Extended Points.
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-extended.html#addition-add-2008-hwcd
        // Cost: 9M + 1*a + 1*d + 7add.
        add(other) {
            aextpoint(other);
            const { a, d } = CURVE;
            const { X: X1, Y: Y1, Z: Z1, T: T1 } = this;
            const { X: X2, Y: Y2, Z: Z2, T: T2 } = other;
            const A = modP(X1 * X2); // A = X1*X2
            const B = modP(Y1 * Y2); // B = Y1*Y2
            const C = modP(T1 * d * T2); // C = T1*d*T2
            const D = modP(Z1 * Z2); // D = Z1*Z2
            const E = modP((X1 + Y1) * (X2 + Y2) - A - B); // E = (X1+Y1)*(X2+Y2)-A-B
            const F = D - C; // F = D-C
            const G = D + C; // G = D+C
            const H = modP(B - a * A); // H = B-a*A
            const X3 = modP(E * F); // X3 = E*F
            const Y3 = modP(G * H); // Y3 = G*H
            const T3 = modP(E * H); // T3 = E*H
            const Z3 = modP(F * G); // Z3 = F*G
            return new Point(X3, Y3, Z3, T3);
        }
        subtract(other) {
            return this.add(other.negate());
        }
        // Constant-time multiplication.
        multiply(scalar) {
            // 1 <= scalar < L
            if (!Fn.isValidNot0(scalar))
                throw new Error('invalid scalar: expected 1 <= sc < curve.n');
            const { p, f } = wnaf.cached(this, scalar, (p) => (0, curve_ts_1.normalizeZ)(Point, p));
            return (0, curve_ts_1.normalizeZ)(Point, [p, f])[0];
        }
        // Non-constant-time multiplication. Uses double-and-add algorithm.
        // It's faster, but should only be used when you don't care about
        // an exposed private key e.g. sig verification.
        // Does NOT allow scalars higher than CURVE.n.
        // Accepts optional accumulator to merge with multiply (important for sparse scalars)
        multiplyUnsafe(scalar, acc = Point.ZERO) {
            // 0 <= scalar < L
            if (!Fn.isValid(scalar))
                throw new Error('invalid scalar: expected 0 <= sc < curve.n');
            if (scalar === _0n)
                return Point.ZERO;
            if (this.is0() || scalar === _1n)
                return this;
            return wnaf.unsafe(this, scalar, (p) => (0, curve_ts_1.normalizeZ)(Point, p), acc);
        }
        // Checks if point is of small order.
        // If you add something to small order point, you will have "dirty"
        // point with torsion component.
        // Multiplies point by cofactor and checks if the result is 0.
        isSmallOrder() {
            return this.multiplyUnsafe(cofactor).is0();
        }
        // Multiplies point by curve order and checks if the result is 0.
        // Returns `false` is the point is dirty.
        isTorsionFree() {
            return wnaf.unsafe(this, CURVE.n).is0();
        }
        // Converts Extended point to default (x, y) coordinates.
        // Can accept precomputed Z^-1 - for example, from invertBatch.
        toAffine(invertedZ) {
            return toAffineMemo(this, invertedZ);
        }
        clearCofactor() {
            if (cofactor === _1n)
                return this;
            return this.multiplyUnsafe(cofactor);
        }
        toBytes() {
            const { x, y } = this.toAffine();
            // Fp.toBytes() allows non-canonical encoding of y (>= p).
            const bytes = Fp.toBytes(y);
            // Each y has 2 valid points: (x, y), (x,-y).
            // When compressing, it's enough to store y and use the last byte to encode sign of x
            bytes[bytes.length - 1] |= x & _1n ? 0x80 : 0;
            return bytes;
        }
        toHex() {
            return (0, utils_ts_1.bytesToHex)(this.toBytes());
        }
        toString() {
            return `<Point ${this.is0() ? 'ZERO' : this.toHex()}>`;
        }
        // TODO: remove
        get ex() {
            return this.X;
        }
        get ey() {
            return this.Y;
        }
        get ez() {
            return this.Z;
        }
        get et() {
            return this.T;
        }
        static normalizeZ(points) {
            return (0, curve_ts_1.normalizeZ)(Point, points);
        }
        static msm(points, scalars) {
            return (0, curve_ts_1.pippenger)(Point, Fn, points, scalars);
        }
        _setWindowSize(windowSize) {
            this.precompute(windowSize);
        }
        toRawBytes() {
            return this.toBytes();
        }
    }
    // base / generator point
    Point.BASE = new Point(CURVE.Gx, CURVE.Gy, _1n, modP(CURVE.Gx * CURVE.Gy));
    // zero / infinity / identity point
    Point.ZERO = new Point(_0n, _1n, _1n, _0n); // 0, 1, 1, 0
    // math field
    Point.Fp = Fp;
    // scalar field
    Point.Fn = Fn;
    const wnaf = new curve_ts_1.wNAF(Point, Fn.BITS);
    Point.BASE.precompute(8); // Enable precomputes. Slows down first publicKey computation by 20ms.
    return Point;
}
/**
 * Base class for prime-order points like Ristretto255 and Decaf448.
 * These points eliminate cofactor issues by representing equivalence classes
 * of Edwards curve points.
 */
class PrimeEdwardsPoint {
    constructor(ep) {
        this.ep = ep;
    }
    // Static methods that must be implemented by subclasses
    static fromBytes(_bytes) {
        (0, utils_ts_1.notImplemented)();
    }
    static fromHex(_hex) {
        (0, utils_ts_1.notImplemented)();
    }
    get x() {
        return this.toAffine().x;
    }
    get y() {
        return this.toAffine().y;
    }
    // Common implementations
    clearCofactor() {
        // no-op for prime-order groups
        return this;
    }
    assertValidity() {
        this.ep.assertValidity();
    }
    toAffine(invertedZ) {
        return this.ep.toAffine(invertedZ);
    }
    toHex() {
        return (0, utils_ts_1.bytesToHex)(this.toBytes());
    }
    toString() {
        return this.toHex();
    }
    isTorsionFree() {
        return true;
    }
    isSmallOrder() {
        return false;
    }
    add(other) {
        this.assertSame(other);
        return this.init(this.ep.add(other.ep));
    }
    subtract(other) {
        this.assertSame(other);
        return this.init(this.ep.subtract(other.ep));
    }
    multiply(scalar) {
        return this.init(this.ep.multiply(scalar));
    }
    multiplyUnsafe(scalar) {
        return this.init(this.ep.multiplyUnsafe(scalar));
    }
    double() {
        return this.init(this.ep.double());
    }
    negate() {
        return this.init(this.ep.negate());
    }
    precompute(windowSize, isLazy) {
        return this.init(this.ep.precompute(windowSize, isLazy));
    }
    /** @deprecated use `toBytes` */
    toRawBytes() {
        return this.toBytes();
    }
}
exports.PrimeEdwardsPoint = PrimeEdwardsPoint;
/**
 * Initializes EdDSA signatures over given Edwards curve.
 */
function eddsa(Point, cHash, eddsaOpts = {}) {
    if (typeof cHash !== 'function')
        throw new Error('"hash" function param is required');
    (0, utils_ts_1._validateObject)(eddsaOpts, {}, {
        adjustScalarBytes: 'function',
        randomBytes: 'function',
        domain: 'function',
        prehash: 'function',
        mapToCurve: 'function',
    });
    const { prehash } = eddsaOpts;
    const { BASE, Fp, Fn } = Point;
    const randomBytes = eddsaOpts.randomBytes || utils_ts_1.randomBytes;
    const adjustScalarBytes = eddsaOpts.adjustScalarBytes || ((bytes) => bytes);
    const domain = eddsaOpts.domain ||
        ((data, ctx, phflag) => {
            (0, utils_ts_1._abool2)(phflag, 'phflag');
            if (ctx.length || phflag)
                throw new Error('Contexts/pre-hash are not supported');
            return data;
        }); // NOOP
    // Little-endian SHA512 with modulo n
    function modN_LE(hash) {
        return Fn.create((0, utils_ts_1.bytesToNumberLE)(hash)); // Not Fn.fromBytes: it has length limit
    }
    // Get the hashed private scalar per RFC8032 5.1.5
    function getPrivateScalar(key) {
        const len = lengths.secretKey;
        key = (0, utils_ts_1.ensureBytes)('private key', key, len);
        // Hash private key with curve's hash function to produce uniformingly random input
        // Check byte lengths: ensure(64, h(ensure(32, key)))
        const hashed = (0, utils_ts_1.ensureBytes)('hashed private key', cHash(key), 2 * len);
        const head = adjustScalarBytes(hashed.slice(0, len)); // clear first half bits, produce FE
        const prefix = hashed.slice(len, 2 * len); // second half is called key prefix (5.1.6)
        const scalar = modN_LE(head); // The actual private scalar
        return { head, prefix, scalar };
    }
    /** Convenience method that creates public key from scalar. RFC8032 5.1.5 */
    function getExtendedPublicKey(secretKey) {
        const { head, prefix, scalar } = getPrivateScalar(secretKey);
        const point = BASE.multiply(scalar); // Point on Edwards curve aka public key
        const pointBytes = point.toBytes();
        return { head, prefix, scalar, point, pointBytes };
    }
    /** Calculates EdDSA pub key. RFC8032 5.1.5. */
    function getPublicKey(secretKey) {
        return getExtendedPublicKey(secretKey).pointBytes;
    }
    // int('LE', SHA512(dom2(F, C) || msgs)) mod N
    function hashDomainToScalar(context = Uint8Array.of(), ...msgs) {
        const msg = (0, utils_ts_1.concatBytes)(...msgs);
        return modN_LE(cHash(domain(msg, (0, utils_ts_1.ensureBytes)('context', context), !!prehash)));
    }
    /** Signs message with privateKey. RFC8032 5.1.6 */
    function sign(msg, secretKey, options = {}) {
        msg = (0, utils_ts_1.ensureBytes)('message', msg);
        if (prehash)
            msg = prehash(msg); // for ed25519ph etc.
        const { prefix, scalar, pointBytes } = getExtendedPublicKey(secretKey);
        const r = hashDomainToScalar(options.context, prefix, msg); // r = dom2(F, C) || prefix || PH(M)
        const R = BASE.multiply(r).toBytes(); // R = rG
        const k = hashDomainToScalar(options.context, R, pointBytes, msg); // R || A || PH(M)
        const s = Fn.create(r + k * scalar); // S = (r + k * s) mod L
        if (!Fn.isValid(s))
            throw new Error('sign failed: invalid s'); // 0 <= s < L
        const rs = (0, utils_ts_1.concatBytes)(R, Fn.toBytes(s));
        return (0, utils_ts_1._abytes2)(rs, lengths.signature, 'result');
    }
    // verification rule is either zip215 or rfc8032 / nist186-5. Consult fromHex:
    const verifyOpts = { zip215: true };
    /**
     * Verifies EdDSA signature against message and public key. RFC8032 5.1.7.
     * An extended group equation is checked.
     */
    function verify(sig, msg, publicKey, options = verifyOpts) {
        const { context, zip215 } = options;
        const len = lengths.signature;
        sig = (0, utils_ts_1.ensureBytes)('signature', sig, len);
        msg = (0, utils_ts_1.ensureBytes)('message', msg);
        publicKey = (0, utils_ts_1.ensureBytes)('publicKey', publicKey, lengths.publicKey);
        if (zip215 !== undefined)
            (0, utils_ts_1._abool2)(zip215, 'zip215');
        if (prehash)
            msg = prehash(msg); // for ed25519ph, etc
        const mid = len / 2;
        const r = sig.subarray(0, mid);
        const s = (0, utils_ts_1.bytesToNumberLE)(sig.subarray(mid, len));
        let A, R, SB;
        try {
            // zip215=true is good for consensus-critical apps. =false follows RFC8032 / NIST186-5.
            // zip215=true:  0 <= y < MASK (2^256 for ed25519)
            // zip215=false: 0 <= y < P (2^255-19 for ed25519)
            A = Point.fromBytes(publicKey, zip215);
            R = Point.fromBytes(r, zip215);
            SB = BASE.multiplyUnsafe(s); // 0 <= s < l is done inside
        }
        catch (error) {
            return false;
        }
        if (!zip215 && A.isSmallOrder())
            return false; // zip215 allows public keys of small order
        const k = hashDomainToScalar(context, R.toBytes(), A.toBytes(), msg);
        const RkA = R.add(A.multiplyUnsafe(k));
        // Extended group equation
        // [8][S]B = [8]R + [8][k]A'
        return RkA.subtract(SB).clearCofactor().is0();
    }
    const _size = Fp.BYTES; // 32 for ed25519, 57 for ed448
    const lengths = {
        secretKey: _size,
        publicKey: _size,
        signature: 2 * _size,
        seed: _size,
    };
    function randomSecretKey(seed = randomBytes(lengths.seed)) {
        return (0, utils_ts_1._abytes2)(seed, lengths.seed, 'seed');
    }
    function keygen(seed) {
        const secretKey = utils.randomSecretKey(seed);
        return { secretKey, publicKey: getPublicKey(secretKey) };
    }
    function isValidSecretKey(key) {
        return (0, utils_ts_1.isBytes)(key) && key.length === Fn.BYTES;
    }
    function isValidPublicKey(key, zip215) {
        try {
            return !!Point.fromBytes(key, zip215);
        }
        catch (error) {
            return false;
        }
    }
    const utils = {
        getExtendedPublicKey,
        randomSecretKey,
        isValidSecretKey,
        isValidPublicKey,
        /**
         * Converts ed public key to x public key. Uses formula:
         * - ed25519:
         *   - `(u, v) = ((1+y)/(1-y), sqrt(-486664)*u/x)`
         *   - `(x, y) = (sqrt(-486664)*u/v, (u-1)/(u+1))`
         * - ed448:
         *   - `(u, v) = ((y-1)/(y+1), sqrt(156324)*u/x)`
         *   - `(x, y) = (sqrt(156324)*u/v, (1+u)/(1-u))`
         */
        toMontgomery(publicKey) {
            const { y } = Point.fromBytes(publicKey);
            const size = lengths.publicKey;
            const is25519 = size === 32;
            if (!is25519 && size !== 57)
                throw new Error('only defined for 25519 and 448');
            const u = is25519 ? Fp.div(_1n + y, _1n - y) : Fp.div(y - _1n, y + _1n);
            return Fp.toBytes(u);
        },
        toMontgomeryPriv(secretKey) {
            const size = lengths.secretKey;
            (0, utils_ts_1._abytes2)(secretKey, size);
            const hashed = cHash(secretKey.subarray(0, size));
            return adjustScalarBytes(hashed).subarray(0, size);
        },
        /** @deprecated */
        randomPrivateKey: randomSecretKey,
        /** @deprecated */
        precompute(windowSize = 8, point = Point.BASE) {
            return point.precompute(windowSize, false);
        },
    };
    return Object.freeze({
        keygen,
        getPublicKey,
        sign,
        verify,
        utils,
        Point,
        lengths,
    });
}
function _eddsa_legacy_opts_to_new(c) {
    const CURVE = {
        a: c.a,
        d: c.d,
        p: c.Fp.ORDER,
        n: c.n,
        h: c.h,
        Gx: c.Gx,
        Gy: c.Gy,
    };
    const Fp = c.Fp;
    const Fn = (0, modular_ts_1.Field)(CURVE.n, c.nBitLength, true);
    const curveOpts = { Fp, Fn, uvRatio: c.uvRatio };
    const eddsaOpts = {
        randomBytes: c.randomBytes,
        adjustScalarBytes: c.adjustScalarBytes,
        domain: c.domain,
        prehash: c.prehash,
        mapToCurve: c.mapToCurve,
    };
    return { CURVE, curveOpts, hash: c.hash, eddsaOpts };
}
function _eddsa_new_output_to_legacy(c, eddsa) {
    const Point = eddsa.Point;
    const legacy = Object.assign({}, eddsa, {
        ExtendedPoint: Point,
        CURVE: c,
        nBitLength: Point.Fn.BITS,
        nByteLength: Point.Fn.BYTES,
    });
    return legacy;
}
// TODO: remove. Use eddsa
function twistedEdwards(c) {
    const { CURVE, curveOpts, hash, eddsaOpts } = _eddsa_legacy_opts_to_new(c);
    const Point = edwards(CURVE, curveOpts);
    const EDDSA = eddsa(Point, hash, eddsaOpts);
    return _eddsa_new_output_to_legacy(c, EDDSA);
}

},{"../utils.js":8,"./curve.js":2,"./modular.js":5}],4:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._DST_scalar = void 0;
exports.expand_message_xmd = expand_message_xmd;
exports.expand_message_xof = expand_message_xof;
exports.hash_to_field = hash_to_field;
exports.isogenyMap = isogenyMap;
exports.createHasher = createHasher;
const utils_ts_1 = require("../utils.js");
const modular_ts_1 = require("./modular.js");
// Octet Stream to Integer. "spec" implementation of os2ip is 2.5x slower vs bytesToNumberBE.
const os2ip = utils_ts_1.bytesToNumberBE;
// Integer to Octet Stream (numberToBytesBE)
function i2osp(value, length) {
    anum(value);
    anum(length);
    if (value < 0 || value >= 1 << (8 * length))
        throw new Error('invalid I2OSP input: ' + value);
    const res = Array.from({ length }).fill(0);
    for (let i = length - 1; i >= 0; i--) {
        res[i] = value & 0xff;
        value >>>= 8;
    }
    return new Uint8Array(res);
}
function strxor(a, b) {
    const arr = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
        arr[i] = a[i] ^ b[i];
    }
    return arr;
}
function anum(item) {
    if (!Number.isSafeInteger(item))
        throw new Error('number expected');
}
function normDST(DST) {
    if (!(0, utils_ts_1.isBytes)(DST) && typeof DST !== 'string')
        throw new Error('DST must be Uint8Array or string');
    return typeof DST === 'string' ? (0, utils_ts_1.utf8ToBytes)(DST) : DST;
}
/**
 * Produces a uniformly random byte string using a cryptographic hash function H that outputs b bits.
 * [RFC 9380 5.3.1](https://www.rfc-editor.org/rfc/rfc9380#section-5.3.1).
 */
function expand_message_xmd(msg, DST, lenInBytes, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    // https://www.rfc-editor.org/rfc/rfc9380#section-5.3.3
    if (DST.length > 255)
        DST = H((0, utils_ts_1.concatBytes)((0, utils_ts_1.utf8ToBytes)('H2C-OVERSIZE-DST-'), DST));
    const { outputLen: b_in_bytes, blockLen: r_in_bytes } = H;
    const ell = Math.ceil(lenInBytes / b_in_bytes);
    if (lenInBytes > 65535 || ell > 255)
        throw new Error('expand_message_xmd: invalid lenInBytes');
    const DST_prime = (0, utils_ts_1.concatBytes)(DST, i2osp(DST.length, 1));
    const Z_pad = i2osp(0, r_in_bytes);
    const l_i_b_str = i2osp(lenInBytes, 2); // len_in_bytes_str
    const b = new Array(ell);
    const b_0 = H((0, utils_ts_1.concatBytes)(Z_pad, msg, l_i_b_str, i2osp(0, 1), DST_prime));
    b[0] = H((0, utils_ts_1.concatBytes)(b_0, i2osp(1, 1), DST_prime));
    for (let i = 1; i <= ell; i++) {
        const args = [strxor(b_0, b[i - 1]), i2osp(i + 1, 1), DST_prime];
        b[i] = H((0, utils_ts_1.concatBytes)(...args));
    }
    const pseudo_random_bytes = (0, utils_ts_1.concatBytes)(...b);
    return pseudo_random_bytes.slice(0, lenInBytes);
}
/**
 * Produces a uniformly random byte string using an extendable-output function (XOF) H.
 * 1. The collision resistance of H MUST be at least k bits.
 * 2. H MUST be an XOF that has been proved indifferentiable from
 *    a random oracle under a reasonable cryptographic assumption.
 * [RFC 9380 5.3.2](https://www.rfc-editor.org/rfc/rfc9380#section-5.3.2).
 */
function expand_message_xof(msg, DST, lenInBytes, k, H) {
    (0, utils_ts_1.abytes)(msg);
    anum(lenInBytes);
    DST = normDST(DST);
    // https://www.rfc-editor.org/rfc/rfc9380#section-5.3.3
    // DST = H('H2C-OVERSIZE-DST-' || a_very_long_DST, Math.ceil((lenInBytes * k) / 8));
    if (DST.length > 255) {
        const dkLen = Math.ceil((2 * k) / 8);
        DST = H.create({ dkLen }).update((0, utils_ts_1.utf8ToBytes)('H2C-OVERSIZE-DST-')).update(DST).digest();
    }
    if (lenInBytes > 65535 || DST.length > 255)
        throw new Error('expand_message_xof: invalid lenInBytes');
    return (H.create({ dkLen: lenInBytes })
        .update(msg)
        .update(i2osp(lenInBytes, 2))
        // 2. DST_prime = DST || I2OSP(len(DST), 1)
        .update(DST)
        .update(i2osp(DST.length, 1))
        .digest());
}
/**
 * Hashes arbitrary-length byte strings to a list of one or more elements of a finite field F.
 * [RFC 9380 5.2](https://www.rfc-editor.org/rfc/rfc9380#section-5.2).
 * @param msg a byte string containing the message to hash
 * @param count the number of elements of F to output
 * @param options `{DST: string, p: bigint, m: number, k: number, expand: 'xmd' | 'xof', hash: H}`, see above
 * @returns [u_0, ..., u_(count - 1)], a list of field elements.
 */
function hash_to_field(msg, count, options) {
    (0, utils_ts_1._validateObject)(options, {
        p: 'bigint',
        m: 'number',
        k: 'number',
        hash: 'function',
    });
    const { p, k, m, hash, expand, DST } = options;
    if (!(0, utils_ts_1.isHash)(options.hash))
        throw new Error('expected valid hash');
    (0, utils_ts_1.abytes)(msg);
    anum(count);
    const log2p = p.toString(2).length;
    const L = Math.ceil((log2p + k) / 8); // section 5.1 of ietf draft link above
    const len_in_bytes = count * m * L;
    let prb; // pseudo_random_bytes
    if (expand === 'xmd') {
        prb = expand_message_xmd(msg, DST, len_in_bytes, hash);
    }
    else if (expand === 'xof') {
        prb = expand_message_xof(msg, DST, len_in_bytes, k, hash);
    }
    else if (expand === '_internal_pass') {
        // for internal tests only
        prb = msg;
    }
    else {
        throw new Error('expand must be "xmd" or "xof"');
    }
    const u = new Array(count);
    for (let i = 0; i < count; i++) {
        const e = new Array(m);
        for (let j = 0; j < m; j++) {
            const elm_offset = L * (j + i * m);
            const tv = prb.subarray(elm_offset, elm_offset + L);
            e[j] = (0, modular_ts_1.mod)(os2ip(tv), p);
        }
        u[i] = e;
    }
    return u;
}
function isogenyMap(field, map) {
    // Make same order as in spec
    const coeff = map.map((i) => Array.from(i).reverse());
    return (x, y) => {
        const [xn, xd, yn, yd] = coeff.map((val) => val.reduce((acc, i) => field.add(field.mul(acc, x), i)));
        // 6.6.3
        // Exceptional cases of iso_map are inputs that cause the denominator of
        // either rational function to evaluate to zero; such cases MUST return
        // the identity point on E.
        const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(field, [xd, yd], true);
        x = field.mul(xn, xd_inv); // xNum / xDen
        y = field.mul(y, field.mul(yn, yd_inv)); // y * (yNum / yDev)
        return { x, y };
    };
}
exports._DST_scalar = (0, utils_ts_1.utf8ToBytes)('HashToScalar-');
/** Creates hash-to-curve methods from EC Point and mapToCurve function. See {@link H2CHasher}. */
function createHasher(Point, mapToCurve, defaults) {
    if (typeof mapToCurve !== 'function')
        throw new Error('mapToCurve() must be defined');
    function map(num) {
        return Point.fromAffine(mapToCurve(num));
    }
    function clear(initial) {
        const P = initial.clearCofactor();
        if (P.equals(Point.ZERO))
            return Point.ZERO; // zero will throw in assert
        P.assertValidity();
        return P;
    }
    return {
        defaults,
        hashToCurve(msg, options) {
            const opts = Object.assign({}, defaults, options);
            const u = hash_to_field(msg, 2, opts);
            const u0 = map(u[0]);
            const u1 = map(u[1]);
            return clear(u0.add(u1));
        },
        encodeToCurve(msg, options) {
            const optsDst = defaults.encodeDST ? { DST: defaults.encodeDST } : {};
            const opts = Object.assign({}, defaults, optsDst, options);
            const u = hash_to_field(msg, 1, opts);
            const u0 = map(u[0]);
            return clear(u0);
        },
        /** See {@link H2CHasher} */
        mapToCurve(scalars) {
            if (!Array.isArray(scalars))
                throw new Error('expected array of bigints');
            for (const i of scalars)
                if (typeof i !== 'bigint')
                    throw new Error('expected array of bigints');
            return clear(map(scalars));
        },
        // hash_to_scalar can produce 0: https://www.rfc-editor.org/errata/eid8393
        // RFC 9380, draft-irtf-cfrg-bbs-signatures-08
        hashToScalar(msg, options) {
            // @ts-ignore
            const N = Point.Fn.ORDER;
            const opts = Object.assign({}, defaults, { p: N, m: 1, DST: exports._DST_scalar }, options);
            return hash_to_field(msg, 1, opts)[0][0];
        },
    };
}

},{"../utils.js":8,"./modular.js":5}],5:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNegativeLE = void 0;
exports.mod = mod;
exports.pow = pow;
exports.pow2 = pow2;
exports.invert = invert;
exports.tonelliShanks = tonelliShanks;
exports.FpSqrt = FpSqrt;
exports.validateField = validateField;
exports.FpPow = FpPow;
exports.FpInvertBatch = FpInvertBatch;
exports.FpDiv = FpDiv;
exports.FpLegendre = FpLegendre;
exports.FpIsSquare = FpIsSquare;
exports.nLength = nLength;
exports.Field = Field;
exports.FpSqrtOdd = FpSqrtOdd;
exports.FpSqrtEven = FpSqrtEven;
exports.hashToPrivateScalar = hashToPrivateScalar;
exports.getFieldBytesLength = getFieldBytesLength;
exports.getMinHashLength = getMinHashLength;
exports.mapHashToField = mapHashToField;
/**
 * Utils for modular division and fields.
 * Field over 11 is a finite (Galois) field is integer number operations `mod 11`.
 * There is no division: it is replaced by modular multiplicative inverse.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
// prettier-ignore
const _0n = BigInt(0), _1n = BigInt(1), _2n = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3);
// prettier-ignore
const _4n = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5), _7n = /* @__PURE__ */ BigInt(7);
// prettier-ignore
const _8n = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9), _16n = /* @__PURE__ */ BigInt(16);
// Calculates a modulo b
function mod(a, b) {
    const result = a % b;
    return result >= _0n ? result : b + result;
}
/**
 * Efficiently raise num to power and do modular division.
 * Unsafe in some contexts: uses ladder, so can expose bigint bits.
 * @example
 * pow(2n, 6n, 11n) // 64n % 11n == 9n
 */
function pow(num, power, modulo) {
    return FpPow(Field(modulo), num, power);
}
/** Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)` */
function pow2(x, power, modulo) {
    let res = x;
    while (power-- > _0n) {
        res *= res;
        res %= modulo;
    }
    return res;
}
/**
 * Inverses number over modulo.
 * Implemented using [Euclidean GCD](https://brilliant.org/wiki/extended-euclidean-algorithm/).
 */
function invert(number, modulo) {
    if (number === _0n)
        throw new Error('invert: expected non-zero number');
    if (modulo <= _0n)
        throw new Error('invert: expected positive modulus, got ' + modulo);
    // Fermat's little theorem "CT-like" version inv(n) = n^(m-2) mod m is 30x slower.
    let a = mod(number, modulo);
    let b = modulo;
    // prettier-ignore
    let x = _0n, y = _1n, u = _1n, v = _0n;
    while (a !== _0n) {
        // JIT applies optimization if those two lines follow each other
        const q = b / a;
        const r = b % a;
        const m = x - u * q;
        const n = y - v * q;
        // prettier-ignore
        b = a, a = r, x = u, y = v, u = m, v = n;
    }
    const gcd = b;
    if (gcd !== _1n)
        throw new Error('invert: does not exist');
    return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
    if (!Fp.eql(Fp.sqr(root), n))
        throw new Error('Cannot find square root');
}
// Not all roots are possible! Example which will throw:
// const NUM =
// n = 72057594037927816n;
// Fp = Field(BigInt('0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab'));
function sqrt3mod4(Fp, n) {
    const p1div4 = (Fp.ORDER + _1n) / _4n;
    const root = Fp.pow(n, p1div4);
    assertIsSquare(Fp, root, n);
    return root;
}
function sqrt5mod8(Fp, n) {
    const p5div8 = (Fp.ORDER - _5n) / _8n;
    const n2 = Fp.mul(n, _2n);
    const v = Fp.pow(n2, p5div8);
    const nv = Fp.mul(n, v);
    const i = Fp.mul(Fp.mul(nv, _2n), v);
    const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
    assertIsSquare(Fp, root, n);
    return root;
}
// Based on RFC9380, Kong algorithm
// prettier-ignore
function sqrt9mod16(P) {
    const Fp_ = Field(P);
    const tn = tonelliShanks(P);
    const c1 = tn(Fp_, Fp_.neg(Fp_.ONE)); //  1. c1 = sqrt(-1) in F, i.e., (c1^2) == -1 in F
    const c2 = tn(Fp_, c1); //  2. c2 = sqrt(c1) in F, i.e., (c2^2) == c1 in F
    const c3 = tn(Fp_, Fp_.neg(c1)); //  3. c3 = sqrt(-c1) in F, i.e., (c3^2) == -c1 in F
    const c4 = (P + _7n) / _16n; //  4. c4 = (q + 7) / 16        # Integer arithmetic
    return (Fp, n) => {
        let tv1 = Fp.pow(n, c4); //  1. tv1 = x^c4
        let tv2 = Fp.mul(tv1, c1); //  2. tv2 = c1 * tv1
        const tv3 = Fp.mul(tv1, c2); //  3. tv3 = c2 * tv1
        const tv4 = Fp.mul(tv1, c3); //  4. tv4 = c3 * tv1
        const e1 = Fp.eql(Fp.sqr(tv2), n); //  5.  e1 = (tv2^2) == x
        const e2 = Fp.eql(Fp.sqr(tv3), n); //  6.  e2 = (tv3^2) == x
        tv1 = Fp.cmov(tv1, tv2, e1); //  7. tv1 = CMOV(tv1, tv2, e1)  # Select tv2 if (tv2^2) == x
        tv2 = Fp.cmov(tv4, tv3, e2); //  8. tv2 = CMOV(tv4, tv3, e2)  # Select tv3 if (tv3^2) == x
        const e3 = Fp.eql(Fp.sqr(tv2), n); //  9.  e3 = (tv2^2) == x
        const root = Fp.cmov(tv1, tv2, e3); // 10.  z = CMOV(tv1, tv2, e3)   # Select sqrt from tv1 & tv2
        assertIsSquare(Fp, root, n);
        return root;
    };
}
/**
 * Tonelli-Shanks square root search algorithm.
 * 1. https://eprint.iacr.org/2012/685.pdf (page 12)
 * 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
 * @param P field order
 * @returns function that takes field Fp (created from P) and number n
 */
function tonelliShanks(P) {
    // Initialization (precomputation).
    // Caching initialization could boost perf by 7%.
    if (P < _3n)
        throw new Error('sqrt is not defined for small field');
    // Factor P - 1 = Q * 2^S, where Q is odd
    let Q = P - _1n;
    let S = 0;
    while (Q % _2n === _0n) {
        Q /= _2n;
        S++;
    }
    // Find the first quadratic non-residue Z >= 2
    let Z = _2n;
    const _Fp = Field(P);
    while (FpLegendre(_Fp, Z) === 1) {
        // Basic primality test for P. After x iterations, chance of
        // not finding quadratic non-residue is 2^x, so 2^1000.
        if (Z++ > 1000)
            throw new Error('Cannot find square root: probably non-prime P');
    }
    // Fast-path; usually done before Z, but we do "primality test".
    if (S === 1)
        return sqrt3mod4;
    // Slow-path
    // TODO: test on Fp2 and others
    let cc = _Fp.pow(Z, Q); // c = z^Q
    const Q1div2 = (Q + _1n) / _2n;
    return function tonelliSlow(Fp, n) {
        if (Fp.is0(n))
            return n;
        // Check if n is a quadratic residue using Legendre symbol
        if (FpLegendre(Fp, n) !== 1)
            throw new Error('Cannot find square root');
        // Initialize variables for the main loop
        let M = S;
        let c = Fp.mul(Fp.ONE, cc); // c = z^Q, move cc from field _Fp into field Fp
        let t = Fp.pow(n, Q); // t = n^Q, first guess at the fudge factor
        let R = Fp.pow(n, Q1div2); // R = n^((Q+1)/2), first guess at the square root
        // Main loop
        // while t != 1
        while (!Fp.eql(t, Fp.ONE)) {
            if (Fp.is0(t))
                return Fp.ZERO; // if t=0 return R=0
            let i = 1;
            // Find the smallest i >= 1 such that t^(2^i) ≡ 1 (mod P)
            let t_tmp = Fp.sqr(t); // t^(2^1)
            while (!Fp.eql(t_tmp, Fp.ONE)) {
                i++;
                t_tmp = Fp.sqr(t_tmp); // t^(2^2)...
                if (i === M)
                    throw new Error('Cannot find square root');
            }
            // Calculate the exponent for b: 2^(M - i - 1)
            const exponent = _1n << BigInt(M - i - 1); // bigint is important
            const b = Fp.pow(c, exponent); // b = 2^(M - i - 1)
            // Update variables
            M = i;
            c = Fp.sqr(b); // c = b^2
            t = Fp.mul(t, c); // t = (t * b^2)
            R = Fp.mul(R, b); // R = R*b
        }
        return R;
    };
}
/**
 * Square root for a finite field. Will try optimized versions first:
 *
 * 1. P ≡ 3 (mod 4)
 * 2. P ≡ 5 (mod 8)
 * 3. P ≡ 9 (mod 16)
 * 4. Tonelli-Shanks algorithm
 *
 * Different algorithms can give different roots, it is up to user to decide which one they want.
 * For example there is FpSqrtOdd/FpSqrtEven to choice root based on oddness (used for hash-to-curve).
 */
function FpSqrt(P) {
    // P ≡ 3 (mod 4) => √n = n^((P+1)/4)
    if (P % _4n === _3n)
        return sqrt3mod4;
    // P ≡ 5 (mod 8) => Atkin algorithm, page 10 of https://eprint.iacr.org/2012/685.pdf
    if (P % _8n === _5n)
        return sqrt5mod8;
    // P ≡ 9 (mod 16) => Kong algorithm, page 11 of https://eprint.iacr.org/2012/685.pdf (algorithm 4)
    if (P % _16n === _9n)
        return sqrt9mod16(P);
    // Tonelli-Shanks algorithm
    return tonelliShanks(P);
}
// Little-endian check for first LE bit (last BE bit);
const isNegativeLE = (num, modulo) => (mod(num, modulo) & _1n) === _1n;
exports.isNegativeLE = isNegativeLE;
// prettier-ignore
const FIELD_FIELDS = [
    'create', 'isValid', 'is0', 'neg', 'inv', 'sqrt', 'sqr',
    'eql', 'add', 'sub', 'mul', 'pow', 'div',
    'addN', 'subN', 'mulN', 'sqrN'
];
function validateField(field) {
    const initial = {
        ORDER: 'bigint',
        MASK: 'bigint',
        BYTES: 'number',
        BITS: 'number',
    };
    const opts = FIELD_FIELDS.reduce((map, val) => {
        map[val] = 'function';
        return map;
    }, initial);
    (0, utils_ts_1._validateObject)(field, opts);
    // const max = 16384;
    // if (field.BYTES < 1 || field.BYTES > max) throw new Error('invalid field');
    // if (field.BITS < 1 || field.BITS > 8 * max) throw new Error('invalid field');
    return field;
}
// Generic field functions
/**
 * Same as `pow` but for Fp: non-constant-time.
 * Unsafe in some contexts: uses ladder, so can expose bigint bits.
 */
function FpPow(Fp, num, power) {
    if (power < _0n)
        throw new Error('invalid exponent, negatives unsupported');
    if (power === _0n)
        return Fp.ONE;
    if (power === _1n)
        return num;
    let p = Fp.ONE;
    let d = num;
    while (power > _0n) {
        if (power & _1n)
            p = Fp.mul(p, d);
        d = Fp.sqr(d);
        power >>= _1n;
    }
    return p;
}
/**
 * Efficiently invert an array of Field elements.
 * Exception-free. Will return `undefined` for 0 elements.
 * @param passZero map 0 to 0 (instead of undefined)
 */
function FpInvertBatch(Fp, nums, passZero = false) {
    const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : undefined);
    // Walk from first to last, multiply them by each other MOD p
    const multipliedAcc = nums.reduce((acc, num, i) => {
        if (Fp.is0(num))
            return acc;
        inverted[i] = acc;
        return Fp.mul(acc, num);
    }, Fp.ONE);
    // Invert last element
    const invertedAcc = Fp.inv(multipliedAcc);
    // Walk from last to first, multiply them by inverted each other MOD p
    nums.reduceRight((acc, num, i) => {
        if (Fp.is0(num))
            return acc;
        inverted[i] = Fp.mul(acc, inverted[i]);
        return Fp.mul(acc, num);
    }, invertedAcc);
    return inverted;
}
// TODO: remove
function FpDiv(Fp, lhs, rhs) {
    return Fp.mul(lhs, typeof rhs === 'bigint' ? invert(rhs, Fp.ORDER) : Fp.inv(rhs));
}
/**
 * Legendre symbol.
 * Legendre constant is used to calculate Legendre symbol (a | p)
 * which denotes the value of a^((p-1)/2) (mod p).
 *
 * * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
 * * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
 * * (a | p) ≡ 0    if a ≡ 0 (mod p)
 */
function FpLegendre(Fp, n) {
    // We can use 3rd argument as optional cache of this value
    // but seems unneeded for now. The operation is very fast.
    const p1mod2 = (Fp.ORDER - _1n) / _2n;
    const powered = Fp.pow(n, p1mod2);
    const yes = Fp.eql(powered, Fp.ONE);
    const zero = Fp.eql(powered, Fp.ZERO);
    const no = Fp.eql(powered, Fp.neg(Fp.ONE));
    if (!yes && !zero && !no)
        throw new Error('invalid Legendre symbol result');
    return yes ? 1 : zero ? 0 : -1;
}
// This function returns True whenever the value x is a square in the field F.
function FpIsSquare(Fp, n) {
    const l = FpLegendre(Fp, n);
    return l === 1;
}
// CURVE.n lengths
function nLength(n, nBitLength) {
    // Bit size, byte size of CURVE.n
    if (nBitLength !== undefined)
        (0, utils_ts_1.anumber)(nBitLength);
    const _nBitLength = nBitLength !== undefined ? nBitLength : n.toString(2).length;
    const nByteLength = Math.ceil(_nBitLength / 8);
    return { nBitLength: _nBitLength, nByteLength };
}
/**
 * Creates a finite field. Major performance optimizations:
 * * 1. Denormalized operations like mulN instead of mul.
 * * 2. Identical object shape: never add or remove keys.
 * * 3. `Object.freeze`.
 * Fragile: always run a benchmark on a change.
 * Security note: operations don't check 'isValid' for all elements for performance reasons,
 * it is caller responsibility to check this.
 * This is low-level code, please make sure you know what you're doing.
 *
 * Note about field properties:
 * * CHARACTERISTIC p = prime number, number of elements in main subgroup.
 * * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
 *
 * @param ORDER field order, probably prime, or could be composite
 * @param bitLen how many bits the field consumes
 * @param isLE (default: false) if encoding / decoding should be in little-endian
 * @param redef optional faster redefinitions of sqrt and other methods
 */
function Field(ORDER, bitLenOrOpts, // TODO: use opts only in v2?
isLE = false, opts = {}) {
    if (ORDER <= _0n)
        throw new Error('invalid field: expected ORDER > 0, got ' + ORDER);
    let _nbitLength = undefined;
    let _sqrt = undefined;
    let modFromBytes = false;
    let allowedLengths = undefined;
    if (typeof bitLenOrOpts === 'object' && bitLenOrOpts != null) {
        if (opts.sqrt || isLE)
            throw new Error('cannot specify opts in two arguments');
        const _opts = bitLenOrOpts;
        if (_opts.BITS)
            _nbitLength = _opts.BITS;
        if (_opts.sqrt)
            _sqrt = _opts.sqrt;
        if (typeof _opts.isLE === 'boolean')
            isLE = _opts.isLE;
        if (typeof _opts.modFromBytes === 'boolean')
            modFromBytes = _opts.modFromBytes;
        allowedLengths = _opts.allowedLengths;
    }
    else {
        if (typeof bitLenOrOpts === 'number')
            _nbitLength = bitLenOrOpts;
        if (opts.sqrt)
            _sqrt = opts.sqrt;
    }
    const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, _nbitLength);
    if (BYTES > 2048)
        throw new Error('invalid field: expected ORDER of <= 2048 bytes');
    let sqrtP; // cached sqrtP
    const f = Object.freeze({
        ORDER,
        isLE,
        BITS,
        BYTES,
        MASK: (0, utils_ts_1.bitMask)(BITS),
        ZERO: _0n,
        ONE: _1n,
        allowedLengths: allowedLengths,
        create: (num) => mod(num, ORDER),
        isValid: (num) => {
            if (typeof num !== 'bigint')
                throw new Error('invalid field element: expected bigint, got ' + typeof num);
            return _0n <= num && num < ORDER; // 0 is valid element, but it's not invertible
        },
        is0: (num) => num === _0n,
        // is valid and invertible
        isValidNot0: (num) => !f.is0(num) && f.isValid(num),
        isOdd: (num) => (num & _1n) === _1n,
        neg: (num) => mod(-num, ORDER),
        eql: (lhs, rhs) => lhs === rhs,
        sqr: (num) => mod(num * num, ORDER),
        add: (lhs, rhs) => mod(lhs + rhs, ORDER),
        sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
        mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
        pow: (num, power) => FpPow(f, num, power),
        div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
        // Same as above, but doesn't normalize
        sqrN: (num) => num * num,
        addN: (lhs, rhs) => lhs + rhs,
        subN: (lhs, rhs) => lhs - rhs,
        mulN: (lhs, rhs) => lhs * rhs,
        inv: (num) => invert(num, ORDER),
        sqrt: _sqrt ||
            ((n) => {
                if (!sqrtP)
                    sqrtP = FpSqrt(ORDER);
                return sqrtP(f, n);
            }),
        toBytes: (num) => (isLE ? (0, utils_ts_1.numberToBytesLE)(num, BYTES) : (0, utils_ts_1.numberToBytesBE)(num, BYTES)),
        fromBytes: (bytes, skipValidation = true) => {
            if (allowedLengths) {
                if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) {
                    throw new Error('Field.fromBytes: expected ' + allowedLengths + ' bytes, got ' + bytes.length);
                }
                const padded = new Uint8Array(BYTES);
                // isLE add 0 to right, !isLE to the left.
                padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
                bytes = padded;
            }
            if (bytes.length !== BYTES)
                throw new Error('Field.fromBytes: expected ' + BYTES + ' bytes, got ' + bytes.length);
            let scalar = isLE ? (0, utils_ts_1.bytesToNumberLE)(bytes) : (0, utils_ts_1.bytesToNumberBE)(bytes);
            if (modFromBytes)
                scalar = mod(scalar, ORDER);
            if (!skipValidation)
                if (!f.isValid(scalar))
                    throw new Error('invalid field element: outside of range 0..ORDER');
            // NOTE: we don't validate scalar here, please use isValid. This done such way because some
            // protocol may allow non-reduced scalar that reduced later or changed some other way.
            return scalar;
        },
        // TODO: we don't need it here, move out to separate fn
        invertBatch: (lst) => FpInvertBatch(f, lst),
        // We can't move this out because Fp6, Fp12 implement it
        // and it's unclear what to return in there.
        cmov: (a, b, c) => (c ? b : a),
    });
    return Object.freeze(f);
}
// Generic random scalar, we can do same for other fields if via Fp2.mul(Fp2.ONE, Fp2.random)?
// This allows unsafe methods like ignore bias or zero. These unsafe, but often used in different protocols (if deterministic RNG).
// which mean we cannot force this via opts.
// Not sure what to do with randomBytes, we can accept it inside opts if wanted.
// Probably need to export getMinHashLength somewhere?
// random(bytes?: Uint8Array, unsafeAllowZero = false, unsafeAllowBias = false) {
//   const LEN = !unsafeAllowBias ? getMinHashLength(ORDER) : BYTES;
//   if (bytes === undefined) bytes = randomBytes(LEN); // _opts.randomBytes?
//   const num = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
//   // `mod(x, 11)` can sometimes produce 0. `mod(x, 10) + 1` is the same, but no 0
//   const reduced = unsafeAllowZero ? mod(num, ORDER) : mod(num, ORDER - _1n) + _1n;
//   return reduced;
// },
function FpSqrtOdd(Fp, elm) {
    if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? root : Fp.neg(root);
}
function FpSqrtEven(Fp, elm) {
    if (!Fp.isOdd)
        throw new Error("Field doesn't have isOdd");
    const root = Fp.sqrt(elm);
    return Fp.isOdd(root) ? Fp.neg(root) : root;
}
/**
 * "Constant-time" private key generation utility.
 * Same as mapKeyToField, but accepts less bytes (40 instead of 48 for 32-byte field).
 * Which makes it slightly more biased, less secure.
 * @deprecated use `mapKeyToField` instead
 */
function hashToPrivateScalar(hash, groupOrder, isLE = false) {
    hash = (0, utils_ts_1.ensureBytes)('privateHash', hash);
    const hashLen = hash.length;
    const minLen = nLength(groupOrder).nByteLength + 8;
    if (minLen < 24 || hashLen < minLen || hashLen > 1024)
        throw new Error('hashToPrivateScalar: expected ' + minLen + '-1024 bytes of input, got ' + hashLen);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(hash) : (0, utils_ts_1.bytesToNumberBE)(hash);
    return mod(num, groupOrder - _1n) + _1n;
}
/**
 * Returns total number of bytes consumed by the field element.
 * For example, 32 bytes for usual 256-bit weierstrass curve.
 * @param fieldOrder number of field elements, usually CURVE.n
 * @returns byte length of field
 */
function getFieldBytesLength(fieldOrder) {
    if (typeof fieldOrder !== 'bigint')
        throw new Error('field order must be bigint');
    const bitLength = fieldOrder.toString(2).length;
    return Math.ceil(bitLength / 8);
}
/**
 * Returns minimal amount of bytes that can be safely reduced
 * by field order.
 * Should be 2^-128 for 128-bit curve such as P256.
 * @param fieldOrder number of field elements, usually CURVE.n
 * @returns byte length of target hash
 */
function getMinHashLength(fieldOrder) {
    const length = getFieldBytesLength(fieldOrder);
    return length + Math.ceil(length / 2);
}
/**
 * "Constant-time" private key generation utility.
 * Can take (n + n/2) or more bytes of uniform input e.g. from CSPRNG or KDF
 * and convert them into private scalar, with the modulo bias being negligible.
 * Needs at least 48 bytes of input for 32-byte private key.
 * https://research.kudelskisecurity.com/2020/07/28/the-definitive-guide-to-modulo-bias-and-how-to-avoid-it/
 * FIPS 186-5, A.2 https://csrc.nist.gov/publications/detail/fips/186/5/final
 * RFC 9380, https://www.rfc-editor.org/rfc/rfc9380#section-5
 * @param hash hash output from SHA3 or a similar function
 * @param groupOrder size of subgroup - (e.g. secp256k1.CURVE.n)
 * @param isLE interpret hash bytes as LE num
 * @returns valid private scalar
 */
function mapHashToField(key, fieldOrder, isLE = false) {
    const len = key.length;
    const fieldLen = getFieldBytesLength(fieldOrder);
    const minLen = getMinHashLength(fieldOrder);
    // No small numbers: need to understand bias story. No huge numbers: easier to detect JS timings.
    if (len < 16 || len < minLen || len > 1024)
        throw new Error('expected ' + minLen + '-1024 bytes of input, got ' + len);
    const num = isLE ? (0, utils_ts_1.bytesToNumberLE)(key) : (0, utils_ts_1.bytesToNumberBE)(key);
    // `mod(x, 11)` can sometimes produce 0. `mod(x, 10) + 1` is the same, but no 0
    const reduced = mod(num, fieldOrder - _1n) + _1n;
    return isLE ? (0, utils_ts_1.numberToBytesLE)(reduced, fieldLen) : (0, utils_ts_1.numberToBytesBE)(reduced, fieldLen);
}

},{"../utils.js":8}],6:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.montgomery = montgomery;
/**
 * Montgomery curve methods. It's not really whole montgomery curve,
 * just bunch of very specific methods for X25519 / X448 from
 * [RFC 7748](https://www.rfc-editor.org/rfc/rfc7748)
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_ts_1 = require("../utils.js");
const modular_ts_1 = require("./modular.js");
const _0n = BigInt(0);
const _1n = BigInt(1);
const _2n = BigInt(2);
function validateOpts(curve) {
    (0, utils_ts_1._validateObject)(curve, {
        adjustScalarBytes: 'function',
        powPminus2: 'function',
    });
    return Object.freeze({ ...curve });
}
function montgomery(curveDef) {
    const CURVE = validateOpts(curveDef);
    const { P, type, adjustScalarBytes, powPminus2, randomBytes: rand } = CURVE;
    const is25519 = type === 'x25519';
    if (!is25519 && type !== 'x448')
        throw new Error('invalid type');
    const randomBytes_ = rand || utils_ts_1.randomBytes;
    const montgomeryBits = is25519 ? 255 : 448;
    const fieldLen = is25519 ? 32 : 56;
    const Gu = is25519 ? BigInt(9) : BigInt(5);
    // RFC 7748 #5:
    // The constant a24 is (486662 - 2) / 4 = 121665 for curve25519/X25519 and
    // (156326 - 2) / 4 = 39081 for curve448/X448
    // const a = is25519 ? 156326n : 486662n;
    const a24 = is25519 ? BigInt(121665) : BigInt(39081);
    // RFC: x25519 "the resulting integer is of the form 2^254 plus
    // eight times a value between 0 and 2^251 - 1 (inclusive)"
    // x448: "2^447 plus four times a value between 0 and 2^445 - 1 (inclusive)"
    const minScalar = is25519 ? _2n ** BigInt(254) : _2n ** BigInt(447);
    const maxAdded = is25519
        ? BigInt(8) * _2n ** BigInt(251) - _1n
        : BigInt(4) * _2n ** BigInt(445) - _1n;
    const maxScalar = minScalar + maxAdded + _1n; // (inclusive)
    const modP = (n) => (0, modular_ts_1.mod)(n, P);
    const GuBytes = encodeU(Gu);
    function encodeU(u) {
        return (0, utils_ts_1.numberToBytesLE)(modP(u), fieldLen);
    }
    function decodeU(u) {
        const _u = (0, utils_ts_1.ensureBytes)('u coordinate', u, fieldLen);
        // RFC: When receiving such an array, implementations of X25519
        // (but not X448) MUST mask the most significant bit in the final byte.
        if (is25519)
            _u[31] &= 127; // 0b0111_1111
        // RFC: Implementations MUST accept non-canonical values and process them as
        // if they had been reduced modulo the field prime.  The non-canonical
        // values are 2^255 - 19 through 2^255 - 1 for X25519 and 2^448 - 2^224
        // - 1 through 2^448 - 1 for X448.
        return modP((0, utils_ts_1.bytesToNumberLE)(_u));
    }
    function decodeScalar(scalar) {
        return (0, utils_ts_1.bytesToNumberLE)(adjustScalarBytes((0, utils_ts_1.ensureBytes)('scalar', scalar, fieldLen)));
    }
    function scalarMult(scalar, u) {
        const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
        // Some public keys are useless, of low-order. Curve author doesn't think
        // it needs to be validated, but we do it nonetheless.
        // https://cr.yp.to/ecdh.html#validate
        if (pu === _0n)
            throw new Error('invalid private or public key received');
        return encodeU(pu);
    }
    // Computes public key from private. By doing scalar multiplication of base point.
    function scalarMultBase(scalar) {
        return scalarMult(scalar, GuBytes);
    }
    // cswap from RFC7748 "example code"
    function cswap(swap, x_2, x_3) {
        // dummy = mask(swap) AND (x_2 XOR x_3)
        // Where mask(swap) is the all-1 or all-0 word of the same length as x_2
        // and x_3, computed, e.g., as mask(swap) = 0 - swap.
        const dummy = modP(swap * (x_2 - x_3));
        x_2 = modP(x_2 - dummy); // x_2 = x_2 XOR dummy
        x_3 = modP(x_3 + dummy); // x_3 = x_3 XOR dummy
        return { x_2, x_3 };
    }
    /**
     * Montgomery x-only multiplication ladder.
     * @param pointU u coordinate (x) on Montgomery Curve 25519
     * @param scalar by which the point would be multiplied
     * @returns new Point on Montgomery curve
     */
    function montgomeryLadder(u, scalar) {
        (0, utils_ts_1.aInRange)('u', u, _0n, P);
        (0, utils_ts_1.aInRange)('scalar', scalar, minScalar, maxScalar);
        const k = scalar;
        const x_1 = u;
        let x_2 = _1n;
        let z_2 = _0n;
        let x_3 = u;
        let z_3 = _1n;
        let swap = _0n;
        for (let t = BigInt(montgomeryBits - 1); t >= _0n; t--) {
            const k_t = (k >> t) & _1n;
            swap ^= k_t;
            ({ x_2, x_3 } = cswap(swap, x_2, x_3));
            ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
            swap = k_t;
            const A = x_2 + z_2;
            const AA = modP(A * A);
            const B = x_2 - z_2;
            const BB = modP(B * B);
            const E = AA - BB;
            const C = x_3 + z_3;
            const D = x_3 - z_3;
            const DA = modP(D * A);
            const CB = modP(C * B);
            const dacb = DA + CB;
            const da_cb = DA - CB;
            x_3 = modP(dacb * dacb);
            z_3 = modP(x_1 * modP(da_cb * da_cb));
            x_2 = modP(AA * BB);
            z_2 = modP(E * (AA + modP(a24 * E)));
        }
        ({ x_2, x_3 } = cswap(swap, x_2, x_3));
        ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
        const z2 = powPminus2(z_2); // `Fp.pow(x, P - _2n)` is much slower equivalent
        return modP(x_2 * z2); // Return x_2 * (z_2^(p - 2))
    }
    const lengths = {
        secretKey: fieldLen,
        publicKey: fieldLen,
        seed: fieldLen,
    };
    const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
        (0, utils_ts_1.abytes)(seed, lengths.seed);
        return seed;
    };
    function keygen(seed) {
        const secretKey = randomSecretKey(seed);
        return { secretKey, publicKey: scalarMultBase(secretKey) };
    }
    const utils = {
        randomSecretKey,
        randomPrivateKey: randomSecretKey,
    };
    return {
        keygen,
        getSharedSecret: (secretKey, publicKey) => scalarMult(secretKey, publicKey),
        getPublicKey: (secretKey) => scalarMultBase(secretKey),
        scalarMult,
        scalarMultBase,
        utils,
        GuBytes: GuBytes.slice(),
        lengths,
    };
}

},{"../utils.js":8,"./modular.js":5}],7:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hash_to_ristretto255 = exports.hashToRistretto255 = exports.encodeToCurve = exports.hashToCurve = exports.RistrettoPoint = exports.edwardsToMontgomery = exports.ED25519_TORSION_SUBGROUP = exports.ristretto255_hasher = exports.ristretto255 = exports.ed25519_hasher = exports.x25519 = exports.ed25519ph = exports.ed25519ctx = exports.ed25519 = void 0;
exports.edwardsToMontgomeryPub = edwardsToMontgomeryPub;
exports.edwardsToMontgomeryPriv = edwardsToMontgomeryPriv;
/**
 * ed25519 Twisted Edwards curve with following addons:
 * - X25519 ECDH
 * - Ristretto cofactor elimination
 * - Elligator hash-to-group / point indistinguishability
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const sha2_js_1 = require("@noble/hashes/sha2.js");
const utils_js_1 = require("@noble/hashes/utils.js");
const curve_ts_1 = require("./abstract/curve.js");
const edwards_ts_1 = require("./abstract/edwards.js");
const hash_to_curve_ts_1 = require("./abstract/hash-to-curve.js");
const modular_ts_1 = require("./abstract/modular.js");
const montgomery_ts_1 = require("./abstract/montgomery.js");
const utils_ts_1 = require("./utils.js");
// prettier-ignore
const _0n = /* @__PURE__ */ BigInt(0), _1n = BigInt(1), _2n = BigInt(2), _3n = BigInt(3);
// prettier-ignore
const _5n = BigInt(5), _8n = BigInt(8);
// P = 2n**255n-19n
const ed25519_CURVE_p = BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed');
// N = 2n**252n + 27742317777372353535851937790883648493n
// a = Fp.create(BigInt(-1))
// d = -121665/121666 a.k.a. Fp.neg(121665 * Fp.inv(121666))
const ed25519_CURVE = /* @__PURE__ */ (() => ({
    p: ed25519_CURVE_p,
    n: BigInt('0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed'),
    h: _8n,
    a: BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffec'),
    d: BigInt('0x52036cee2b6ffe738cc740797779e89800700a4d4141d8ab75eb4dca135978a3'),
    Gx: BigInt('0x216936d3cd6e53fec0a4e231fdd6dc5c692cc7609525a7b2c9562d608f25d51a'),
    Gy: BigInt('0x6666666666666666666666666666666666666666666666666666666666666658'),
}))();
function ed25519_pow_2_252_3(x) {
    // prettier-ignore
    const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
    const P = ed25519_CURVE_p;
    const x2 = (x * x) % P;
    const b2 = (x2 * x) % P; // x^3, 11
    const b4 = ((0, modular_ts_1.pow2)(b2, _2n, P) * b2) % P; // x^15, 1111
    const b5 = ((0, modular_ts_1.pow2)(b4, _1n, P) * x) % P; // x^31
    const b10 = ((0, modular_ts_1.pow2)(b5, _5n, P) * b5) % P;
    const b20 = ((0, modular_ts_1.pow2)(b10, _10n, P) * b10) % P;
    const b40 = ((0, modular_ts_1.pow2)(b20, _20n, P) * b20) % P;
    const b80 = ((0, modular_ts_1.pow2)(b40, _40n, P) * b40) % P;
    const b160 = ((0, modular_ts_1.pow2)(b80, _80n, P) * b80) % P;
    const b240 = ((0, modular_ts_1.pow2)(b160, _80n, P) * b80) % P;
    const b250 = ((0, modular_ts_1.pow2)(b240, _10n, P) * b10) % P;
    const pow_p_5_8 = ((0, modular_ts_1.pow2)(b250, _2n, P) * x) % P;
    // ^ To pow to (p+3)/8, multiply it by x.
    return { pow_p_5_8, b2 };
}
function adjustScalarBytes(bytes) {
    // Section 5: For X25519, in order to decode 32 random bytes as an integer scalar,
    // set the three least significant bits of the first byte
    bytes[0] &= 248; // 0b1111_1000
    // and the most significant bit of the last to zero,
    bytes[31] &= 127; // 0b0111_1111
    // set the second most significant bit of the last byte to 1
    bytes[31] |= 64; // 0b0100_0000
    return bytes;
}
// √(-1) aka √(a) aka 2^((p-1)/4)
// Fp.sqrt(Fp.neg(1))
const ED25519_SQRT_M1 = /* @__PURE__ */ BigInt('19681161376707505956807079304988542015446066515923890162744021073123829784752');
// sqrt(u/v)
function uvRatio(u, v) {
    const P = ed25519_CURVE_p;
    const v3 = (0, modular_ts_1.mod)(v * v * v, P); // v³
    const v7 = (0, modular_ts_1.mod)(v3 * v3 * v, P); // v⁷
    // (p+3)/8 and (p-5)/8
    const pow = ed25519_pow_2_252_3(u * v7).pow_p_5_8;
    let x = (0, modular_ts_1.mod)(u * v3 * pow, P); // (uv³)(uv⁷)^(p-5)/8
    const vx2 = (0, modular_ts_1.mod)(v * x * x, P); // vx²
    const root1 = x; // First root candidate
    const root2 = (0, modular_ts_1.mod)(x * ED25519_SQRT_M1, P); // Second root candidate
    const useRoot1 = vx2 === u; // If vx² = u (mod p), x is a square root
    const useRoot2 = vx2 === (0, modular_ts_1.mod)(-u, P); // If vx² = -u, set x <-- x * 2^((p-1)/4)
    const noRoot = vx2 === (0, modular_ts_1.mod)(-u * ED25519_SQRT_M1, P); // There is no valid root, vx² = -u√(-1)
    if (useRoot1)
        x = root1;
    if (useRoot2 || noRoot)
        x = root2; // We return root2 anyway, for const-time
    if ((0, modular_ts_1.isNegativeLE)(x, P))
        x = (0, modular_ts_1.mod)(-x, P);
    return { isValid: useRoot1 || useRoot2, value: x };
}
const Fp = /* @__PURE__ */ (() => (0, modular_ts_1.Field)(ed25519_CURVE.p, { isLE: true }))();
const Fn = /* @__PURE__ */ (() => (0, modular_ts_1.Field)(ed25519_CURVE.n, { isLE: true }))();
const ed25519Defaults = /* @__PURE__ */ (() => ({
    ...ed25519_CURVE,
    Fp,
    hash: sha2_js_1.sha512,
    adjustScalarBytes,
    // dom2
    // Ratio of u to v. Allows us to combine inversion and square root. Uses algo from RFC8032 5.1.3.
    // Constant-time, u/√v
    uvRatio,
}))();
/**
 * ed25519 curve with EdDSA signatures.
 * @example
 * import { ed25519 } from '@noble/curves/ed25519';
 * const { secretKey, publicKey } = ed25519.keygen();
 * const msg = new TextEncoder().encode('hello');
 * const sig = ed25519.sign(msg, priv);
 * ed25519.verify(sig, msg, pub); // Default mode: follows ZIP215
 * ed25519.verify(sig, msg, pub, { zip215: false }); // RFC8032 / FIPS 186-5
 */
exports.ed25519 = (() => (0, edwards_ts_1.twistedEdwards)(ed25519Defaults))();
function ed25519_domain(data, ctx, phflag) {
    if (ctx.length > 255)
        throw new Error('Context is too big');
    return (0, utils_js_1.concatBytes)((0, utils_js_1.utf8ToBytes)('SigEd25519 no Ed25519 collisions'), new Uint8Array([phflag ? 1 : 0, ctx.length]), ctx, data);
}
/** Context of ed25519. Uses context for domain separation. */
exports.ed25519ctx = (() => (0, edwards_ts_1.twistedEdwards)({
    ...ed25519Defaults,
    domain: ed25519_domain,
}))();
/** Prehashed version of ed25519. Accepts already-hashed messages in sign() and verify(). */
exports.ed25519ph = (() => (0, edwards_ts_1.twistedEdwards)(Object.assign({}, ed25519Defaults, {
    domain: ed25519_domain,
    prehash: sha2_js_1.sha512,
})))();
/**
 * ECDH using curve25519 aka x25519.
 * @example
 * import { x25519 } from '@noble/curves/ed25519';
 * const priv = 'a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4';
 * const pub = 'e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c';
 * x25519.getSharedSecret(priv, pub) === x25519.scalarMult(priv, pub); // aliases
 * x25519.getPublicKey(priv) === x25519.scalarMultBase(priv);
 * x25519.getPublicKey(x25519.utils.randomSecretKey());
 */
exports.x25519 = (() => {
    const P = Fp.ORDER;
    return (0, montgomery_ts_1.montgomery)({
        P,
        type: 'x25519',
        powPminus2: (x) => {
            // x^(p-2) aka x^(2^255-21)
            const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
            return (0, modular_ts_1.mod)((0, modular_ts_1.pow2)(pow_p_5_8, _3n, P) * b2, P);
        },
        adjustScalarBytes,
    });
})();
// Hash To Curve Elligator2 Map (NOTE: different from ristretto255 elligator)
// NOTE: very important part is usage of FpSqrtEven for ELL2_C1_EDWARDS, since
// SageMath returns different root first and everything falls apart
const ELL2_C1 = /* @__PURE__ */ (() => (ed25519_CURVE_p + _3n) / _8n)(); // 1. c1 = (q + 3) / 8       # Integer arithmetic
const ELL2_C2 = /* @__PURE__ */ (() => Fp.pow(_2n, ELL2_C1))(); // 2. c2 = 2^c1
const ELL2_C3 = /* @__PURE__ */ (() => Fp.sqrt(Fp.neg(Fp.ONE)))(); // 3. c3 = sqrt(-1)
// prettier-ignore
function map_to_curve_elligator2_curve25519(u) {
    const ELL2_C4 = (ed25519_CURVE_p - _5n) / _8n; // 4. c4 = (q - 5) / 8       # Integer arithmetic
    const ELL2_J = BigInt(486662);
    let tv1 = Fp.sqr(u); //  1.  tv1 = u^2
    tv1 = Fp.mul(tv1, _2n); //  2.  tv1 = 2 * tv1
    let xd = Fp.add(tv1, Fp.ONE); //  3.   xd = tv1 + 1         # Nonzero: -1 is square (mod p), tv1 is not
    let x1n = Fp.neg(ELL2_J); //  4.  x1n = -J              # x1 = x1n / xd = -J / (1 + 2 * u^2)
    let tv2 = Fp.sqr(xd); //  5.  tv2 = xd^2
    let gxd = Fp.mul(tv2, xd); //  6.  gxd = tv2 * xd        # gxd = xd^3
    let gx1 = Fp.mul(tv1, ELL2_J); //  7.  gx1 = J * tv1         # x1n + J * xd
    gx1 = Fp.mul(gx1, x1n); //  8.  gx1 = gx1 * x1n       # x1n^2 + J * x1n * xd
    gx1 = Fp.add(gx1, tv2); //  9.  gx1 = gx1 + tv2       # x1n^2 + J * x1n * xd + xd^2
    gx1 = Fp.mul(gx1, x1n); //  10. gx1 = gx1 * x1n       # x1n^3 + J * x1n^2 * xd + x1n * xd^2
    let tv3 = Fp.sqr(gxd); //  11. tv3 = gxd^2
    tv2 = Fp.sqr(tv3); //  12. tv2 = tv3^2           # gxd^4
    tv3 = Fp.mul(tv3, gxd); //  13. tv3 = tv3 * gxd       # gxd^3
    tv3 = Fp.mul(tv3, gx1); //  14. tv3 = tv3 * gx1       # gx1 * gxd^3
    tv2 = Fp.mul(tv2, tv3); //  15. tv2 = tv2 * tv3       # gx1 * gxd^7
    let y11 = Fp.pow(tv2, ELL2_C4); //  16. y11 = tv2^c4        # (gx1 * gxd^7)^((p - 5) / 8)
    y11 = Fp.mul(y11, tv3); //  17. y11 = y11 * tv3       # gx1*gxd^3*(gx1*gxd^7)^((p-5)/8)
    let y12 = Fp.mul(y11, ELL2_C3); //  18. y12 = y11 * c3
    tv2 = Fp.sqr(y11); //  19. tv2 = y11^2
    tv2 = Fp.mul(tv2, gxd); //  20. tv2 = tv2 * gxd
    let e1 = Fp.eql(tv2, gx1); //  21.  e1 = tv2 == gx1
    let y1 = Fp.cmov(y12, y11, e1); //  22.  y1 = CMOV(y12, y11, e1)  # If g(x1) is square, this is its sqrt
    let x2n = Fp.mul(x1n, tv1); //  23. x2n = x1n * tv1       # x2 = x2n / xd = 2 * u^2 * x1n / xd
    let y21 = Fp.mul(y11, u); //  24. y21 = y11 * u
    y21 = Fp.mul(y21, ELL2_C2); //  25. y21 = y21 * c2
    let y22 = Fp.mul(y21, ELL2_C3); //  26. y22 = y21 * c3
    let gx2 = Fp.mul(gx1, tv1); //  27. gx2 = gx1 * tv1       # g(x2) = gx2 / gxd = 2 * u^2 * g(x1)
    tv2 = Fp.sqr(y21); //  28. tv2 = y21^2
    tv2 = Fp.mul(tv2, gxd); //  29. tv2 = tv2 * gxd
    let e2 = Fp.eql(tv2, gx2); //  30.  e2 = tv2 == gx2
    let y2 = Fp.cmov(y22, y21, e2); //  31.  y2 = CMOV(y22, y21, e2)  # If g(x2) is square, this is its sqrt
    tv2 = Fp.sqr(y1); //  32. tv2 = y1^2
    tv2 = Fp.mul(tv2, gxd); //  33. tv2 = tv2 * gxd
    let e3 = Fp.eql(tv2, gx1); //  34.  e3 = tv2 == gx1
    let xn = Fp.cmov(x2n, x1n, e3); //  35.  xn = CMOV(x2n, x1n, e3)  # If e3, x = x1, else x = x2
    let y = Fp.cmov(y2, y1, e3); //  36.   y = CMOV(y2, y1, e3)    # If e3, y = y1, else y = y2
    let e4 = Fp.isOdd(y); //  37.  e4 = sgn0(y) == 1        # Fix sign of y
    y = Fp.cmov(y, Fp.neg(y), e3 !== e4); //  38.   y = CMOV(y, -y, e3 XOR e4)
    return { xMn: xn, xMd: xd, yMn: y, yMd: _1n }; //  39. return (xn, xd, y, 1)
}
const ELL2_C1_EDWARDS = /* @__PURE__ */ (() => (0, modular_ts_1.FpSqrtEven)(Fp, Fp.neg(BigInt(486664))))(); // sgn0(c1) MUST equal 0
function map_to_curve_elligator2_edwards25519(u) {
    const { xMn, xMd, yMn, yMd } = map_to_curve_elligator2_curve25519(u); //  1.  (xMn, xMd, yMn, yMd) =
    // map_to_curve_elligator2_curve25519(u)
    let xn = Fp.mul(xMn, yMd); //  2.  xn = xMn * yMd
    xn = Fp.mul(xn, ELL2_C1_EDWARDS); //  3.  xn = xn * c1
    let xd = Fp.mul(xMd, yMn); //  4.  xd = xMd * yMn    # xn / xd = c1 * xM / yM
    let yn = Fp.sub(xMn, xMd); //  5.  yn = xMn - xMd
    let yd = Fp.add(xMn, xMd); //  6.  yd = xMn + xMd    # (n / d - 1) / (n / d + 1) = (n - d) / (n + d)
    let tv1 = Fp.mul(xd, yd); //  7. tv1 = xd * yd
    let e = Fp.eql(tv1, Fp.ZERO); //  8.   e = tv1 == 0
    xn = Fp.cmov(xn, Fp.ZERO, e); //  9.  xn = CMOV(xn, 0, e)
    xd = Fp.cmov(xd, Fp.ONE, e); //  10. xd = CMOV(xd, 1, e)
    yn = Fp.cmov(yn, Fp.ONE, e); //  11. yn = CMOV(yn, 1, e)
    yd = Fp.cmov(yd, Fp.ONE, e); //  12. yd = CMOV(yd, 1, e)
    const [xd_inv, yd_inv] = (0, modular_ts_1.FpInvertBatch)(Fp, [xd, yd], true); // batch division
    return { x: Fp.mul(xn, xd_inv), y: Fp.mul(yn, yd_inv) }; //  13. return (xn, xd, yn, yd)
}
/** Hashing to ed25519 points / field. RFC 9380 methods. */
exports.ed25519_hasher = (() => (0, hash_to_curve_ts_1.createHasher)(exports.ed25519.Point, (scalars) => map_to_curve_elligator2_edwards25519(scalars[0]), {
    DST: 'edwards25519_XMD:SHA-512_ELL2_RO_',
    encodeDST: 'edwards25519_XMD:SHA-512_ELL2_NU_',
    p: ed25519_CURVE_p,
    m: 1,
    k: 128,
    expand: 'xmd',
    hash: sha2_js_1.sha512,
}))();
// √(-1) aka √(a) aka 2^((p-1)/4)
const SQRT_M1 = ED25519_SQRT_M1;
// √(ad - 1)
const SQRT_AD_MINUS_ONE = /* @__PURE__ */ BigInt('25063068953384623474111414158702152701244531502492656460079210482610430750235');
// 1 / √(a-d)
const INVSQRT_A_MINUS_D = /* @__PURE__ */ BigInt('54469307008909316920995813868745141605393597292927456921205312896311721017578');
// 1-d²
const ONE_MINUS_D_SQ = /* @__PURE__ */ BigInt('1159843021668779879193775521855586647937357759715417654439879720876111806838');
// (d-1)²
const D_MINUS_ONE_SQ = /* @__PURE__ */ BigInt('40440834346308536858101042469323190826248399146238708352240133220865137265952');
// Calculates 1/√(number)
const invertSqrt = (number) => uvRatio(_1n, number);
const MAX_255B = /* @__PURE__ */ BigInt('0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const bytes255ToNumberLE = (bytes) => exports.ed25519.Point.Fp.create((0, utils_ts_1.bytesToNumberLE)(bytes) & MAX_255B);
/**
 * Computes Elligator map for Ristretto255.
 * Described in [RFC9380](https://www.rfc-editor.org/rfc/rfc9380#appendix-B) and on
 * the [website](https://ristretto.group/formulas/elligator.html).
 */
function calcElligatorRistrettoMap(r0) {
    const { d } = ed25519_CURVE;
    const P = ed25519_CURVE_p;
    const mod = (n) => Fp.create(n);
    const r = mod(SQRT_M1 * r0 * r0); // 1
    const Ns = mod((r + _1n) * ONE_MINUS_D_SQ); // 2
    let c = BigInt(-1); // 3
    const D = mod((c - d * r) * mod(r + d)); // 4
    let { isValid: Ns_D_is_sq, value: s } = uvRatio(Ns, D); // 5
    let s_ = mod(s * r0); // 6
    if (!(0, modular_ts_1.isNegativeLE)(s_, P))
        s_ = mod(-s_);
    if (!Ns_D_is_sq)
        s = s_; // 7
    if (!Ns_D_is_sq)
        c = r; // 8
    const Nt = mod(c * (r - _1n) * D_MINUS_ONE_SQ - D); // 9
    const s2 = s * s;
    const W0 = mod((s + s) * D); // 10
    const W1 = mod(Nt * SQRT_AD_MINUS_ONE); // 11
    const W2 = mod(_1n - s2); // 12
    const W3 = mod(_1n + s2); // 13
    return new exports.ed25519.Point(mod(W0 * W3), mod(W2 * W1), mod(W1 * W3), mod(W0 * W2));
}
function ristretto255_map(bytes) {
    (0, utils_js_1.abytes)(bytes, 64);
    const r1 = bytes255ToNumberLE(bytes.subarray(0, 32));
    const R1 = calcElligatorRistrettoMap(r1);
    const r2 = bytes255ToNumberLE(bytes.subarray(32, 64));
    const R2 = calcElligatorRistrettoMap(r2);
    return new _RistrettoPoint(R1.add(R2));
}
/**
 * Wrapper over Edwards Point for ristretto255.
 *
 * Each ed25519/ExtendedPoint has 8 different equivalent points. This can be
 * a source of bugs for protocols like ring signatures. Ristretto was created to solve this.
 * Ristretto point operates in X:Y:Z:T extended coordinates like ExtendedPoint,
 * but it should work in its own namespace: do not combine those two.
 * See [RFC9496](https://www.rfc-editor.org/rfc/rfc9496).
 */
class _RistrettoPoint extends edwards_ts_1.PrimeEdwardsPoint {
    constructor(ep) {
        super(ep);
    }
    static fromAffine(ap) {
        return new _RistrettoPoint(exports.ed25519.Point.fromAffine(ap));
    }
    assertSame(other) {
        if (!(other instanceof _RistrettoPoint))
            throw new Error('RistrettoPoint expected');
    }
    init(ep) {
        return new _RistrettoPoint(ep);
    }
    /** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
    static hashToCurve(hex) {
        return ristretto255_map((0, utils_ts_1.ensureBytes)('ristrettoHash', hex, 64));
    }
    static fromBytes(bytes) {
        (0, utils_js_1.abytes)(bytes, 32);
        const { a, d } = ed25519_CURVE;
        const P = ed25519_CURVE_p;
        const mod = (n) => Fp.create(n);
        const s = bytes255ToNumberLE(bytes);
        // 1. Check that s_bytes is the canonical encoding of a field element, or else abort.
        // 3. Check that s is non-negative, or else abort
        if (!(0, utils_ts_1.equalBytes)(Fp.toBytes(s), bytes) || (0, modular_ts_1.isNegativeLE)(s, P))
            throw new Error('invalid ristretto255 encoding 1');
        const s2 = mod(s * s);
        const u1 = mod(_1n + a * s2); // 4 (a is -1)
        const u2 = mod(_1n - a * s2); // 5
        const u1_2 = mod(u1 * u1);
        const u2_2 = mod(u2 * u2);
        const v = mod(a * d * u1_2 - u2_2); // 6
        const { isValid, value: I } = invertSqrt(mod(v * u2_2)); // 7
        const Dx = mod(I * u2); // 8
        const Dy = mod(I * Dx * v); // 9
        let x = mod((s + s) * Dx); // 10
        if ((0, modular_ts_1.isNegativeLE)(x, P))
            x = mod(-x); // 10
        const y = mod(u1 * Dy); // 11
        const t = mod(x * y); // 12
        if (!isValid || (0, modular_ts_1.isNegativeLE)(t, P) || y === _0n)
            throw new Error('invalid ristretto255 encoding 2');
        return new _RistrettoPoint(new exports.ed25519.Point(x, y, _1n, t));
    }
    /**
     * Converts ristretto-encoded string to ristretto point.
     * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-decode).
     * @param hex Ristretto-encoded 32 bytes. Not every 32-byte string is valid ristretto encoding
     */
    static fromHex(hex) {
        return _RistrettoPoint.fromBytes((0, utils_ts_1.ensureBytes)('ristrettoHex', hex, 32));
    }
    static msm(points, scalars) {
        return (0, curve_ts_1.pippenger)(_RistrettoPoint, exports.ed25519.Point.Fn, points, scalars);
    }
    /**
     * Encodes ristretto point to Uint8Array.
     * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-encode).
     */
    toBytes() {
        let { X, Y, Z, T } = this.ep;
        const P = ed25519_CURVE_p;
        const mod = (n) => Fp.create(n);
        const u1 = mod(mod(Z + Y) * mod(Z - Y)); // 1
        const u2 = mod(X * Y); // 2
        // Square root always exists
        const u2sq = mod(u2 * u2);
        const { value: invsqrt } = invertSqrt(mod(u1 * u2sq)); // 3
        const D1 = mod(invsqrt * u1); // 4
        const D2 = mod(invsqrt * u2); // 5
        const zInv = mod(D1 * D2 * T); // 6
        let D; // 7
        if ((0, modular_ts_1.isNegativeLE)(T * zInv, P)) {
            let _x = mod(Y * SQRT_M1);
            let _y = mod(X * SQRT_M1);
            X = _x;
            Y = _y;
            D = mod(D1 * INVSQRT_A_MINUS_D);
        }
        else {
            D = D2; // 8
        }
        if ((0, modular_ts_1.isNegativeLE)(X * zInv, P))
            Y = mod(-Y); // 9
        let s = mod((Z - Y) * D); // 10 (check footer's note, no sqrt(-a))
        if ((0, modular_ts_1.isNegativeLE)(s, P))
            s = mod(-s);
        return Fp.toBytes(s); // 11
    }
    /**
     * Compares two Ristretto points.
     * Described in [RFC9496](https://www.rfc-editor.org/rfc/rfc9496#name-equals).
     */
    equals(other) {
        this.assertSame(other);
        const { X: X1, Y: Y1 } = this.ep;
        const { X: X2, Y: Y2 } = other.ep;
        const mod = (n) => Fp.create(n);
        // (x1 * y2 == y1 * x2) | (y1 * y2 == x1 * x2)
        const one = mod(X1 * Y2) === mod(Y1 * X2);
        const two = mod(Y1 * Y2) === mod(X1 * X2);
        return one || two;
    }
    is0() {
        return this.equals(_RistrettoPoint.ZERO);
    }
}
// Do NOT change syntax: the following gymnastics is done,
// because typescript strips comments, which makes bundlers disable tree-shaking.
// prettier-ignore
_RistrettoPoint.BASE = 
/* @__PURE__ */ (() => new _RistrettoPoint(exports.ed25519.Point.BASE))();
// prettier-ignore
_RistrettoPoint.ZERO = 
/* @__PURE__ */ (() => new _RistrettoPoint(exports.ed25519.Point.ZERO))();
// prettier-ignore
_RistrettoPoint.Fp = 
/* @__PURE__ */ (() => Fp)();
// prettier-ignore
_RistrettoPoint.Fn = 
/* @__PURE__ */ (() => Fn)();
exports.ristretto255 = { Point: _RistrettoPoint };
/** Hashing to ristretto255 points / field. RFC 9380 methods. */
exports.ristretto255_hasher = {
    hashToCurve(msg, options) {
        const DST = options?.DST || 'ristretto255_XMD:SHA-512_R255MAP_RO_';
        const xmd = (0, hash_to_curve_ts_1.expand_message_xmd)(msg, DST, 64, sha2_js_1.sha512);
        return ristretto255_map(xmd);
    },
    hashToScalar(msg, options = { DST: hash_to_curve_ts_1._DST_scalar }) {
        const xmd = (0, hash_to_curve_ts_1.expand_message_xmd)(msg, options.DST, 64, sha2_js_1.sha512);
        return Fn.create((0, utils_ts_1.bytesToNumberLE)(xmd));
    },
};
// export const ristretto255_oprf: OPRF = createORPF({
//   name: 'ristretto255-SHA512',
//   Point: RistrettoPoint,
//   hash: sha512,
//   hashToGroup: ristretto255_hasher.hashToCurve,
//   hashToScalar: ristretto255_hasher.hashToScalar,
// });
/**
 * Weird / bogus points, useful for debugging.
 * All 8 ed25519 points of 8-torsion subgroup can be generated from the point
 * T = `26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05`.
 * ⟨T⟩ = { O, T, 2T, 3T, 4T, 5T, 6T, 7T }
 */
exports.ED25519_TORSION_SUBGROUP = [
    '0100000000000000000000000000000000000000000000000000000000000000',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
    '0000000000000000000000000000000000000000000000000000000000000080',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
    'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
    '0000000000000000000000000000000000000000000000000000000000000000',
    'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
];
/** @deprecated use `ed25519.utils.toMontgomery` */
function edwardsToMontgomeryPub(edwardsPub) {
    return exports.ed25519.utils.toMontgomery((0, utils_ts_1.ensureBytes)('pub', edwardsPub));
}
/** @deprecated use `ed25519.utils.toMontgomery` */
exports.edwardsToMontgomery = edwardsToMontgomeryPub;
/** @deprecated use `ed25519.utils.toMontgomeryPriv` */
function edwardsToMontgomeryPriv(edwardsPriv) {
    return exports.ed25519.utils.toMontgomeryPriv((0, utils_ts_1.ensureBytes)('pub', edwardsPriv));
}
/** @deprecated use `ristretto255.Point` */
exports.RistrettoPoint = _RistrettoPoint;
/** @deprecated use `import { ed25519_hasher } from '@noble/curves/ed25519.js';` */
exports.hashToCurve = (() => exports.ed25519_hasher.hashToCurve)();
/** @deprecated use `import { ed25519_hasher } from '@noble/curves/ed25519.js';` */
exports.encodeToCurve = (() => exports.ed25519_hasher.encodeToCurve)();
/** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
exports.hashToRistretto255 = (() => exports.ristretto255_hasher.hashToCurve)();
/** @deprecated use `import { ristretto255_hasher } from '@noble/curves/ed25519.js';` */
exports.hash_to_ristretto255 = (() => exports.ristretto255_hasher.hashToCurve)();

},{"./abstract/curve.js":2,"./abstract/edwards.js":3,"./abstract/hash-to-curve.js":4,"./abstract/modular.js":5,"./abstract/montgomery.js":6,"./utils.js":8,"@noble/hashes/sha2.js":12,"@noble/hashes/utils.js":13}],8:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notImplemented = exports.bitMask = exports.utf8ToBytes = exports.randomBytes = exports.isBytes = exports.hexToBytes = exports.concatBytes = exports.bytesToUtf8 = exports.bytesToHex = exports.anumber = exports.abytes = void 0;
exports.abool = abool;
exports._abool2 = _abool2;
exports._abytes2 = _abytes2;
exports.numberToHexUnpadded = numberToHexUnpadded;
exports.hexToNumber = hexToNumber;
exports.bytesToNumberBE = bytesToNumberBE;
exports.bytesToNumberLE = bytesToNumberLE;
exports.numberToBytesBE = numberToBytesBE;
exports.numberToBytesLE = numberToBytesLE;
exports.numberToVarBytesBE = numberToVarBytesBE;
exports.ensureBytes = ensureBytes;
exports.equalBytes = equalBytes;
exports.copyBytes = copyBytes;
exports.asciiToBytes = asciiToBytes;
exports.inRange = inRange;
exports.aInRange = aInRange;
exports.bitLen = bitLen;
exports.bitGet = bitGet;
exports.bitSet = bitSet;
exports.createHmacDrbg = createHmacDrbg;
exports.validateObject = validateObject;
exports.isHash = isHash;
exports._validateObject = _validateObject;
exports.memoized = memoized;
/**
 * Hex, bytes and number utilities.
 * @module
 */
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const utils_js_1 = require("@noble/hashes/utils.js");
var utils_js_2 = require("@noble/hashes/utils.js");
Object.defineProperty(exports, "abytes", { enumerable: true, get: function () { return utils_js_2.abytes; } });
Object.defineProperty(exports, "anumber", { enumerable: true, get: function () { return utils_js_2.anumber; } });
Object.defineProperty(exports, "bytesToHex", { enumerable: true, get: function () { return utils_js_2.bytesToHex; } });
Object.defineProperty(exports, "bytesToUtf8", { enumerable: true, get: function () { return utils_js_2.bytesToUtf8; } });
Object.defineProperty(exports, "concatBytes", { enumerable: true, get: function () { return utils_js_2.concatBytes; } });
Object.defineProperty(exports, "hexToBytes", { enumerable: true, get: function () { return utils_js_2.hexToBytes; } });
Object.defineProperty(exports, "isBytes", { enumerable: true, get: function () { return utils_js_2.isBytes; } });
Object.defineProperty(exports, "randomBytes", { enumerable: true, get: function () { return utils_js_2.randomBytes; } });
Object.defineProperty(exports, "utf8ToBytes", { enumerable: true, get: function () { return utils_js_2.utf8ToBytes; } });
const _0n = /* @__PURE__ */ BigInt(0);
const _1n = /* @__PURE__ */ BigInt(1);
function abool(title, value) {
    if (typeof value !== 'boolean')
        throw new Error(title + ' boolean expected, got ' + value);
}
// tmp name until v2
function _abool2(value, title = '') {
    if (typeof value !== 'boolean') {
        const prefix = title && `"${title}"`;
        throw new Error(prefix + 'expected boolean, got type=' + typeof value);
    }
    return value;
}
// tmp name until v2
/** Asserts something is Uint8Array. */
function _abytes2(value, length, title = '') {
    const bytes = (0, utils_js_1.isBytes)(value);
    const len = value?.length;
    const needsLen = length !== undefined;
    if (!bytes || (needsLen && len !== length)) {
        const prefix = title && `"${title}" `;
        const ofLen = needsLen ? ` of length ${length}` : '';
        const got = bytes ? `length=${len}` : `type=${typeof value}`;
        throw new Error(prefix + 'expected Uint8Array' + ofLen + ', got ' + got);
    }
    return value;
}
// Used in weierstrass, der
function numberToHexUnpadded(num) {
    const hex = num.toString(16);
    return hex.length & 1 ? '0' + hex : hex;
}
function hexToNumber(hex) {
    if (typeof hex !== 'string')
        throw new Error('hex string expected, got ' + typeof hex);
    return hex === '' ? _0n : BigInt('0x' + hex); // Big Endian
}
// BE: Big Endian, LE: Little Endian
function bytesToNumberBE(bytes) {
    return hexToNumber((0, utils_js_1.bytesToHex)(bytes));
}
function bytesToNumberLE(bytes) {
    (0, utils_js_1.abytes)(bytes);
    return hexToNumber((0, utils_js_1.bytesToHex)(Uint8Array.from(bytes).reverse()));
}
function numberToBytesBE(n, len) {
    return (0, utils_js_1.hexToBytes)(n.toString(16).padStart(len * 2, '0'));
}
function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
}
// Unpadded, rarely used
function numberToVarBytesBE(n) {
    return (0, utils_js_1.hexToBytes)(numberToHexUnpadded(n));
}
/**
 * Takes hex string or Uint8Array, converts to Uint8Array.
 * Validates output length.
 * Will throw error for other types.
 * @param title descriptive title for an error e.g. 'secret key'
 * @param hex hex string or Uint8Array
 * @param expectedLength optional, will compare to result array's length
 * @returns
 */
function ensureBytes(title, hex, expectedLength) {
    let res;
    if (typeof hex === 'string') {
        try {
            res = (0, utils_js_1.hexToBytes)(hex);
        }
        catch (e) {
            throw new Error(title + ' must be hex string or Uint8Array, cause: ' + e);
        }
    }
    else if ((0, utils_js_1.isBytes)(hex)) {
        // Uint8Array.from() instead of hash.slice() because node.js Buffer
        // is instance of Uint8Array, and its slice() creates **mutable** copy
        res = Uint8Array.from(hex);
    }
    else {
        throw new Error(title + ' must be hex string or Uint8Array');
    }
    const len = res.length;
    if (typeof expectedLength === 'number' && len !== expectedLength)
        throw new Error(title + ' of length ' + expectedLength + ' expected, got ' + len);
    return res;
}
// Compares 2 u8a-s in kinda constant time
function equalBytes(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
/**
 * Copies Uint8Array. We can't use u8a.slice(), because u8a can be Buffer,
 * and Buffer#slice creates mutable copy. Never use Buffers!
 */
function copyBytes(bytes) {
    return Uint8Array.from(bytes);
}
/**
 * Decodes 7-bit ASCII string to Uint8Array, throws on non-ascii symbols
 * Should be safe to use for things expected to be ASCII.
 * Returns exact same result as utf8ToBytes for ASCII or throws.
 */
function asciiToBytes(ascii) {
    return Uint8Array.from(ascii, (c, i) => {
        const charCode = c.charCodeAt(0);
        if (c.length !== 1 || charCode > 127) {
            throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
        }
        return charCode;
    });
}
/**
 * @example utf8ToBytes('abc') // new Uint8Array([97, 98, 99])
 */
// export const utf8ToBytes: typeof utf8ToBytes_ = utf8ToBytes_;
/**
 * Converts bytes to string using UTF8 encoding.
 * @example bytesToUtf8(Uint8Array.from([97, 98, 99])) // 'abc'
 */
// export const bytesToUtf8: typeof bytesToUtf8_ = bytesToUtf8_;
// Is positive bigint
const isPosBig = (n) => typeof n === 'bigint' && _0n <= n;
function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
/**
 * Asserts min <= n < max. NOTE: It's < max and not <= max.
 * @example
 * aInRange('x', x, 1n, 256n); // would assume x is in (1n..255n)
 */
function aInRange(title, n, min, max) {
    // Why min <= n < max and not a (min < n < max) OR b (min <= n <= max)?
    // consider P=256n, min=0n, max=P
    // - a for min=0 would require -1:          `inRange('x', x, -1n, P)`
    // - b would commonly require subtraction:  `inRange('x', x, 0n, P - 1n)`
    // - our way is the cleanest:               `inRange('x', x, 0n, P)
    if (!inRange(n, min, max))
        throw new Error('expected valid ' + title + ': ' + min + ' <= n < ' + max + ', got ' + n);
}
// Bit operations
/**
 * Calculates amount of bits in a bigint.
 * Same as `n.toString(2).length`
 * TODO: merge with nLength in modular
 */
function bitLen(n) {
    let len;
    for (len = 0; n > _0n; n >>= _1n, len += 1)
        ;
    return len;
}
/**
 * Gets single bit at position.
 * NOTE: first bit position is 0 (same as arrays)
 * Same as `!!+Array.from(n.toString(2)).reverse()[pos]`
 */
function bitGet(n, pos) {
    return (n >> BigInt(pos)) & _1n;
}
/**
 * Sets single bit at position.
 */
function bitSet(n, pos, value) {
    return n | ((value ? _1n : _0n) << BigInt(pos));
}
/**
 * Calculate mask for N bits. Not using ** operator with bigints because of old engines.
 * Same as BigInt(`0b${Array(i).fill('1').join('')}`)
 */
const bitMask = (n) => (_1n << BigInt(n)) - _1n;
exports.bitMask = bitMask;
/**
 * Minimal HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
 * @returns function that will call DRBG until 2nd arg returns something meaningful
 * @example
 *   const drbg = createHmacDRBG<Key>(32, 32, hmac);
 *   drbg(seed, bytesToKey); // bytesToKey must return Key or undefined
 */
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
    if (typeof hashLen !== 'number' || hashLen < 2)
        throw new Error('hashLen must be a number');
    if (typeof qByteLen !== 'number' || qByteLen < 2)
        throw new Error('qByteLen must be a number');
    if (typeof hmacFn !== 'function')
        throw new Error('hmacFn must be a function');
    // Step B, Step C: set hashLen to 8*ceil(hlen/8)
    const u8n = (len) => new Uint8Array(len); // creates Uint8Array
    const u8of = (byte) => Uint8Array.of(byte); // another shortcut
    let v = u8n(hashLen); // Minimal non-full-spec HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
    let k = u8n(hashLen); // Steps B and C of RFC6979 3.2: set hashLen, in our case always same
    let i = 0; // Iterations counter, will throw when over 1000
    const reset = () => {
        v.fill(1);
        k.fill(0);
        i = 0;
    };
    const h = (...b) => hmacFn(k, v, ...b); // hmac(k)(v, ...values)
    const reseed = (seed = u8n(0)) => {
        // HMAC-DRBG reseed() function. Steps D-G
        k = h(u8of(0x00), seed); // k = hmac(k || v || 0x00 || seed)
        v = h(); // v = hmac(k || v)
        if (seed.length === 0)
            return;
        k = h(u8of(0x01), seed); // k = hmac(k || v || 0x01 || seed)
        v = h(); // v = hmac(k || v)
    };
    const gen = () => {
        // HMAC-DRBG generate() function
        if (i++ >= 1000)
            throw new Error('drbg: tried 1000 values');
        let len = 0;
        const out = [];
        while (len < qByteLen) {
            v = h();
            const sl = v.slice();
            out.push(sl);
            len += v.length;
        }
        return (0, utils_js_1.concatBytes)(...out);
    };
    const genUntil = (seed, pred) => {
        reset();
        reseed(seed); // Steps D-G
        let res = undefined; // Step H: grind until k is in [1..n-1]
        while (!(res = pred(gen())))
            reseed();
        reset();
        return res;
    };
    return genUntil;
}
// Validating curves and fields
const validatorFns = {
    bigint: (val) => typeof val === 'bigint',
    function: (val) => typeof val === 'function',
    boolean: (val) => typeof val === 'boolean',
    string: (val) => typeof val === 'string',
    stringOrUint8Array: (val) => typeof val === 'string' || (0, utils_js_1.isBytes)(val),
    isSafeInteger: (val) => Number.isSafeInteger(val),
    array: (val) => Array.isArray(val),
    field: (val, object) => object.Fp.isValid(val),
    hash: (val) => typeof val === 'function' && Number.isSafeInteger(val.outputLen),
};
// type Record<K extends string | number | symbol, T> = { [P in K]: T; }
function validateObject(object, validators, optValidators = {}) {
    const checkField = (fieldName, type, isOptional) => {
        const checkVal = validatorFns[type];
        if (typeof checkVal !== 'function')
            throw new Error('invalid validator function');
        const val = object[fieldName];
        if (isOptional && val === undefined)
            return;
        if (!checkVal(val, object)) {
            throw new Error('param ' + String(fieldName) + ' is invalid. Expected ' + type + ', got ' + val);
        }
    };
    for (const [fieldName, type] of Object.entries(validators))
        checkField(fieldName, type, false);
    for (const [fieldName, type] of Object.entries(optValidators))
        checkField(fieldName, type, true);
    return object;
}
// validate type tests
// const o: { a: number; b: number; c: number } = { a: 1, b: 5, c: 6 };
// const z0 = validateObject(o, { a: 'isSafeInteger' }, { c: 'bigint' }); // Ok!
// // Should fail type-check
// const z1 = validateObject(o, { a: 'tmp' }, { c: 'zz' });
// const z2 = validateObject(o, { a: 'isSafeInteger' }, { c: 'zz' });
// const z3 = validateObject(o, { test: 'boolean', z: 'bug' });
// const z4 = validateObject(o, { a: 'boolean', z: 'bug' });
function isHash(val) {
    return typeof val === 'function' && Number.isSafeInteger(val.outputLen);
}
function _validateObject(object, fields, optFields = {}) {
    if (!object || typeof object !== 'object')
        throw new Error('expected valid options object');
    function checkField(fieldName, expectedType, isOpt) {
        const val = object[fieldName];
        if (isOpt && val === undefined)
            return;
        const current = typeof val;
        if (current !== expectedType || val === null)
            throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    Object.entries(fields).forEach(([k, v]) => checkField(k, v, false));
    Object.entries(optFields).forEach(([k, v]) => checkField(k, v, true));
}
/**
 * throws not implemented error
 */
const notImplemented = () => {
    throw new Error('not implemented');
};
exports.notImplemented = notImplemented;
/**
 * Memoizes (caches) computation result.
 * Uses WeakMap: the value is going auto-cleaned by GC after last reference is removed.
 */
function memoized(fn) {
    const map = new WeakMap();
    return (arg, ...args) => {
        const val = map.get(arg);
        if (val !== undefined)
            return val;
        const computed = fn(arg, ...args);
        map.set(arg, computed);
        return computed;
    };
}

},{"@noble/hashes/utils.js":13}],9:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHA512_IV = exports.SHA384_IV = exports.SHA224_IV = exports.SHA256_IV = exports.HashMD = void 0;
exports.setBigUint64 = setBigUint64;
exports.Chi = Chi;
exports.Maj = Maj;
/**
 * Internal Merkle-Damgard hash utils.
 * @module
 */
const utils_ts_1 = require("./utils.js");
/** Polyfill for Safari 14. https://caniuse.com/mdn-javascript_builtins_dataview_setbiguint64 */
function setBigUint64(view, byteOffset, value, isLE) {
    if (typeof view.setBigUint64 === 'function')
        return view.setBigUint64(byteOffset, value, isLE);
    const _32n = BigInt(32);
    const _u32_max = BigInt(0xffffffff);
    const wh = Number((value >> _32n) & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE ? 4 : 0;
    const l = isLE ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE);
    view.setUint32(byteOffset + l, wl, isLE);
}
/** Choice: a ? b : c */
function Chi(a, b, c) {
    return (a & b) ^ (~a & c);
}
/** Majority function, true if any two inputs is true. */
function Maj(a, b, c) {
    return (a & b) ^ (a & c) ^ (b & c);
}
/**
 * Merkle-Damgard hash construction base class.
 * Could be used to create MD5, RIPEMD, SHA1, SHA2.
 */
class HashMD extends utils_ts_1.Hash {
    constructor(blockLen, outputLen, padOffset, isLE) {
        super();
        this.finished = false;
        this.length = 0;
        this.pos = 0;
        this.destroyed = false;
        this.blockLen = blockLen;
        this.outputLen = outputLen;
        this.padOffset = padOffset;
        this.isLE = isLE;
        this.buffer = new Uint8Array(blockLen);
        this.view = (0, utils_ts_1.createView)(this.buffer);
    }
    update(data) {
        (0, utils_ts_1.aexists)(this);
        data = (0, utils_ts_1.toBytes)(data);
        (0, utils_ts_1.abytes)(data);
        const { view, buffer, blockLen } = this;
        const len = data.length;
        for (let pos = 0; pos < len;) {
            const take = Math.min(blockLen - this.pos, len - pos);
            // Fast path: we have at least one block in input, cast it to view and process
            if (take === blockLen) {
                const dataView = (0, utils_ts_1.createView)(data);
                for (; blockLen <= len - pos; pos += blockLen)
                    this.process(dataView, pos);
                continue;
            }
            buffer.set(data.subarray(pos, pos + take), this.pos);
            this.pos += take;
            pos += take;
            if (this.pos === blockLen) {
                this.process(view, 0);
                this.pos = 0;
            }
        }
        this.length += data.length;
        this.roundClean();
        return this;
    }
    digestInto(out) {
        (0, utils_ts_1.aexists)(this);
        (0, utils_ts_1.aoutput)(out, this);
        this.finished = true;
        // Padding
        // We can avoid allocation of buffer for padding completely if it
        // was previously not allocated here. But it won't change performance.
        const { buffer, view, blockLen, isLE } = this;
        let { pos } = this;
        // append the bit '1' to the message
        buffer[pos++] = 0b10000000;
        (0, utils_ts_1.clean)(this.buffer.subarray(pos));
        // we have less than padOffset left in buffer, so we cannot put length in
        // current block, need process it and pad again
        if (this.padOffset > blockLen - pos) {
            this.process(view, 0);
            pos = 0;
        }
        // Pad until full block byte with zeros
        for (let i = pos; i < blockLen; i++)
            buffer[i] = 0;
        // Note: sha512 requires length to be 128bit integer, but length in JS will overflow before that
        // You need to write around 2 exabytes (u64_max / 8 / (1024**6)) for this to happen.
        // So we just write lowest 64 bits of that value.
        setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE);
        this.process(view, 0);
        const oview = (0, utils_ts_1.createView)(out);
        const len = this.outputLen;
        // NOTE: we do division by 4 later, which should be fused in single op with modulo by JIT
        if (len % 4)
            throw new Error('_sha2: outputLen should be aligned to 32bit');
        const outLen = len / 4;
        const state = this.get();
        if (outLen > state.length)
            throw new Error('_sha2: outputLen bigger than state');
        for (let i = 0; i < outLen; i++)
            oview.setUint32(4 * i, state[i], isLE);
    }
    digest() {
        const { buffer, outputLen } = this;
        this.digestInto(buffer);
        const res = buffer.slice(0, outputLen);
        this.destroy();
        return res;
    }
    _cloneInto(to) {
        to || (to = new this.constructor());
        to.set(...this.get());
        const { blockLen, buffer, length, finished, destroyed, pos } = this;
        to.destroyed = destroyed;
        to.finished = finished;
        to.length = length;
        to.pos = pos;
        if (length % blockLen)
            to.buffer.set(buffer);
        return to;
    }
    clone() {
        return this._cloneInto();
    }
}
exports.HashMD = HashMD;
/**
 * Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
 * Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
 */
/** Initial SHA256 state. Bits 0..32 of frac part of sqrt of primes 2..19 */
exports.SHA256_IV = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
/** Initial SHA224 state. Bits 32..64 of frac part of sqrt of primes 23..53 */
exports.SHA224_IV = Uint32Array.from([
    0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4,
]);
/** Initial SHA384 state. Bits 0..64 of frac part of sqrt of primes 23..53 */
exports.SHA384_IV = Uint32Array.from([
    0xcbbb9d5d, 0xc1059ed8, 0x629a292a, 0x367cd507, 0x9159015a, 0x3070dd17, 0x152fecd8, 0xf70e5939,
    0x67332667, 0xffc00b31, 0x8eb44a87, 0x68581511, 0xdb0c2e0d, 0x64f98fa7, 0x47b5481d, 0xbefa4fa4,
]);
/** Initial SHA512 state. Bits 0..64 of frac part of sqrt of primes 2..19 */
exports.SHA512_IV = Uint32Array.from([
    0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1,
    0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179,
]);

},{"./utils.js":13}],10:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBig = exports.shrSL = exports.shrSH = exports.rotrSL = exports.rotrSH = exports.rotrBL = exports.rotrBH = exports.rotr32L = exports.rotr32H = exports.rotlSL = exports.rotlSH = exports.rotlBL = exports.rotlBH = exports.add5L = exports.add5H = exports.add4L = exports.add4H = exports.add3L = exports.add3H = void 0;
exports.add = add;
exports.fromBig = fromBig;
exports.split = split;
/**
 * Internal helpers for u64. BigUint64Array is too slow as per 2025, so we implement it using Uint32Array.
 * @todo re-check https://issues.chromium.org/issues/42212588
 * @module
 */
const U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
const _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
    if (le)
        return { h: Number(n & U32_MASK64), l: Number((n >> _32n) & U32_MASK64) };
    return { h: Number((n >> _32n) & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
        const { h, l } = fromBig(lst[i], le);
        [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
}
const toBig = (h, l) => (BigInt(h >>> 0) << _32n) | BigInt(l >>> 0);
exports.toBig = toBig;
// for Shift in [0, 32)
const shrSH = (h, _l, s) => h >>> s;
exports.shrSH = shrSH;
const shrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.shrSL = shrSL;
// Right rotate for Shift in [1, 32)
const rotrSH = (h, l, s) => (h >>> s) | (l << (32 - s));
exports.rotrSH = rotrSH;
const rotrSL = (h, l, s) => (h << (32 - s)) | (l >>> s);
exports.rotrSL = rotrSL;
// Right rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotrBH = (h, l, s) => (h << (64 - s)) | (l >>> (s - 32));
exports.rotrBH = rotrBH;
const rotrBL = (h, l, s) => (h >>> (s - 32)) | (l << (64 - s));
exports.rotrBL = rotrBL;
// Right rotate for shift===32 (just swaps l&h)
const rotr32H = (_h, l) => l;
exports.rotr32H = rotr32H;
const rotr32L = (h, _l) => h;
exports.rotr32L = rotr32L;
// Left rotate for Shift in [1, 32)
const rotlSH = (h, l, s) => (h << s) | (l >>> (32 - s));
exports.rotlSH = rotlSH;
const rotlSL = (h, l, s) => (l << s) | (h >>> (32 - s));
exports.rotlSL = rotlSL;
// Left rotate for Shift in (32, 64), NOTE: 32 is special case.
const rotlBH = (h, l, s) => (l << (s - 32)) | (h >>> (64 - s));
exports.rotlBH = rotlBH;
const rotlBL = (h, l, s) => (h << (s - 32)) | (l >>> (64 - s));
exports.rotlBL = rotlBL;
// JS uses 32-bit signed integers for bitwise operations which means we cannot
// simple take carry out of low bit sum by shift, we need to use division.
function add(Ah, Al, Bh, Bl) {
    const l = (Al >>> 0) + (Bl >>> 0);
    return { h: (Ah + Bh + ((l / 2 ** 32) | 0)) | 0, l: l | 0 };
}
// Addition with more than 2 elements
const add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
exports.add3L = add3L;
const add3H = (low, Ah, Bh, Ch) => (Ah + Bh + Ch + ((low / 2 ** 32) | 0)) | 0;
exports.add3H = add3H;
const add4L = (Al, Bl, Cl, Dl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0);
exports.add4L = add4L;
const add4H = (low, Ah, Bh, Ch, Dh) => (Ah + Bh + Ch + Dh + ((low / 2 ** 32) | 0)) | 0;
exports.add4H = add4H;
const add5L = (Al, Bl, Cl, Dl, El) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0) + (Dl >>> 0) + (El >>> 0);
exports.add5L = add5L;
const add5H = (low, Ah, Bh, Ch, Dh, Eh) => (Ah + Bh + Ch + Dh + Eh + ((low / 2 ** 32) | 0)) | 0;
exports.add5H = add5H;
// prettier-ignore
const u64 = {
    fromBig, split, toBig,
    shrSH, shrSL,
    rotrSH, rotrSL, rotrBH, rotrBL,
    rotr32H, rotr32L,
    rotlSH, rotlSL, rotlBH, rotlBL,
    add, add3L, add3H, add4L, add4H, add5H, add5L,
};
exports.default = u64;

},{}],11:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crypto = void 0;
exports.crypto = typeof globalThis === 'object' && 'crypto' in globalThis ? globalThis.crypto : undefined;

},{}],12:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha512_224 = exports.sha512_256 = exports.sha384 = exports.sha512 = exports.sha224 = exports.sha256 = exports.SHA512_256 = exports.SHA512_224 = exports.SHA384 = exports.SHA512 = exports.SHA224 = exports.SHA256 = void 0;
/**
 * SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
 * SHA256 is the fastest hash implementable in JS, even faster than Blake3.
 * Check out [RFC 4634](https://datatracker.ietf.org/doc/html/rfc4634) and
 * [FIPS 180-4](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf).
 * @module
 */
const _md_ts_1 = require("./_md.js");
const u64 = require("./_u64.js");
const utils_ts_1 = require("./utils.js");
/**
 * Round constants:
 * First 32 bits of fractional parts of the cube roots of the first 64 primes 2..311)
 */
// prettier-ignore
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);
/** Reusable temporary buffer. "W" comes straight from spec. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
class SHA256 extends _md_ts_1.HashMD {
    constructor(outputLen = 32) {
        super(64, outputLen, 8, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        this.A = _md_ts_1.SHA256_IV[0] | 0;
        this.B = _md_ts_1.SHA256_IV[1] | 0;
        this.C = _md_ts_1.SHA256_IV[2] | 0;
        this.D = _md_ts_1.SHA256_IV[3] | 0;
        this.E = _md_ts_1.SHA256_IV[4] | 0;
        this.F = _md_ts_1.SHA256_IV[5] | 0;
        this.G = _md_ts_1.SHA256_IV[6] | 0;
        this.H = _md_ts_1.SHA256_IV[7] | 0;
    }
    get() {
        const { A, B, C, D, E, F, G, H } = this;
        return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
        this.A = A | 0;
        this.B = B | 0;
        this.C = C | 0;
        this.D = D | 0;
        this.E = E | 0;
        this.F = F | 0;
        this.G = G | 0;
        this.H = H | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 48 words w[16..63] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4)
            SHA256_W[i] = view.getUint32(offset, false);
        for (let i = 16; i < 64; i++) {
            const W15 = SHA256_W[i - 15];
            const W2 = SHA256_W[i - 2];
            const s0 = (0, utils_ts_1.rotr)(W15, 7) ^ (0, utils_ts_1.rotr)(W15, 18) ^ (W15 >>> 3);
            const s1 = (0, utils_ts_1.rotr)(W2, 17) ^ (0, utils_ts_1.rotr)(W2, 19) ^ (W2 >>> 10);
            SHA256_W[i] = (s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16]) | 0;
        }
        // Compression function main loop, 64 rounds
        let { A, B, C, D, E, F, G, H } = this;
        for (let i = 0; i < 64; i++) {
            const sigma1 = (0, utils_ts_1.rotr)(E, 6) ^ (0, utils_ts_1.rotr)(E, 11) ^ (0, utils_ts_1.rotr)(E, 25);
            const T1 = (H + sigma1 + (0, _md_ts_1.Chi)(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const sigma0 = (0, utils_ts_1.rotr)(A, 2) ^ (0, utils_ts_1.rotr)(A, 13) ^ (0, utils_ts_1.rotr)(A, 22);
            const T2 = (sigma0 + (0, _md_ts_1.Maj)(A, B, C)) | 0;
            H = G;
            G = F;
            F = E;
            E = (D + T1) | 0;
            D = C;
            C = B;
            B = A;
            A = (T1 + T2) | 0;
        }
        // Add the compressed chunk to the current hash value
        A = (A + this.A) | 0;
        B = (B + this.B) | 0;
        C = (C + this.C) | 0;
        D = (D + this.D) | 0;
        E = (E + this.E) | 0;
        F = (F + this.F) | 0;
        G = (G + this.G) | 0;
        H = (H + this.H) | 0;
        this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA256_W);
    }
    destroy() {
        this.set(0, 0, 0, 0, 0, 0, 0, 0);
        (0, utils_ts_1.clean)(this.buffer);
    }
}
exports.SHA256 = SHA256;
class SHA224 extends SHA256 {
    constructor() {
        super(28);
        this.A = _md_ts_1.SHA224_IV[0] | 0;
        this.B = _md_ts_1.SHA224_IV[1] | 0;
        this.C = _md_ts_1.SHA224_IV[2] | 0;
        this.D = _md_ts_1.SHA224_IV[3] | 0;
        this.E = _md_ts_1.SHA224_IV[4] | 0;
        this.F = _md_ts_1.SHA224_IV[5] | 0;
        this.G = _md_ts_1.SHA224_IV[6] | 0;
        this.H = _md_ts_1.SHA224_IV[7] | 0;
    }
}
exports.SHA224 = SHA224;
// SHA2-512 is slower than sha256 in js because u64 operations are slow.
// Round contants
// First 32 bits of the fractional parts of the cube roots of the first 80 primes 2..409
// prettier-ignore
const K512 = /* @__PURE__ */ (() => u64.split([
    '0x428a2f98d728ae22', '0x7137449123ef65cd', '0xb5c0fbcfec4d3b2f', '0xe9b5dba58189dbbc',
    '0x3956c25bf348b538', '0x59f111f1b605d019', '0x923f82a4af194f9b', '0xab1c5ed5da6d8118',
    '0xd807aa98a3030242', '0x12835b0145706fbe', '0x243185be4ee4b28c', '0x550c7dc3d5ffb4e2',
    '0x72be5d74f27b896f', '0x80deb1fe3b1696b1', '0x9bdc06a725c71235', '0xc19bf174cf692694',
    '0xe49b69c19ef14ad2', '0xefbe4786384f25e3', '0x0fc19dc68b8cd5b5', '0x240ca1cc77ac9c65',
    '0x2de92c6f592b0275', '0x4a7484aa6ea6e483', '0x5cb0a9dcbd41fbd4', '0x76f988da831153b5',
    '0x983e5152ee66dfab', '0xa831c66d2db43210', '0xb00327c898fb213f', '0xbf597fc7beef0ee4',
    '0xc6e00bf33da88fc2', '0xd5a79147930aa725', '0x06ca6351e003826f', '0x142929670a0e6e70',
    '0x27b70a8546d22ffc', '0x2e1b21385c26c926', '0x4d2c6dfc5ac42aed', '0x53380d139d95b3df',
    '0x650a73548baf63de', '0x766a0abb3c77b2a8', '0x81c2c92e47edaee6', '0x92722c851482353b',
    '0xa2bfe8a14cf10364', '0xa81a664bbc423001', '0xc24b8b70d0f89791', '0xc76c51a30654be30',
    '0xd192e819d6ef5218', '0xd69906245565a910', '0xf40e35855771202a', '0x106aa07032bbd1b8',
    '0x19a4c116b8d2d0c8', '0x1e376c085141ab53', '0x2748774cdf8eeb99', '0x34b0bcb5e19b48a8',
    '0x391c0cb3c5c95a63', '0x4ed8aa4ae3418acb', '0x5b9cca4f7763e373', '0x682e6ff3d6b2b8a3',
    '0x748f82ee5defb2fc', '0x78a5636f43172f60', '0x84c87814a1f0ab72', '0x8cc702081a6439ec',
    '0x90befffa23631e28', '0xa4506cebde82bde9', '0xbef9a3f7b2c67915', '0xc67178f2e372532b',
    '0xca273eceea26619c', '0xd186b8c721c0c207', '0xeada7dd6cde0eb1e', '0xf57d4f7fee6ed178',
    '0x06f067aa72176fba', '0x0a637dc5a2c898a6', '0x113f9804bef90dae', '0x1b710b35131c471b',
    '0x28db77f523047d84', '0x32caab7b40c72493', '0x3c9ebe0a15c9bebc', '0x431d67c49c100d4c',
    '0x4cc5d4becb3e42b6', '0x597f299cfc657e2a', '0x5fcb6fab3ad6faec', '0x6c44198c4a475817'
].map(n => BigInt(n))))();
const SHA512_Kh = /* @__PURE__ */ (() => K512[0])();
const SHA512_Kl = /* @__PURE__ */ (() => K512[1])();
// Reusable temporary buffers
const SHA512_W_H = /* @__PURE__ */ new Uint32Array(80);
const SHA512_W_L = /* @__PURE__ */ new Uint32Array(80);
class SHA512 extends _md_ts_1.HashMD {
    constructor(outputLen = 64) {
        super(128, outputLen, 16, false);
        // We cannot use array here since array allows indexing by variable
        // which means optimizer/compiler cannot use registers.
        // h -- high 32 bits, l -- low 32 bits
        this.Ah = _md_ts_1.SHA512_IV[0] | 0;
        this.Al = _md_ts_1.SHA512_IV[1] | 0;
        this.Bh = _md_ts_1.SHA512_IV[2] | 0;
        this.Bl = _md_ts_1.SHA512_IV[3] | 0;
        this.Ch = _md_ts_1.SHA512_IV[4] | 0;
        this.Cl = _md_ts_1.SHA512_IV[5] | 0;
        this.Dh = _md_ts_1.SHA512_IV[6] | 0;
        this.Dl = _md_ts_1.SHA512_IV[7] | 0;
        this.Eh = _md_ts_1.SHA512_IV[8] | 0;
        this.El = _md_ts_1.SHA512_IV[9] | 0;
        this.Fh = _md_ts_1.SHA512_IV[10] | 0;
        this.Fl = _md_ts_1.SHA512_IV[11] | 0;
        this.Gh = _md_ts_1.SHA512_IV[12] | 0;
        this.Gl = _md_ts_1.SHA512_IV[13] | 0;
        this.Hh = _md_ts_1.SHA512_IV[14] | 0;
        this.Hl = _md_ts_1.SHA512_IV[15] | 0;
    }
    // prettier-ignore
    get() {
        const { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        return [Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl];
    }
    // prettier-ignore
    set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl) {
        this.Ah = Ah | 0;
        this.Al = Al | 0;
        this.Bh = Bh | 0;
        this.Bl = Bl | 0;
        this.Ch = Ch | 0;
        this.Cl = Cl | 0;
        this.Dh = Dh | 0;
        this.Dl = Dl | 0;
        this.Eh = Eh | 0;
        this.El = El | 0;
        this.Fh = Fh | 0;
        this.Fl = Fl | 0;
        this.Gh = Gh | 0;
        this.Gl = Gl | 0;
        this.Hh = Hh | 0;
        this.Hl = Hl | 0;
    }
    process(view, offset) {
        // Extend the first 16 words into the remaining 64 words w[16..79] of the message schedule array
        for (let i = 0; i < 16; i++, offset += 4) {
            SHA512_W_H[i] = view.getUint32(offset);
            SHA512_W_L[i] = view.getUint32((offset += 4));
        }
        for (let i = 16; i < 80; i++) {
            // s0 := (w[i-15] rightrotate 1) xor (w[i-15] rightrotate 8) xor (w[i-15] rightshift 7)
            const W15h = SHA512_W_H[i - 15] | 0;
            const W15l = SHA512_W_L[i - 15] | 0;
            const s0h = u64.rotrSH(W15h, W15l, 1) ^ u64.rotrSH(W15h, W15l, 8) ^ u64.shrSH(W15h, W15l, 7);
            const s0l = u64.rotrSL(W15h, W15l, 1) ^ u64.rotrSL(W15h, W15l, 8) ^ u64.shrSL(W15h, W15l, 7);
            // s1 := (w[i-2] rightrotate 19) xor (w[i-2] rightrotate 61) xor (w[i-2] rightshift 6)
            const W2h = SHA512_W_H[i - 2] | 0;
            const W2l = SHA512_W_L[i - 2] | 0;
            const s1h = u64.rotrSH(W2h, W2l, 19) ^ u64.rotrBH(W2h, W2l, 61) ^ u64.shrSH(W2h, W2l, 6);
            const s1l = u64.rotrSL(W2h, W2l, 19) ^ u64.rotrBL(W2h, W2l, 61) ^ u64.shrSL(W2h, W2l, 6);
            // SHA256_W[i] = s0 + s1 + SHA256_W[i - 7] + SHA256_W[i - 16];
            const SUMl = u64.add4L(s0l, s1l, SHA512_W_L[i - 7], SHA512_W_L[i - 16]);
            const SUMh = u64.add4H(SUMl, s0h, s1h, SHA512_W_H[i - 7], SHA512_W_H[i - 16]);
            SHA512_W_H[i] = SUMh | 0;
            SHA512_W_L[i] = SUMl | 0;
        }
        let { Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl } = this;
        // Compression function main loop, 80 rounds
        for (let i = 0; i < 80; i++) {
            // S1 := (e rightrotate 14) xor (e rightrotate 18) xor (e rightrotate 41)
            const sigma1h = u64.rotrSH(Eh, El, 14) ^ u64.rotrSH(Eh, El, 18) ^ u64.rotrBH(Eh, El, 41);
            const sigma1l = u64.rotrSL(Eh, El, 14) ^ u64.rotrSL(Eh, El, 18) ^ u64.rotrBL(Eh, El, 41);
            //const T1 = (H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i]) | 0;
            const CHIh = (Eh & Fh) ^ (~Eh & Gh);
            const CHIl = (El & Fl) ^ (~El & Gl);
            // T1 = H + sigma1 + Chi(E, F, G) + SHA512_K[i] + SHA512_W[i]
            // prettier-ignore
            const T1ll = u64.add5L(Hl, sigma1l, CHIl, SHA512_Kl[i], SHA512_W_L[i]);
            const T1h = u64.add5H(T1ll, Hh, sigma1h, CHIh, SHA512_Kh[i], SHA512_W_H[i]);
            const T1l = T1ll | 0;
            // S0 := (a rightrotate 28) xor (a rightrotate 34) xor (a rightrotate 39)
            const sigma0h = u64.rotrSH(Ah, Al, 28) ^ u64.rotrBH(Ah, Al, 34) ^ u64.rotrBH(Ah, Al, 39);
            const sigma0l = u64.rotrSL(Ah, Al, 28) ^ u64.rotrBL(Ah, Al, 34) ^ u64.rotrBL(Ah, Al, 39);
            const MAJh = (Ah & Bh) ^ (Ah & Ch) ^ (Bh & Ch);
            const MAJl = (Al & Bl) ^ (Al & Cl) ^ (Bl & Cl);
            Hh = Gh | 0;
            Hl = Gl | 0;
            Gh = Fh | 0;
            Gl = Fl | 0;
            Fh = Eh | 0;
            Fl = El | 0;
            ({ h: Eh, l: El } = u64.add(Dh | 0, Dl | 0, T1h | 0, T1l | 0));
            Dh = Ch | 0;
            Dl = Cl | 0;
            Ch = Bh | 0;
            Cl = Bl | 0;
            Bh = Ah | 0;
            Bl = Al | 0;
            const All = u64.add3L(T1l, sigma0l, MAJl);
            Ah = u64.add3H(All, T1h, sigma0h, MAJh);
            Al = All | 0;
        }
        // Add the compressed chunk to the current hash value
        ({ h: Ah, l: Al } = u64.add(this.Ah | 0, this.Al | 0, Ah | 0, Al | 0));
        ({ h: Bh, l: Bl } = u64.add(this.Bh | 0, this.Bl | 0, Bh | 0, Bl | 0));
        ({ h: Ch, l: Cl } = u64.add(this.Ch | 0, this.Cl | 0, Ch | 0, Cl | 0));
        ({ h: Dh, l: Dl } = u64.add(this.Dh | 0, this.Dl | 0, Dh | 0, Dl | 0));
        ({ h: Eh, l: El } = u64.add(this.Eh | 0, this.El | 0, Eh | 0, El | 0));
        ({ h: Fh, l: Fl } = u64.add(this.Fh | 0, this.Fl | 0, Fh | 0, Fl | 0));
        ({ h: Gh, l: Gl } = u64.add(this.Gh | 0, this.Gl | 0, Gh | 0, Gl | 0));
        ({ h: Hh, l: Hl } = u64.add(this.Hh | 0, this.Hl | 0, Hh | 0, Hl | 0));
        this.set(Ah, Al, Bh, Bl, Ch, Cl, Dh, Dl, Eh, El, Fh, Fl, Gh, Gl, Hh, Hl);
    }
    roundClean() {
        (0, utils_ts_1.clean)(SHA512_W_H, SHA512_W_L);
    }
    destroy() {
        (0, utils_ts_1.clean)(this.buffer);
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    }
}
exports.SHA512 = SHA512;
class SHA384 extends SHA512 {
    constructor() {
        super(48);
        this.Ah = _md_ts_1.SHA384_IV[0] | 0;
        this.Al = _md_ts_1.SHA384_IV[1] | 0;
        this.Bh = _md_ts_1.SHA384_IV[2] | 0;
        this.Bl = _md_ts_1.SHA384_IV[3] | 0;
        this.Ch = _md_ts_1.SHA384_IV[4] | 0;
        this.Cl = _md_ts_1.SHA384_IV[5] | 0;
        this.Dh = _md_ts_1.SHA384_IV[6] | 0;
        this.Dl = _md_ts_1.SHA384_IV[7] | 0;
        this.Eh = _md_ts_1.SHA384_IV[8] | 0;
        this.El = _md_ts_1.SHA384_IV[9] | 0;
        this.Fh = _md_ts_1.SHA384_IV[10] | 0;
        this.Fl = _md_ts_1.SHA384_IV[11] | 0;
        this.Gh = _md_ts_1.SHA384_IV[12] | 0;
        this.Gl = _md_ts_1.SHA384_IV[13] | 0;
        this.Hh = _md_ts_1.SHA384_IV[14] | 0;
        this.Hl = _md_ts_1.SHA384_IV[15] | 0;
    }
}
exports.SHA384 = SHA384;
/**
 * Truncated SHA512/256 and SHA512/224.
 * SHA512_IV is XORed with 0xa5a5a5a5a5a5a5a5, then used as "intermediary" IV of SHA512/t.
 * Then t hashes string to produce result IV.
 * See `test/misc/sha2-gen-iv.js`.
 */
/** SHA512/224 IV */
const T224_IV = /* @__PURE__ */ Uint32Array.from([
    0x8c3d37c8, 0x19544da2, 0x73e19966, 0x89dcd4d6, 0x1dfab7ae, 0x32ff9c82, 0x679dd514, 0x582f9fcf,
    0x0f6d2b69, 0x7bd44da8, 0x77e36f73, 0x04c48942, 0x3f9d85a8, 0x6a1d36c8, 0x1112e6ad, 0x91d692a1,
]);
/** SHA512/256 IV */
const T256_IV = /* @__PURE__ */ Uint32Array.from([
    0x22312194, 0xfc2bf72c, 0x9f555fa3, 0xc84c64c2, 0x2393b86b, 0x6f53b151, 0x96387719, 0x5940eabd,
    0x96283ee2, 0xa88effe3, 0xbe5e1e25, 0x53863992, 0x2b0199fc, 0x2c85b8aa, 0x0eb72ddc, 0x81c52ca2,
]);
class SHA512_224 extends SHA512 {
    constructor() {
        super(28);
        this.Ah = T224_IV[0] | 0;
        this.Al = T224_IV[1] | 0;
        this.Bh = T224_IV[2] | 0;
        this.Bl = T224_IV[3] | 0;
        this.Ch = T224_IV[4] | 0;
        this.Cl = T224_IV[5] | 0;
        this.Dh = T224_IV[6] | 0;
        this.Dl = T224_IV[7] | 0;
        this.Eh = T224_IV[8] | 0;
        this.El = T224_IV[9] | 0;
        this.Fh = T224_IV[10] | 0;
        this.Fl = T224_IV[11] | 0;
        this.Gh = T224_IV[12] | 0;
        this.Gl = T224_IV[13] | 0;
        this.Hh = T224_IV[14] | 0;
        this.Hl = T224_IV[15] | 0;
    }
}
exports.SHA512_224 = SHA512_224;
class SHA512_256 extends SHA512 {
    constructor() {
        super(32);
        this.Ah = T256_IV[0] | 0;
        this.Al = T256_IV[1] | 0;
        this.Bh = T256_IV[2] | 0;
        this.Bl = T256_IV[3] | 0;
        this.Ch = T256_IV[4] | 0;
        this.Cl = T256_IV[5] | 0;
        this.Dh = T256_IV[6] | 0;
        this.Dl = T256_IV[7] | 0;
        this.Eh = T256_IV[8] | 0;
        this.El = T256_IV[9] | 0;
        this.Fh = T256_IV[10] | 0;
        this.Fl = T256_IV[11] | 0;
        this.Gh = T256_IV[12] | 0;
        this.Gl = T256_IV[13] | 0;
        this.Hh = T256_IV[14] | 0;
        this.Hl = T256_IV[15] | 0;
    }
}
exports.SHA512_256 = SHA512_256;
/**
 * SHA2-256 hash function from RFC 4634.
 *
 * It is the fastest JS hash, even faster than Blake3.
 * To break sha256 using birthday attack, attackers need to try 2^128 hashes.
 * BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
 */
exports.sha256 = (0, utils_ts_1.createHasher)(() => new SHA256());
/** SHA2-224 hash function from RFC 4634 */
exports.sha224 = (0, utils_ts_1.createHasher)(() => new SHA224());
/** SHA2-512 hash function from RFC 4634. */
exports.sha512 = (0, utils_ts_1.createHasher)(() => new SHA512());
/** SHA2-384 hash function from RFC 4634. */
exports.sha384 = (0, utils_ts_1.createHasher)(() => new SHA384());
/**
 * SHA2-512/256 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_256 = (0, utils_ts_1.createHasher)(() => new SHA512_256());
/**
 * SHA2-512/224 "truncated" hash function, with improved resistance to length extension attacks.
 * See the paper on [truncated SHA512](https://eprint.iacr.org/2010/548.pdf).
 */
exports.sha512_224 = (0, utils_ts_1.createHasher)(() => new SHA512_224());

},{"./_md.js":9,"./_u64.js":10,"./utils.js":13}],13:[function(require,module,exports){
"use strict";
/**
 * Utilities for hex, bytes, CSPRNG.
 * @module
 */
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapXOFConstructorWithOpts = exports.wrapConstructorWithOpts = exports.wrapConstructor = exports.Hash = exports.nextTick = exports.swap32IfBE = exports.byteSwapIfBE = exports.swap8IfBE = exports.isLE = void 0;
exports.isBytes = isBytes;
exports.anumber = anumber;
exports.abytes = abytes;
exports.ahash = ahash;
exports.aexists = aexists;
exports.aoutput = aoutput;
exports.u8 = u8;
exports.u32 = u32;
exports.clean = clean;
exports.createView = createView;
exports.rotr = rotr;
exports.rotl = rotl;
exports.byteSwap = byteSwap;
exports.byteSwap32 = byteSwap32;
exports.bytesToHex = bytesToHex;
exports.hexToBytes = hexToBytes;
exports.asyncLoop = asyncLoop;
exports.utf8ToBytes = utf8ToBytes;
exports.bytesToUtf8 = bytesToUtf8;
exports.toBytes = toBytes;
exports.kdfInputToBytes = kdfInputToBytes;
exports.concatBytes = concatBytes;
exports.checkOpts = checkOpts;
exports.createHasher = createHasher;
exports.createOptHasher = createOptHasher;
exports.createXOFer = createXOFer;
exports.randomBytes = randomBytes;
// We use WebCrypto aka globalThis.crypto, which exists in browsers and node.js 16+.
// node.js versions earlier than v19 don't declare it in global scope.
// For node.js, package.json#exports field mapping rewrites import
// from `crypto` to `cryptoNode`, which imports native module.
// Makes the utils un-importable in browsers without a bundler.
// Once node.js 18 is deprecated (2025-04-30), we can just drop the import.
const crypto_1 = require("@noble/hashes/crypto");
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes(a) {
    return a instanceof Uint8Array || (ArrayBuffer.isView(a) && a.constructor.name === 'Uint8Array');
}
/** Asserts something is positive integer. */
function anumber(n) {
    if (!Number.isSafeInteger(n) || n < 0)
        throw new Error('positive integer expected, got ' + n);
}
/** Asserts something is Uint8Array. */
function abytes(b, ...lengths) {
    if (!isBytes(b))
        throw new Error('Uint8Array expected');
    if (lengths.length > 0 && !lengths.includes(b.length))
        throw new Error('Uint8Array expected of length ' + lengths + ', got length=' + b.length);
}
/** Asserts something is hash */
function ahash(h) {
    if (typeof h !== 'function' || typeof h.create !== 'function')
        throw new Error('Hash should be wrapped by utils.createHasher');
    anumber(h.outputLen);
    anumber(h.blockLen);
}
/** Asserts a hash instance has not been destroyed / finished */
function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
        throw new Error('Hash instance has been destroyed');
    if (checkFinished && instance.finished)
        throw new Error('Hash#digest() has already been called');
}
/** Asserts output is properly-sized byte array */
function aoutput(out, instance) {
    abytes(out);
    const min = instance.outputLen;
    if (out.length < min) {
        throw new Error('digestInto() expects output buffer of length at least ' + min);
    }
}
/** Cast u8 / u16 / u32 to u8. */
function u8(arr) {
    return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** Cast u8 / u16 / u32 to u32. */
function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
        arrays[i].fill(0);
    }
}
/** Create DataView of an array for easy byte-level manipulation. */
function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** The rotate right (circular right shift) operation for uint32 */
function rotr(word, shift) {
    return (word << (32 - shift)) | (word >>> shift);
}
/** The rotate left (circular left shift) operation for uint32 */
function rotl(word, shift) {
    return (word << shift) | ((word >>> (32 - shift)) >>> 0);
}
/** Is current platform little-endian? Most are. Big-Endian platform: IBM */
exports.isLE = (() => new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44)();
/** The byte swap operation for uint32 */
function byteSwap(word) {
    return (((word << 24) & 0xff000000) |
        ((word << 8) & 0xff0000) |
        ((word >>> 8) & 0xff00) |
        ((word >>> 24) & 0xff));
}
/** Conditionally byte swap if on a big-endian platform */
exports.swap8IfBE = exports.isLE
    ? (n) => n
    : (n) => byteSwap(n);
/** @deprecated */
exports.byteSwapIfBE = exports.swap8IfBE;
/** In place byte swap for Uint32Array */
function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
        arr[i] = byteSwap(arr[i]);
    }
    return arr;
}
exports.swap32IfBE = exports.isLE
    ? (u) => u
    : byteSwap32;
// Built-in hex conversion https://caniuse.com/mdn-javascript_builtins_uint8array_fromhex
const hasHexBuiltin = /* @__PURE__ */ (() => 
// @ts-ignore
typeof Uint8Array.from([]).toHex === 'function' && typeof Uint8Array.fromHex === 'function')();
// Array where index 0xf0 (240) is mapped to string 'f0'
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
/**
 * Convert byte array to hex string. Uses built-in function, when available.
 * @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
 */
function bytesToHex(bytes) {
    abytes(bytes);
    // @ts-ignore
    if (hasHexBuiltin)
        return bytes.toHex();
    // pre-caching improves the speed 6x
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += hexes[bytes[i]];
    }
    return hex;
}
// We use optimized technique to convert hex string to byte array
const asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
        return ch - asciis._0; // '2' => 50-48
    if (ch >= asciis.A && ch <= asciis.F)
        return ch - (asciis.A - 10); // 'B' => 66-(65-10)
    if (ch >= asciis.a && ch <= asciis.f)
        return ch - (asciis.a - 10); // 'b' => 98-(97-10)
    return;
}
/**
 * Convert hex string to byte array. Uses built-in function, when available.
 * @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
 */
function hexToBytes(hex) {
    if (typeof hex !== 'string')
        throw new Error('hex string expected, got ' + typeof hex);
    // @ts-ignore
    if (hasHexBuiltin)
        return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
        throw new Error('hex string expected, got unpadded hex of length ' + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
        const n1 = asciiToBase16(hex.charCodeAt(hi));
        const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
        if (n1 === undefined || n2 === undefined) {
            const char = hex[hi] + hex[hi + 1];
            throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
        }
        array[ai] = n1 * 16 + n2; // multiply first octet, e.g. 'a3' => 10*16+3 => 160 + 3 => 163
    }
    return array;
}
/**
 * There is no setImmediate in browser and setTimeout is slow.
 * Call of async fn will return Promise, which will be fullfiled only on
 * next scheduler queue processing step and this is exactly what we need.
 */
const nextTick = async () => { };
exports.nextTick = nextTick;
/** Returns control to thread each 'tick' ms to avoid blocking. */
async function asyncLoop(iters, tick, cb) {
    let ts = Date.now();
    for (let i = 0; i < iters; i++) {
        cb(i);
        // Date.now() is not monotonic, so in case if clock goes backwards we return return control too
        const diff = Date.now() - ts;
        if (diff >= 0 && diff < tick)
            continue;
        await (0, exports.nextTick)();
        ts += diff;
    }
}
/**
 * Converts string to bytes using UTF8 encoding.
 * @example utf8ToBytes('abc') // Uint8Array.from([97, 98, 99])
 */
function utf8ToBytes(str) {
    if (typeof str !== 'string')
        throw new Error('string expected');
    return new Uint8Array(new TextEncoder().encode(str)); // https://bugzil.la/1681809
}
/**
 * Converts bytes to string using UTF8 encoding.
 * @example bytesToUtf8(Uint8Array.from([97, 98, 99])) // 'abc'
 */
function bytesToUtf8(bytes) {
    return new TextDecoder().decode(bytes);
}
/**
 * Normalizes (non-hex) string or Uint8Array to Uint8Array.
 * Warning: when Uint8Array is passed, it would NOT get copied.
 * Keep in mind for future mutable operations.
 */
function toBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/**
 * Helper for KDFs: consumes uint8array or string.
 * When string is passed, does utf8 decoding, using TextDecoder.
 */
function kdfInputToBytes(data) {
    if (typeof data === 'string')
        data = utf8ToBytes(data);
    abytes(data);
    return data;
}
/** Copies several Uint8Arrays into one. */
function concatBytes(...arrays) {
    let sum = 0;
    for (let i = 0; i < arrays.length; i++) {
        const a = arrays[i];
        abytes(a);
        sum += a.length;
    }
    const res = new Uint8Array(sum);
    for (let i = 0, pad = 0; i < arrays.length; i++) {
        const a = arrays[i];
        res.set(a, pad);
        pad += a.length;
    }
    return res;
}
function checkOpts(defaults, opts) {
    if (opts !== undefined && {}.toString.call(opts) !== '[object Object]')
        throw new Error('options should be object or undefined');
    const merged = Object.assign(defaults, opts);
    return merged;
}
/** For runtime check if class implements interface */
class Hash {
}
exports.Hash = Hash;
/** Wraps hash function, creating an interface on top of it */
function createHasher(hashCons) {
    const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
}
function createOptHasher(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
function createXOFer(hashCons) {
    const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
    const tmp = hashCons({});
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts) => hashCons(opts);
    return hashC;
}
exports.wrapConstructor = createHasher;
exports.wrapConstructorWithOpts = createOptHasher;
exports.wrapXOFConstructorWithOpts = createXOFer;
/** Cryptographically secure PRNG. Uses internal OS-level `crypto.getRandomValues`. */
function randomBytes(bytesLength = 32) {
    if (crypto_1.crypto && typeof crypto_1.crypto.getRandomValues === 'function') {
        return crypto_1.crypto.getRandomValues(new Uint8Array(bytesLength));
    }
    // Legacy Node.js compatibility
    if (crypto_1.crypto && typeof crypto_1.crypto.randomBytes === 'function') {
        return Uint8Array.from(crypto_1.crypto.randomBytes(bytesLength));
    }
    throw new Error('crypto.getRandomValues must be defined');
}

},{"@noble/hashes/crypto":11}],14:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var walletStandardUtil = require('@solana/wallet-standard-util');

// Typescript `enums` thwart tree-shaking. See https://bargsten.org/jsts/enums/
const SolanaMobileWalletAdapterErrorCode = {
    ERROR_ASSOCIATION_PORT_OUT_OF_RANGE: 'ERROR_ASSOCIATION_PORT_OUT_OF_RANGE',
    ERROR_REFLECTOR_ID_OUT_OF_RANGE: 'ERROR_REFLECTOR_ID_OUT_OF_RANGE',
    ERROR_FORBIDDEN_WALLET_BASE_URL: 'ERROR_FORBIDDEN_WALLET_BASE_URL',
    ERROR_SECURE_CONTEXT_REQUIRED: 'ERROR_SECURE_CONTEXT_REQUIRED',
    ERROR_SESSION_CLOSED: 'ERROR_SESSION_CLOSED',
    ERROR_SESSION_TIMEOUT: 'ERROR_SESSION_TIMEOUT',
    ERROR_WALLET_NOT_FOUND: 'ERROR_WALLET_NOT_FOUND',
    ERROR_INVALID_PROTOCOL_VERSION: 'ERROR_INVALID_PROTOCOL_VERSION',
    ERROR_BROWSER_NOT_SUPPORTED: 'ERROR_BROWSER_NOT_SUPPORTED',
};
class SolanaMobileWalletAdapterError extends Error {
    constructor(...args) {
        const [code, message, data] = args;
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'SolanaMobileWalletAdapterError';
    }
}
// Typescript `enums` thwart tree-shaking. See https://bargsten.org/jsts/enums/
const SolanaMobileWalletAdapterProtocolErrorCode = {
    // Keep these in sync with `mobilewalletadapter/common/ProtocolContract.java`.
    ERROR_AUTHORIZATION_FAILED: -1,
    ERROR_INVALID_PAYLOADS: -2,
    ERROR_NOT_SIGNED: -3,
    ERROR_NOT_SUBMITTED: -4,
    ERROR_TOO_MANY_PAYLOADS: -5,
    ERROR_ATTEST_ORIGIN_ANDROID: -100,
};
class SolanaMobileWalletAdapterProtocolError extends Error {
    constructor(...args) {
        const [jsonRpcMessageId, code, message, data] = args;
        super(message);
        this.code = code;
        this.data = data;
        this.jsonRpcMessageId = jsonRpcMessageId;
        this.name = 'SolanaMobileWalletAdapterProtocolError';
    }
}

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        //console.log(`__awaiter called with thisArg:`, thisArg, `, _arguments:`, _arguments, `, P:`, P, `, generator:`, generator);
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

function encode(input) {
    return window.btoa(input);
}
function fromUint8Array(byteArray, urlsafe) {
    const base64 = window.btoa(String.fromCharCode.call(null, ...byteArray));
    if (urlsafe) {
        return base64
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }
    else
        return base64;
}
function toUint8Array(base64EncodedByteArray) {
    return new Uint8Array(window
        .atob(base64EncodedByteArray)
        .split('')
        .map((c) => c.charCodeAt(0)));
}

function createHelloReq(ecdhPublicKey, associationKeypairPrivateKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const publicKeyBuffer = yield crypto.subtle.exportKey('raw', ecdhPublicKey);
        const signatureBuffer = yield crypto.subtle.sign({ hash: 'SHA-256', name: 'ECDSA' }, associationKeypairPrivateKey, publicKeyBuffer);
        const response = new Uint8Array(publicKeyBuffer.byteLength + signatureBuffer.byteLength);
        response.set(new Uint8Array(publicKeyBuffer), 0);
        response.set(new Uint8Array(signatureBuffer), publicKeyBuffer.byteLength);
        return response;
    });
}

function createSIWSMessage(payload) {
    return walletStandardUtil.createSignInMessageText(payload);
}
function createSIWSMessageBase64(payload) {
    return encode(createSIWSMessage(payload));
}

// optional features
const SolanaSignTransactions = 'solana:signTransactions';
const SolanaCloneAuthorization = 'solana:cloneAuthorization';
const SolanaSignInWithSolana = 'solana:signInWithSolana';

/**
 * Creates a {@link MobileWallet} proxy that handles backwards compatibility and API to RPC conversion.
 *
 * @param protocolVersion the protocol version in use for this session/request
 * @param protocolRequestHandler callback function that handles sending the RPC request to the wallet endpoint.
 * @returns a {@link MobileWallet} proxy
 */
function createMobileWalletProxy(protocolVersion, protocolRequestHandler) {
    return new Proxy({}, {
        get(target, p) {
            // Wrapping a Proxy in a promise results in the Proxy being asked for a 'then' property so must 
            // return null if 'then' is called on this proxy to let the 'resolve()' call know this is not a promise.
            // see: https://stackoverflow.com/a/53890904
            //@ts-ignore
            if (p === 'then') {
                return null;
            }
            if (target[p] == null) {
                target[p] = function (inputParams) {
                    return __awaiter(this, void 0, void 0, function* () {
                        const { method, params } = handleMobileWalletRequest(p, inputParams, protocolVersion);
                        console.log(`yielding protocolRequestHandler`);
                        const result = yield protocolRequestHandler(method, params);
                        // if the request tried to sign in but the wallet did not return a sign in result, fallback on message signing
                        console.log(`MobileWallet response: ${method}, result:`, result, `protocolVersion: ${protocolVersion}`);
                        if (method === 'authorize' && params.sign_in_payload && !result.sign_in_result) {
                            console.log('No sign_in_result returned, falling back to sign in with message');
                            result['sign_in_result'] = yield signInFallback(params.sign_in_payload, result, protocolRequestHandler);
                            console.log('Sign in result:', result.sign_in_result);
                        }
                        return handleMobileWalletResponse(p, result, protocolVersion);
                    });
                };
            }
            return target[p];
        },
        defineProperty() {
            return false;
        },
        deleteProperty() {
            return false;
        },
    });
}
/**
 * Handles all {@link MobileWallet} API requests and determines the correct MWA RPC method and params to call.
 * This handles backwards compatibility, based on the provided @protocolVersion.
 *
 * @param methodName the name of {@link MobileWallet} method that was called
 * @param methodParams the parameters that were passed to the method
 * @param protocolVersion the protocol version in use for this session/request
 * @returns the RPC request method and params that should be sent to the wallet endpoint
 */
function handleMobileWalletRequest(methodName, methodParams, protocolVersion) {
    let params = methodParams;
    let method = methodName
        .toString()
        .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
        .toLowerCase();
    console.log(`MobileWallet method: ${methodName}, params:`, params, `protocolVersion: ${protocolVersion}`);
    switch (methodName) {
        case 'authorize': {
            let { chain } = params;
            if (protocolVersion === 'legacy') {
                switch (chain) {
                    case 'solana:testnet': {
                        chain = 'testnet';
                        break;
                    }
                    case 'solana:devnet': {
                        chain = 'devnet';
                        break;
                    }
                    case 'mainnet-beta': {
                        chain = 'solana:mainnet';
                        break;
                    }
                    default: {
                        chain = params.cluster;
                    }
                }
                params.cluster = chain;
            }
            else {
                switch (chain) {
                    case 'testnet':
                    case 'devnet': {
                        chain = `solana:${chain}`;
                        break;
                    }
                    case 'mainnet-beta': {
                        chain = 'solana:mainnet';
                        break;
                    }
                }
                params.chain = chain;
            }
        }
        case 'reauthorize': {
            const { auth_token, identity } = params;
            if (auth_token) {
                switch (protocolVersion) {
                    case 'legacy': {
                        method = 'reauthorize';
                        params = { auth_token: auth_token, identity: identity };
                        break;
                    }
                    default: {
                        method = 'authorize';
                        break;
                    }
                }
            }
            break;
        }
    }
    return { method, params };
}
/**
 * Handles all {@link MobileWallet} API responses and modifies the response for backwards compatibility, if needed
 *
 * @param method the {@link MobileWallet} method that was called
 * @param response the original response that was returned by the method call
 * @param protocolVersion the protocol version in use for this session/request
 * @returns the possibly modified response
 */
function handleMobileWalletResponse(method, response, protocolVersion) {
    console.log(`MobileWallet response: ${method}, response:`, response, `protocolVersion: ${protocolVersion}`);
    switch (method) {
        case 'getCapabilities': {
            const capabilities = response;
            console.log('getCapabilities response:', capabilities);
            switch (protocolVersion) {
                case 'legacy': {
                    console.log('Legacy protocol version detected, converting capabilities');
                    const features = [SolanaSignTransactions];
                    if (capabilities.supports_clone_authorization === true) {
                        features.push(SolanaCloneAuthorization);
                    }
                    return Object.assign(Object.assign({}, capabilities), { features: features });
                }
                case 'v1': {
                    return Object.assign(Object.assign({}, capabilities), { supports_sign_and_send_transactions: true, supports_clone_authorization: capabilities.features.includes(SolanaCloneAuthorization) });
                }
            }
        }
    }
    return response;
}
function signInFallback(signInPayload, authorizationResult, protocolRequestHandler) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const domain = (_a = signInPayload.domain) !== null && _a !== void 0 ? _a : window.location.host;
        const address = authorizationResult.accounts[0].address;
        const siwsMessage = createSIWSMessageBase64(Object.assign(Object.assign({}, signInPayload), { domain, address }));
        const signMessageResult = yield protocolRequestHandler('sign_messages', {
            addresses: [address],
            payloads: [siwsMessage]
        });
        const signInResult = {
            address: address,
            signed_message: siwsMessage,
            signature: signMessageResult.signed_payloads[0].slice(siwsMessage.length)
        };
        return signInResult;
    });
}

const SEQUENCE_NUMBER_BYTES = 4;
function createSequenceNumberVector(sequenceNumber) {
    if (sequenceNumber >= 4294967296) {
        throw new Error('Outbound sequence number overflow. The maximum sequence number is 32-bytes.');
    }
    const byteArray = new ArrayBuffer(SEQUENCE_NUMBER_BYTES);
    const view = new DataView(byteArray);
    view.setUint32(0, sequenceNumber, /* littleEndian */ false);
    return new Uint8Array(byteArray);
}

const INITIALIZATION_VECTOR_BYTES = 12;
const ENCODED_PUBLIC_KEY_LENGTH_BYTES = 65;
function encryptMessage(plaintext, sequenceNumber, sharedSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const sequenceNumberVector = createSequenceNumberVector(sequenceNumber);
        const initializationVector = new Uint8Array(INITIALIZATION_VECTOR_BYTES);
        crypto.getRandomValues(initializationVector);
        const ciphertext = yield crypto.subtle.encrypt(getAlgorithmParams(sequenceNumberVector, initializationVector), sharedSecret, new TextEncoder().encode(plaintext));
        const response = new Uint8Array(sequenceNumberVector.byteLength + initializationVector.byteLength + ciphertext.byteLength);
        response.set(new Uint8Array(sequenceNumberVector), 0);
        response.set(new Uint8Array(initializationVector), sequenceNumberVector.byteLength);
        response.set(new Uint8Array(ciphertext), sequenceNumberVector.byteLength + initializationVector.byteLength);
        return response;
    });
}
function decryptMessage(message, sharedSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const sequenceNumberVector = message.slice(0, SEQUENCE_NUMBER_BYTES);
        const initializationVector = message.slice(SEQUENCE_NUMBER_BYTES, SEQUENCE_NUMBER_BYTES + INITIALIZATION_VECTOR_BYTES);
        const ciphertext = message.slice(SEQUENCE_NUMBER_BYTES + INITIALIZATION_VECTOR_BYTES);
        const plaintextBuffer = yield crypto.subtle.decrypt(getAlgorithmParams(sequenceNumberVector, initializationVector), sharedSecret, ciphertext);
        const plaintext = getUtf8Decoder().decode(plaintextBuffer);
        return plaintext;
    });
}
function getAlgorithmParams(sequenceNumber, initializationVector) {
    return {
        additionalData: sequenceNumber,
        iv: initializationVector,
        name: 'AES-GCM',
        tagLength: 128, // 16 byte tag => 128 bits
    };
}
let _utf8Decoder;
function getUtf8Decoder() {
    if (_utf8Decoder === undefined) {
        _utf8Decoder = new TextDecoder('utf-8');
    }
    return _utf8Decoder;
}

function generateAssociationKeypair() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield crypto.subtle.generateKey({
            name: 'ECDSA',
            namedCurve: 'P-256',
        }, false /* extractable */, ['sign'] /* keyUsages */);
    });
}

function generateECDHKeypair() {
    return __awaiter(this, void 0, void 0, function* () {
        return yield crypto.subtle.generateKey({
            name: 'ECDH',
            namedCurve: 'P-256',
        }, false /* extractable */, ['deriveKey', 'deriveBits'] /* keyUsages */);
    });
}

// https://stackoverflow.com/a/9458996/802047
function arrayBufferToBase64String(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let ii = 0; ii < len; ii++) {
        binary += String.fromCharCode(bytes[ii]);
    }
    return window.btoa(binary);
}

function getRandomAssociationPort() {
    return assertAssociationPort(49152 + Math.floor(Math.random() * (65535 - 49152 + 1)));
}
function assertAssociationPort(port) {
    if (port < 49152 || port > 65535) {
        throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_ASSOCIATION_PORT_OUT_OF_RANGE, `Association port number must be between 49152 and 65535. ${port} given.`, { port });
    }
    return port;
}

function getStringWithURLUnsafeCharactersReplaced(unsafeBase64EncodedString) {
    return unsafeBase64EncodedString.replace(/[/+=]/g, (m) => ({
        '/': '_',
        '+': '-',
        '=': '.',
    }[m]));
}

const INTENT_NAME = 'solana-wallet';
function getPathParts(pathString) {
    return (pathString
        // Strip leading and trailing slashes
        .replace(/(^\/+|\/+$)/g, '')
        // Return an array of directories
        .split('/'));
}
function getIntentURL(methodPathname, intentUrlBase) {
    let baseUrl = null;
    if (intentUrlBase) {
        try {
            baseUrl = new URL(intentUrlBase);
        }
        catch (_a) { } // eslint-disable-line no-empty
        if (baseUrl === null) {
            throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_FORBIDDEN_WALLET_BASE_URL, 'Base URL is null');
        }
    }
    baseUrl || (baseUrl = new URL(`${INTENT_NAME}:/`));
    const pathname = methodPathname.startsWith('/')
        ? // Method is an absolute path. Replace it wholesale.
            methodPathname
        : // Method is a relative path. Merge it with the existing one.
            [...getPathParts(baseUrl.pathname), ...getPathParts(methodPathname)].join('/');
    return new URL(pathname, baseUrl);
}
function getAssociateAndroidIntentURL(associationPublicKey, putativePort, associationURLBase, protocolVersions = ['v1']) {
    return __awaiter(this, void 0, void 0, function* () {
        const associationPort = assertAssociationPort(putativePort);
        const exportedKey = yield crypto.subtle.exportKey('raw', associationPublicKey);
        const encodedKey = arrayBufferToBase64String(exportedKey);
        const url = getIntentURL('v1/associate/local', associationURLBase);
        url.searchParams.set('association', getStringWithURLUnsafeCharactersReplaced(encodedKey));
        url.searchParams.set('port', `${associationPort}`);
        protocolVersions.forEach((version) => {
            url.searchParams.set('v', version);
        });
        return url;
    });
}
function getRemoteAssociateAndroidIntentURL(associationPublicKey, hostAuthority, reflectorId, associationURLBase, protocolVersions = ['v1']) {
    return __awaiter(this, void 0, void 0, function* () {
        const exportedKey = yield crypto.subtle.exportKey('raw', associationPublicKey);
        const encodedKey = arrayBufferToBase64String(exportedKey);
        const url = getIntentURL('v1/associate/remote', associationURLBase);
        url.searchParams.set('association', getStringWithURLUnsafeCharactersReplaced(encodedKey));
        url.searchParams.set('reflector', `${hostAuthority}`);
        url.searchParams.set('id', `${fromUint8Array(reflectorId, true)}`);
        protocolVersions.forEach((version) => {
            url.searchParams.set('v', version);
        });
        return url;
    });
}

function encryptJsonRpcMessage(jsonRpcMessage, sharedSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const plaintext = JSON.stringify(jsonRpcMessage);
        const sequenceNumber = jsonRpcMessage.id;
        return encryptMessage(plaintext, sequenceNumber, sharedSecret);
    });
}
function decryptJsonRpcMessage(message, sharedSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const plaintext = yield decryptMessage(message, sharedSecret);
        const jsonRpcMessage = JSON.parse(plaintext);
        if (Object.hasOwnProperty.call(jsonRpcMessage, 'error')) {
            throw new SolanaMobileWalletAdapterProtocolError(jsonRpcMessage.id, jsonRpcMessage.error.code, jsonRpcMessage.error.message);
        }
        return jsonRpcMessage;
    });
}

function parseHelloRsp(payloadBuffer, // The X9.62-encoded wallet endpoint ephemeral ECDH public keypoint.
associationPublicKey, ecdhPrivateKey) {
    return __awaiter(this, void 0, void 0, function* () {
        const [associationPublicKeyBuffer, walletPublicKey] = yield Promise.all([
            crypto.subtle.exportKey('raw', associationPublicKey),
            crypto.subtle.importKey('raw', payloadBuffer.slice(0, ENCODED_PUBLIC_KEY_LENGTH_BYTES), { name: 'ECDH', namedCurve: 'P-256' }, false /* extractable */, [] /* keyUsages */),
        ]);
        const sharedSecret = yield crypto.subtle.deriveBits({ name: 'ECDH', public: walletPublicKey }, ecdhPrivateKey, 256);
        const ecdhSecretKey = yield crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false /* extractable */, ['deriveKey'] /* keyUsages */);
        const aesKeyMaterialVal = yield crypto.subtle.deriveKey({
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(associationPublicKeyBuffer),
            info: new Uint8Array(),
        }, ecdhSecretKey, { name: 'AES-GCM', length: 128 }, false /* extractable */, ['encrypt', 'decrypt']);
        return aesKeyMaterialVal;
    });
}

function parseSessionProps(message, sharedSecret) {
    return __awaiter(this, void 0, void 0, function* () {
        const plaintext = yield decryptMessage(message, sharedSecret);
        const jsonProperties = JSON.parse(plaintext);
        let protocolVersion = 'legacy';
        if (Object.hasOwnProperty.call(jsonProperties, 'v')) {
            switch (jsonProperties.v) {
                case 1:
                case '1':
                case 'v1':
                    protocolVersion = 'v1';
                    break;
                case 'legacy':
                    protocolVersion = 'legacy';
                    break;
                default:
                    throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_INVALID_PROTOCOL_VERSION, `Unknown/unsupported protocol version: ${jsonProperties.v}`);
            }
        }
        return ({
            protocol_version: protocolVersion
        });
    });
}

// Typescript `enums` thwart tree-shaking. See https://bargsten.org/jsts/enums/
const Browser = {
    Firefox: 0,
    Other: 1,
};
function assertUnreachable(x) {
    return x;
}
function getBrowser() {
    return Browser.Firefox;
    /*if(window.mobileDevice === "android")
        return Browser.Firefox;
    else
        return navigator.userAgent.indexOf('Firefox/') !== -1 ? Browser.Firefox : Browser.Other;*/
}
function getDetectionPromise() {
    console.log(">>> GET DETECTION PROMISE");
    // Chrome and others silently fail if a custom protocol is not supported.
    // For these, we wait to see if the browser is navigated away from in
    // a reasonable amount of time (ie. the native wallet opened).
    return new Promise((resolve, reject) => {
        function cleanup() {
            clearTimeout(timeoutId);
            document.removeEventListener('blur', handleBlur);
        }
        function handleBlur() {
            console.log(">> BLUR DETECTED IN WALLET ADAPTER");
            cleanup();
            resolve();
        }
        document.addEventListener('blur', handleBlur);
        const timeoutId = setTimeout(() => {
            console.log(">>> DETECTION TIMEOUT, REJECTING");
            cleanup();
            reject();
        }, 25000);
    });
}
let _frame = null;
function launchUrlThroughHiddenFrame(url) {
    if (_frame == null) {
        _frame = document.createElement('iframe');
        _frame.style.display = 'none';
        _frame.style.position = 'fixed';
        _frame.style.top = '0';
        _frame.style.left = '0';
        _frame.style.width = '1px';
        _frame.style.height = '1px';
        document.body.appendChild(_frame);
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    _frame.contentWindow.location.href = url.toString();

    console.log(">> frame launched with success?", _frame.contentWindow.location.href);
}
function launchAssociation(associationUrl) {
        console.log(">>> LAUNCH ASSOCIATION", associationUrl.toString());
    return __awaiter(this, void 0, void 0, function* () {
        if (associationUrl.protocol === 'https:') {
                        console.log(">>> LAUNCH ASSOCIATION HTTPS", associationUrl.toString());
            // The association URL is an Android 'App Link' or iOS 'Universal Link'.
            // These are regular web URLs that are designed to launch an app if it
            // is installed or load the actual target webpage if not.
            window.location.assign(associationUrl);
        }
        else {
            console.log(">>> LAUNCH ASSOCIATION CUSTOM PROTOCOL", associationUrl.toString());
            // The association URL has a custom protocol (eg. `solana-wallet:`)
            try {
                const browser = getBrowser();
                switch (browser) {
                    case Browser.Firefox:
                                                console.log("A");
                        // If a custom protocol is not supported in Firefox, it throws.
                        launchUrlThroughHiddenFrame(associationUrl);
                        // If we reached this line, it's supported.
                        break;
                    case Browser.Other: {
                                                console.log("B");
                        const detectionPromise = getDetectionPromise();
                                                console.log("B:", detectionPromise);
                        window.location.assign(associationUrl);
                        yield detectionPromise;
                        break;
                    }
                    default:
                        console.log("C", browser);
                        assertUnreachable(browser);
                }
            }
            catch (e) {
                throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_WALLET_NOT_FOUND, 'Found no installed wallet that supports the mobile wallet protocol.');
            }
        }
    });
}
function startSession(associationPublicKey, associationURLBase) {
        console.log(">>> START SESSION", associationPublicKey, associationURLBase);
    return __awaiter(this, void 0, void 0, function* () {
        const randomAssociationPort = getRandomAssociationPort();
        const associationUrl = yield getAssociateAndroidIntentURL(associationPublicKey, randomAssociationPort, associationURLBase);
        yield launchAssociation(associationUrl);
                console.log(">>> ASSOCIATION URL LAUNCHED", associationUrl.toString());
        return randomAssociationPort;
    });
}

const WEBSOCKET_CONNECTION_CONFIG = {
    /**
     * 300 milliseconds is a generally accepted threshold for what someone
     * would consider an acceptable response time for a user interface
     * after having performed a low-attention tapping task. We set the initial
     * interval at which we wait for the wallet to set up the websocket at
     * half this, as per the Nyquist frequency, with a progressive backoff
     * sequence from there. The total wait time is 30s, which allows for the
     * user to be presented with a disambiguation dialog, select a wallet, and
     * for the wallet app to subsequently start.
     */
    retryDelayScheduleMs: [150, 150, 200, 500, 500, 750, 750, 1000],
    timeoutMs: 30000,
};
const WEBSOCKET_PROTOCOL_BINARY = 'com.solana.mobilewalletadapter.v1';
const WEBSOCKET_PROTOCOL_BASE64 = 'com.solana.mobilewalletadapter.v1.base64';
function assertSecureContext() {
    /*if (typeof window === 'undefined' || window.isSecureContext !== true) {
        throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SECURE_CONTEXT_REQUIRED, 'The mobile wallet adapter protocol must be used in a secure context (`https`).');
    }*/
}
function assertSecureEndpointSpecificURI(walletUriBase) {
    let url;
    try {
        url = new URL(walletUriBase);
    }
    catch (_a) {
        throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_FORBIDDEN_WALLET_BASE_URL, 'Invalid base URL supplied by wallet');
    }
    if (url.protocol !== 'https:') {
        throw new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_FORBIDDEN_WALLET_BASE_URL, 'Base URLs supplied by wallets must be valid `https` URLs');
    }
}
function getSequenceNumberFromByteArray(byteArray) {
    const view = new DataView(byteArray);
    return view.getUint32(0, /* littleEndian */ false);
}
function decodeVarLong(byteArray) {
    var bytes = new Uint8Array(byteArray), l = byteArray.byteLength, limit = 10, value = 0, offset = 0, b;
    do {
        if (offset >= l || offset > limit)
            throw new RangeError('Failed to decode varint');
        b = bytes[offset++];
        value |= (b & 0x7F) << (7 * offset);
    } while (b >= 0x80);
    return { value, offset };
}
function getReflectorIdFromByteArray(byteArray) {
    let { value: length, offset } = decodeVarLong(byteArray);
    return new Uint8Array(byteArray.slice(offset, offset + length));
}
function transact(callback, config) {
    return __awaiter(this, void 0, void 0, function* () {
        const associationKeypair = yield generateAssociationKeypair();
        const sessionPort = yield startSession(associationKeypair.publicKey, config === null || config === void 0 ? void 0 : config.baseUri);
                console.log(">>> SESSION PORT", sessionPort);
        const websocketURL = `ws://localhost:${sessionPort}/solana-wallet`;
                console.log(">>> WEBSOCKET URL", websocketURL);
        let connectionStartTime;
        const getNextRetryDelayMs = (() => {
            const schedule = [...WEBSOCKET_CONNECTION_CONFIG.retryDelayScheduleMs];
            return () => (schedule.length > 1 ? schedule.shift() : schedule[0]);
        })();
        let nextJsonRpcMessageId = 1;
        let lastKnownInboundSequenceNumber = 0;
        let state = { __type: 'disconnected' };
        return new Promise((resolve, reject) => {
            let socket;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jsonRpcResponsePromises = {};
            const handleOpen = () => __awaiter(this, void 0, void 0, function* () {
                if (state.__type !== 'connecting') {
                    console.warn('Expected adapter state to be `connecting` at the moment the websocket opens. ' +
                        `Got \`${state.__type}\`.`);
                    return;
                }
                socket.removeEventListener('open', handleOpen);
                // previous versions of this library and walletlib incorrectly implemented the MWA session 
                // establishment protocol for local connections. The dapp is supposed to wait for the 
                // APP_PING message before sending the HELLO_REQ. Instead, the dapp was sending the HELLO_REQ 
                // immediately upon connection to the websocket server regardless of wether or not an 
                // APP_PING was sent by the wallet/websocket server. We must continue to support this behavior 
                // in case the user is using a wallet that has not updated their walletlib implementation. 
                const { associationKeypair } = state;
                const ecdhKeypair = yield generateECDHKeypair();
                console.log(">>> ECDH KEYPAIR GENERATED", ecdhKeypair.publicKey);
                socket.send(yield createHelloReq(ecdhKeypair.publicKey, associationKeypair.privateKey));
                                console.log(">>> HELLO_REQ SENT", associationKeypair.publicKey);
                state = {
                    __type: 'hello_req_sent',
                    associationPublicKey: associationKeypair.publicKey,
                    ecdhPrivateKey: ecdhKeypair.privateKey,
                };
            });
            const handleClose = (evt) => {
                if (evt.wasClean) {
                    state = { __type: 'disconnected' };
                }
                else {
                    reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_CLOSED, `The wallet session dropped unexpectedly (${evt.code}: ${evt.reason}).`, { closeEvent: evt }));
                }
                disposeSocket();
            };
            const handleError = (_evt) => __awaiter(this, void 0, void 0, function* () {
                disposeSocket();
                if (Date.now() - connectionStartTime >= WEBSOCKET_CONNECTION_CONFIG.timeoutMs) {
                    reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_TIMEOUT, `Failed to connect to the wallet websocket at ${websocketURL}.`));
                }
                else {
                    yield new Promise((resolve) => {
                        const retryDelayMs = getNextRetryDelayMs();
                        retryWaitTimeoutId = window.setTimeout(resolve, retryDelayMs);
                    });
                    attemptSocketConnection();
                }
            });
            const handleMessage = (evt) => __awaiter(this, void 0, void 0, function* () {
                const responseBuffer = yield evt.data.arrayBuffer();
                                console.log(">>> MESSAGE RECEIVED", responseBuffer.byteLength, responseBuffer);
                                console.log(">>> STATE", state.__type);


                switch (state.__type) {
                    case 'connecting':
                        if (responseBuffer.byteLength !== 0) {
                            throw new Error('Encountered unexpected message while connecting');
                        }
                        const ecdhKeypair = yield generateECDHKeypair();
                        socket.send(yield createHelloReq(ecdhKeypair.publicKey, associationKeypair.privateKey));
                        state = {
                            __type: 'hello_req_sent',
                            associationPublicKey: associationKeypair.publicKey,
                            ecdhPrivateKey: ecdhKeypair.privateKey,
                        };
                        break;
                    case 'connected':
                        try {
                            const sequenceNumberVector = responseBuffer.slice(0, SEQUENCE_NUMBER_BYTES);
                            const sequenceNumber = getSequenceNumberFromByteArray(sequenceNumberVector);
                            if (sequenceNumber !== (lastKnownInboundSequenceNumber + 1)) {
                                throw new Error('Encrypted message has invalid sequence number');
                            }
                            lastKnownInboundSequenceNumber = sequenceNumber;
                            const jsonRpcMessage = yield decryptJsonRpcMessage(responseBuffer, state.sharedSecret);
                            const responsePromise = jsonRpcResponsePromises[jsonRpcMessage.id];
                            delete jsonRpcResponsePromises[jsonRpcMessage.id];
                            responsePromise.resolve(jsonRpcMessage.result);
                        }
                        catch (e) {
                            if (e instanceof SolanaMobileWalletAdapterProtocolError) {
                                const responsePromise = jsonRpcResponsePromises[e.jsonRpcMessageId];
                                delete jsonRpcResponsePromises[e.jsonRpcMessageId];
                                responsePromise.reject(e);
                            }
                            else {
                                throw e;
                            }
                        }
                        break;
                    case 'hello_req_sent': {
                        // if we receive an APP_PING message (empty message), resend the HELLO_REQ (see above)
                        if (responseBuffer.byteLength === 0) {
                            const ecdhKeypair = yield generateECDHKeypair();
                            socket.send(yield createHelloReq(ecdhKeypair.publicKey, associationKeypair.privateKey));
                            state = {
                                __type: 'hello_req_sent',
                                associationPublicKey: associationKeypair.publicKey,
                                ecdhPrivateKey: ecdhKeypair.privateKey,
                            };
                            break;
                        }
                        const sharedSecret = yield parseHelloRsp(responseBuffer, state.associationPublicKey, state.ecdhPrivateKey);
                        const sessionPropertiesBuffer = responseBuffer.slice(ENCODED_PUBLIC_KEY_LENGTH_BYTES);
                        const sessionProperties = sessionPropertiesBuffer.byteLength !== 0
                            ? yield (() => __awaiter(this, void 0, void 0, function* () {
                                const sequenceNumberVector = sessionPropertiesBuffer.slice(0, SEQUENCE_NUMBER_BYTES);
                                const sequenceNumber = getSequenceNumberFromByteArray(sequenceNumberVector);
                                if (sequenceNumber !== (lastKnownInboundSequenceNumber + 1)) {
                                    throw new Error('Encrypted message has invalid sequence number');
                                }
                                lastKnownInboundSequenceNumber = sequenceNumber;
                                return parseSessionProps(sessionPropertiesBuffer, sharedSecret);
                            }))() : { protocol_version: 'legacy' };
                        state = { __type: 'connected', sharedSecret, sessionProperties };
                                                console.log(">>> CONNECTED", state.sessionProperties);
                                                console.log(">>> Creating MobileWalletProxy inside transact");
                        const wallet = createMobileWalletProxy(sessionProperties.protocol_version, (method, params) => __awaiter(this, void 0, void 0, function* () {
                            const id = nextJsonRpcMessageId++;
                            socket.send(yield encryptJsonRpcMessage({
                                id,
                                jsonrpc: '2.0',
                                method,
                                params: params !== null && params !== void 0 ? params : {},
                            }, sharedSecret));

                                                        console.log(`>>> Waiting for MobileWallet response: ${method}, id: ${id}`);
                            return new Promise((resolve, reject) => {
                                jsonRpcResponsePromises[id] = {
                                    resolve(result) {
                                        switch (method) {
                                            case 'authorize':
                                            case 'reauthorize': {
                                                const { wallet_uri_base } = result;
                                                if (wallet_uri_base != null) {
                                                    try {
                                                        assertSecureEndpointSpecificURI(wallet_uri_base);
                                                    }
                                                    catch (e) {
                                                        reject(e);
                                                        return;
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                        resolve(result);
                                    },
                                    reject,
                                };
                            });
                        }));
                        try {
                                console.log(">>> Calling callback with wallet", wallet);
                            resolve(yield callback(wallet));
                        }
                        catch (e) {
                                                        console.log(">>> Callback failed with error", e);
                            reject(e);
                        }
                        finally {
                                                        console.log(">>> Cleaning up socket");
                            disposeSocket();
                            socket.close();
                        }
                        break;
                    }
                }
            });
            let disposeSocket;
            let retryWaitTimeoutId;
            const attemptSocketConnection = () => {
                if (disposeSocket) {
                    disposeSocket();
                }
                state = { __type: 'connecting', associationKeypair };
                if (connectionStartTime === undefined) {
                    connectionStartTime = Date.now();
                }
                socket = new WebSocket(websocketURL, [WEBSOCKET_PROTOCOL_BINARY]);
                socket.addEventListener('open', handleOpen);
                socket.addEventListener('close', handleClose);
                socket.addEventListener('error', handleError);
                socket.addEventListener('message', handleMessage);
                disposeSocket = () => {
                    window.clearTimeout(retryWaitTimeoutId);
                    socket.removeEventListener('open', handleOpen);
                    socket.removeEventListener('close', handleClose);
                    socket.removeEventListener('error', handleError);
                    socket.removeEventListener('message', handleMessage);
                };
            };
            attemptSocketConnection();
        });
    });
}
function startRemoteScenario(config) {
    return __awaiter(this, void 0, void 0, function* () {
        const associationKeypair = yield generateAssociationKeypair();
        const websocketURL = `wss://${config === null || config === void 0 ? void 0 : config.remoteHostAuthority}/reflect`;
        let connectionStartTime;
        const getNextRetryDelayMs = (() => {
            const schedule = [...WEBSOCKET_CONNECTION_CONFIG.retryDelayScheduleMs];
            return () => (schedule.length > 1 ? schedule.shift() : schedule[0]);
        })();
        let nextJsonRpcMessageId = 1;
        let lastKnownInboundSequenceNumber = 0;
        let encoding;
        let state = { __type: 'disconnected' };
        let socket;
        let disposeSocket;
        let decodeBytes = (evt) => __awaiter(this, void 0, void 0, function* () {
            if (encoding == 'base64') { // base64 encoding
                const message = yield evt.data;
                return toUint8Array(message).buffer;
            }
            else {
                return yield evt.data.arrayBuffer();
            }
        });
        // Reflector Connection Phase
        // here we connect to the reflector and wait for the REFLECTOR_ID message 
        // so we build the association URL and return that back to the caller
        const associationUrl = yield new Promise((resolve, reject) => {
            const handleOpen = () => __awaiter(this, void 0, void 0, function* () {
                if (state.__type !== 'connecting') {
                    console.warn('Expected adapter state to be `connecting` at the moment the websocket opens. ' +
                        `Got \`${state.__type}\`.`);
                    return;
                }
                if (socket.protocol.includes(WEBSOCKET_PROTOCOL_BASE64)) {
                    encoding = 'base64';
                }
                else {
                    encoding = 'binary';
                }
                socket.removeEventListener('open', handleOpen);
            });
            const handleClose = (evt) => {
                if (evt.wasClean) {
                    state = { __type: 'disconnected' };
                }
                else {
                    reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_CLOSED, `The wallet session dropped unexpectedly (${evt.code}: ${evt.reason}).`, { closeEvent: evt }));
                }
                disposeSocket();
            };
            const handleError = (_evt) => __awaiter(this, void 0, void 0, function* () {
                disposeSocket();
                if (Date.now() - connectionStartTime >= WEBSOCKET_CONNECTION_CONFIG.timeoutMs) {
                    reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_TIMEOUT, `Failed to connect to the wallet websocket at ${websocketURL}.`));
                }
                else {
                    yield new Promise((resolve) => {
                        const retryDelayMs = getNextRetryDelayMs();
                        retryWaitTimeoutId = window.setTimeout(resolve, retryDelayMs);
                    });
                    attemptSocketConnection();
                }
            });
            const handleReflectorIdMessage = (evt) => __awaiter(this, void 0, void 0, function* () {
                const responseBuffer = yield decodeBytes(evt);
                if (state.__type === 'connecting') {
                    if (responseBuffer.byteLength == 0) {
                        throw new Error('Encountered unexpected message while connecting');
                    }
                    const reflectorId = getReflectorIdFromByteArray(responseBuffer);
                    state = {
                        __type: 'reflector_id_received',
                        reflectorId: reflectorId
                    };
                    const associationUrl = yield getRemoteAssociateAndroidIntentURL(associationKeypair.publicKey, config.remoteHostAuthority, reflectorId, config === null || config === void 0 ? void 0 : config.baseUri);
                    socket.removeEventListener('message', handleReflectorIdMessage);
                    resolve(associationUrl);
                }
            });
            let retryWaitTimeoutId;
            const attemptSocketConnection = () => {
                if (disposeSocket) {
                    disposeSocket();
                }
                state = { __type: 'connecting', associationKeypair };
                if (connectionStartTime === undefined) {
                    connectionStartTime = Date.now();
                }
                socket = new WebSocket(websocketURL, [WEBSOCKET_PROTOCOL_BINARY, WEBSOCKET_PROTOCOL_BASE64]);
                socket.addEventListener('open', handleOpen);
                socket.addEventListener('close', handleClose);
                socket.addEventListener('error', handleError);
                socket.addEventListener('message', handleReflectorIdMessage);
                disposeSocket = () => {
                    window.clearTimeout(retryWaitTimeoutId);
                    socket.removeEventListener('open', handleOpen);
                    socket.removeEventListener('close', handleClose);
                    socket.removeEventListener('error', handleError);
                    socket.removeEventListener('message', handleReflectorIdMessage);
                };
            };
            attemptSocketConnection();
        });
        // Wallet Connection Phase
        // here we return the association URL (containing the reflector ID) to the caller + 
        // a promise that will resolve the MobileWallet object once the wallet connects.
        let sessionEstablished = false;
        let handleClose;
        return { associationUrl, close: () => {
                socket.close();
                handleClose();
            }, wallet: new Promise((resolve, reject) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const jsonRpcResponsePromises = {};
                const handleMessage = (evt) => __awaiter(this, void 0, void 0, function* () {
                    const responseBuffer = yield decodeBytes(evt);
                    switch (state.__type) {
                        case 'reflector_id_received':
                            if (responseBuffer.byteLength !== 0) {
                                throw new Error('Encountered unexpected message while awaiting reflection');
                            }
                            const ecdhKeypair = yield generateECDHKeypair();
                            const binaryMsg = yield createHelloReq(ecdhKeypair.publicKey, associationKeypair.privateKey);
                            if (encoding == 'base64') {
                                socket.send(fromUint8Array(binaryMsg));
                            }
                            else {
                                socket.send(binaryMsg);
                            }
                            state = {
                                __type: 'hello_req_sent',
                                associationPublicKey: associationKeypair.publicKey,
                                ecdhPrivateKey: ecdhKeypair.privateKey,
                            };
                            break;
                        case 'connected':
                            try {
                                const sequenceNumberVector = responseBuffer.slice(0, SEQUENCE_NUMBER_BYTES);
                                const sequenceNumber = getSequenceNumberFromByteArray(sequenceNumberVector);
                                if (sequenceNumber !== (lastKnownInboundSequenceNumber + 1)) {
                                    throw new Error('Encrypted message has invalid sequence number');
                                }
                                lastKnownInboundSequenceNumber = sequenceNumber;
                                const jsonRpcMessage = yield decryptJsonRpcMessage(responseBuffer, state.sharedSecret);
                                const responsePromise = jsonRpcResponsePromises[jsonRpcMessage.id];
                                delete jsonRpcResponsePromises[jsonRpcMessage.id];
                                responsePromise.resolve(jsonRpcMessage.result);
                            }
                            catch (e) {
                                if (e instanceof SolanaMobileWalletAdapterProtocolError) {
                                    const responsePromise = jsonRpcResponsePromises[e.jsonRpcMessageId];
                                    delete jsonRpcResponsePromises[e.jsonRpcMessageId];
                                    responsePromise.reject(e);
                                }
                                else {
                                    throw e;
                                }
                            }
                            break;
                        case 'hello_req_sent': {
                            const sharedSecret = yield parseHelloRsp(responseBuffer, state.associationPublicKey, state.ecdhPrivateKey);
                            const sessionPropertiesBuffer = responseBuffer.slice(ENCODED_PUBLIC_KEY_LENGTH_BYTES);
                            const sessionProperties = sessionPropertiesBuffer.byteLength !== 0
                                ? yield (() => __awaiter(this, void 0, void 0, function* () {
                                    const sequenceNumberVector = sessionPropertiesBuffer.slice(0, SEQUENCE_NUMBER_BYTES);
                                    const sequenceNumber = getSequenceNumberFromByteArray(sequenceNumberVector);
                                    if (sequenceNumber !== (lastKnownInboundSequenceNumber + 1)) {
                                        throw new Error('Encrypted message has invalid sequence number');
                                    }
                                    lastKnownInboundSequenceNumber = sequenceNumber;
                                    return parseSessionProps(sessionPropertiesBuffer, sharedSecret);
                                }))() : { protocol_version: 'legacy' };
                            state = { __type: 'connected', sharedSecret, sessionProperties };
                                                        console.log(">>> CONNECTED", state.sessionProperties);
                                                        console.log(">>> Creating MobileWalletProxy inside startRemoteScenario");
                            const wallet = createMobileWalletProxy(sessionProperties.protocol_version, (method, params) => __awaiter(this, void 0, void 0, function* () {
                                const id = nextJsonRpcMessageId++;
                                const binaryMsg = yield encryptJsonRpcMessage({
                                    id,
                                    jsonrpc: '2.0',
                                    method,
                                    params: params !== null && params !== void 0 ? params : {},
                                }, sharedSecret);
                                if (encoding == 'base64') {
                                    socket.send(fromUint8Array(binaryMsg));
                                }
                                else {
                                    socket.send(binaryMsg);
                                }
                                return new Promise((resolve, reject) => {
                                    jsonRpcResponsePromises[id] = {
                                        resolve(result) {
                                            switch (method) {
                                                case 'authorize':
                                                case 'reauthorize': {
                                                    const { wallet_uri_base } = result;
                                                    if (wallet_uri_base != null) {
                                                        try {
                                                            assertSecureEndpointSpecificURI(wallet_uri_base);
                                                        }
                                                        catch (e) {
                                                            reject(e);
                                                            return;
                                                        }
                                                    }
                                                    break;
                                                }
                                            }
                                            resolve(result);
                                        },
                                        reject,
                                    };
                                });
                            }));
                            sessionEstablished = true;
                            try {
                                resolve(wallet);
                            }
                            catch (e) {
                                reject(e);
                            }
                            break;
                        }
                    }
                });
                socket.addEventListener('message', handleMessage);
                handleClose = () => {
                    socket.removeEventListener('message', handleMessage);
                    disposeSocket();
                    if (!sessionEstablished) {
                        reject(new SolanaMobileWalletAdapterError(SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_CLOSED, `The wallet session was closed before connection.`, { closeEvent: new CloseEvent('socket was closed before connection') }));
                    }
                };
            }) };
    });
}

exports.SolanaCloneAuthorization = SolanaCloneAuthorization;
exports.SolanaMobileWalletAdapterError = SolanaMobileWalletAdapterError;
exports.SolanaMobileWalletAdapterErrorCode = SolanaMobileWalletAdapterErrorCode;
exports.SolanaMobileWalletAdapterProtocolError = SolanaMobileWalletAdapterProtocolError;
exports.SolanaMobileWalletAdapterProtocolErrorCode = SolanaMobileWalletAdapterProtocolErrorCode;
exports.SolanaSignInWithSolana = SolanaSignInWithSolana;
exports.SolanaSignTransactions = SolanaSignTransactions;
exports.startRemoteScenario = startRemoteScenario;
exports.transact = transact;

},{"@solana/wallet-standard-util":18}],15:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOLANA_CHAINS = exports.SOLANA_LOCALNET_CHAIN = exports.SOLANA_TESTNET_CHAIN = exports.SOLANA_DEVNET_CHAIN = exports.SOLANA_MAINNET_CHAIN = void 0;
exports.isSolanaChain = isSolanaChain;
/** Solana Mainnet (beta) cluster, e.g. https://api.mainnet-beta.solana.com */
exports.SOLANA_MAINNET_CHAIN = 'solana:mainnet';
/** Solana Devnet cluster, e.g. https://api.devnet.solana.com */
exports.SOLANA_DEVNET_CHAIN = 'solana:devnet';
/** Solana Testnet cluster, e.g. https://api.testnet.solana.com */
exports.SOLANA_TESTNET_CHAIN = 'solana:testnet';
/** Solana Localnet cluster, e.g. http://localhost:8899 */
exports.SOLANA_LOCALNET_CHAIN = 'solana:localnet';
/** Array of all Solana clusters */
exports.SOLANA_CHAINS = [
    exports.SOLANA_MAINNET_CHAIN,
    exports.SOLANA_DEVNET_CHAIN,
    exports.SOLANA_TESTNET_CHAIN,
    exports.SOLANA_LOCALNET_CHAIN,
];
/**
 * Check if a chain corresponds with one of the Solana clusters.
 */
function isSolanaChain(chain) {
    return exports.SOLANA_CHAINS.includes(chain);
}

},{}],16:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommitment = getCommitment;
/**
 * TODO: docs
 */
function getCommitment(commitment) {
    switch (commitment) {
        case 'processed':
        case 'confirmed':
        case 'finalized':
        case undefined:
            return commitment;
        case 'recent':
            return 'processed';
        case 'single':
        case 'singleGossip':
            return 'confirmed';
        case 'max':
        case 'root':
            return 'finalized';
        default:
            return undefined;
    }
}

},{}],17:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCALNET_ENDPOINT = exports.TESTNET_ENDPOINT = exports.DEVNET_ENDPOINT = exports.MAINNET_ENDPOINT = void 0;
exports.getChainForEndpoint = getChainForEndpoint;
exports.getEndpointForChain = getEndpointForChain;
const wallet_standard_chains_1 = require("@solana/wallet-standard-chains");
/** TODO: docs */
exports.MAINNET_ENDPOINT = 'https://api.mainnet-beta.solana.com';
/** TODO: docs */
exports.DEVNET_ENDPOINT = 'https://api.devnet.solana.com';
/** TODO: docs */
exports.TESTNET_ENDPOINT = 'https://api.testnet.solana.com';
/** TODO: docs */
exports.LOCALNET_ENDPOINT = 'http://localhost:8899';
/**
 * TODO: docs
 */
function getChainForEndpoint(endpoint) {
    if (endpoint.includes(exports.MAINNET_ENDPOINT))
        return wallet_standard_chains_1.SOLANA_MAINNET_CHAIN;
    if (/\bdevnet\b/i.test(endpoint))
        return wallet_standard_chains_1.SOLANA_DEVNET_CHAIN;
    if (/\btestnet\b/i.test(endpoint))
        return wallet_standard_chains_1.SOLANA_TESTNET_CHAIN;
    if (/\blocalhost\b/i.test(endpoint) || /\b127\.0\.0\.1\b/.test(endpoint))
        return wallet_standard_chains_1.SOLANA_LOCALNET_CHAIN;
    return wallet_standard_chains_1.SOLANA_MAINNET_CHAIN;
}
/**
 * TODO: docs
 */
function getEndpointForChain(chain, endpoint) {
    if (endpoint)
        return endpoint;
    if (chain === wallet_standard_chains_1.SOLANA_MAINNET_CHAIN)
        return exports.MAINNET_ENDPOINT;
    if (chain === wallet_standard_chains_1.SOLANA_DEVNET_CHAIN)
        return exports.DEVNET_ENDPOINT;
    if (chain === wallet_standard_chains_1.SOLANA_TESTNET_CHAIN)
        return exports.TESTNET_ENDPOINT;
    if (chain === wallet_standard_chains_1.SOLANA_LOCALNET_CHAIN)
        return exports.LOCALNET_ENDPOINT;
    return exports.MAINNET_ENDPOINT;
}

},{"@solana/wallet-standard-chains":15}],18:[function(require,module,exports){
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./commitment.js"), exports);
__exportStar(require("./endpoint.js"), exports);
__exportStar(require("./signIn.js"), exports);
__exportStar(require("./signMessage.js"), exports);

},{"./commitment.js":16,"./endpoint.js":17,"./signIn.js":19,"./signMessage.js":20}],19:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySignIn = verifySignIn;
exports.deriveSignInMessage = deriveSignInMessage;
exports.deriveSignInMessageText = deriveSignInMessageText;
exports.parseSignInMessage = parseSignInMessage;
exports.parseSignInMessageText = parseSignInMessageText;
exports.createSignInMessage = createSignInMessage;
exports.createSignInMessageText = createSignInMessageText;
const signMessage_js_1 = require("./signMessage.js");
const util_js_1 = require("./util.js");
/**
 * TODO: docs
 */
function verifySignIn(input, output) {
    const { signedMessage, signature, account: { publicKey }, } = output;
    const message = deriveSignInMessage(input, output);
    return (!!message && (0, signMessage_js_1.verifyMessageSignature)({ message, signedMessage, signature, publicKey: publicKey }));
}
/**
 * TODO: docs
 */
function deriveSignInMessage(input, output) {
    const text = deriveSignInMessageText(input, output);
    if (!text)
        return null;
    return new TextEncoder().encode(text);
}
/**
 * TODO: docs
 */
function deriveSignInMessageText(input, output) {
    const parsed = parseSignInMessage(output.signedMessage);
    if (!parsed)
        return null;
    if (input.domain && input.domain !== parsed.domain)
        return null;
    if (input.address && input.address !== parsed.address)
        return null;
    if (input.statement !== parsed.statement)
        return null;
    if (input.uri !== parsed.uri)
        return null;
    if (input.version !== parsed.version)
        return null;
    if (input.chainId !== parsed.chainId)
        return null;
    if (input.nonce !== parsed.nonce)
        return null;
    if (input.issuedAt !== parsed.issuedAt)
        return null;
    if (input.expirationTime !== parsed.expirationTime)
        return null;
    if (input.notBefore !== parsed.notBefore)
        return null;
    if (input.requestId !== parsed.requestId)
        return null;
    if (input.resources) {
        if (!parsed.resources)
            return null;
        if (!(0, util_js_1.arraysEqual)(input.resources, parsed.resources))
            return null;
    }
    else if (parsed.resources)
        return null;
    return createSignInMessageText(parsed);
}
/**
 * TODO: docs
 */
function parseSignInMessage(message) {
    const text = new TextDecoder().decode(message);
    return parseSignInMessageText(text);
}
// TODO: implement https://github.com/solana-labs/solana/blob/master/docs/src/proposals/off-chain-message-signing.md
const DOMAIN = '(?<domain>[^\\n]+?) wants you to sign in with your Solana account:\\n';
const ADDRESS = '(?<address>[^\\n]+)(?:\\n|$)';
const STATEMENT = '(?:\\n(?<statement>[\\S\\s]*?)(?:\\n|$))??';
const URI = '(?:\\nURI: (?<uri>[^\\n]+))?';
const VERSION = '(?:\\nVersion: (?<version>[^\\n]+))?';
const CHAIN_ID = '(?:\\nChain ID: (?<chainId>[^\\n]+))?';
const NONCE = '(?:\\nNonce: (?<nonce>[^\\n]+))?';
const ISSUED_AT = '(?:\\nIssued At: (?<issuedAt>[^\\n]+))?';
const EXPIRATION_TIME = '(?:\\nExpiration Time: (?<expirationTime>[^\\n]+))?';
const NOT_BEFORE = '(?:\\nNot Before: (?<notBefore>[^\\n]+))?';
const REQUEST_ID = '(?:\\nRequest ID: (?<requestId>[^\\n]+))?';
const RESOURCES = '(?:\\nResources:(?<resources>(?:\\n- [^\\n]+)*))?';
const FIELDS = `${URI}${VERSION}${CHAIN_ID}${NONCE}${ISSUED_AT}${EXPIRATION_TIME}${NOT_BEFORE}${REQUEST_ID}${RESOURCES}`;
const MESSAGE = new RegExp(`^${DOMAIN}${ADDRESS}${STATEMENT}${FIELDS}\\n*$`);
/**
 * TODO: docs
 */
function parseSignInMessageText(text) {
    var _a;
    const match = MESSAGE.exec(text);
    if (!match)
        return null;
    const groups = match.groups;
    if (!groups)
        return null;
    return {
        domain: groups.domain,
        address: groups.address,
        statement: groups.statement,
        uri: groups.uri,
        version: groups.version,
        nonce: groups.nonce,
        chainId: groups.chainId,
        issuedAt: groups.issuedAt,
        expirationTime: groups.expirationTime,
        notBefore: groups.notBefore,
        requestId: groups.requestId,
        resources: (_a = groups.resources) === null || _a === void 0 ? void 0 : _a.split('\n- ').slice(1),
    };
}
/**
 * TODO: docs
 */
function createSignInMessage(input) {
    const text = createSignInMessageText(input);
    return new TextEncoder().encode(text);
}
/**
 * TODO: docs
 */
function createSignInMessageText(input) {
    // ${domain} wants you to sign in with your Solana account:
    // ${address}
    //
    // ${statement}
    //
    // URI: ${uri}
    // Version: ${version}
    // Chain ID: ${chain}
    // Nonce: ${nonce}
    // Issued At: ${issued-at}
    // Expiration Time: ${expiration-time}
    // Not Before: ${not-before}
    // Request ID: ${request-id}
    // Resources:
    // - ${resources[0]}
    // - ${resources[1]}
    // ...
    // - ${resources[n]}
    let message = `${input.domain} wants you to sign in with your Solana account:\n`;
    message += `${input.address}`;
    if (input.statement) {
        message += `\n\n${input.statement}`;
    }
    const fields = [];
    if (input.uri) {
        fields.push(`URI: ${input.uri}`);
    }
    if (input.version) {
        fields.push(`Version: ${input.version}`);
    }
    if (input.chainId) {
        fields.push(`Chain ID: ${input.chainId}`);
    }
    if (input.nonce) {
        fields.push(`Nonce: ${input.nonce}`);
    }
    if (input.issuedAt) {
        fields.push(`Issued At: ${input.issuedAt}`);
    }
    if (input.expirationTime) {
        fields.push(`Expiration Time: ${input.expirationTime}`);
    }
    if (input.notBefore) {
        fields.push(`Not Before: ${input.notBefore}`);
    }
    if (input.requestId) {
        fields.push(`Request ID: ${input.requestId}`);
    }
    if (input.resources) {
        fields.push(`Resources:`);
        for (const resource of input.resources) {
            fields.push(`- ${resource}`);
        }
    }
    if (fields.length) {
        message += `\n\n${fields.join('\n')}`;
    }
    return message;
}

},{"./signMessage.js":20,"./util.js":21}],20:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMessageSignature = verifyMessageSignature;
exports.verifySignMessage = verifySignMessage;
const ed25519_1 = require("@noble/curves/ed25519");
const util_js_1 = require("./util.js");
/**
 * TODO: docs
 */
function verifyMessageSignature({ message, signedMessage, signature, publicKey, }) {
    // TODO: implement https://github.com/solana-labs/solana/blob/master/docs/src/proposals/off-chain-message-signing.md
    return (0, util_js_1.bytesEqual)(message, signedMessage) && ed25519_1.ed25519.verify(signature, signedMessage, publicKey);
}
/**
 * TODO: docs
 */
function verifySignMessage(input, output) {
    const { message, account: { publicKey }, } = input;
    const { signedMessage, signature } = output;
    return verifyMessageSignature({ message, signedMessage, signature, publicKey: publicKey });
}

},{"./util.js":21,"@noble/curves/ed25519":7}],21:[function(require,module,exports){
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.arraysEqual = arraysEqual;
exports.bytesEqual = bytesEqual;
/**
 * @internal
 *
 * Efficiently compare {@link Indexed} arrays (e.g. `Array` and `Uint8Array`).
 *
 * @param a An array.
 * @param b Another array.
 *
 * @return `true` if the arrays have the same length and elements, `false` otherwise.
 *
 * @group Internal
 */
function arraysEqual(a, b) {
    if (a === b)
        return true;
    const length = a.length;
    if (length !== b.length)
        return false;
    for (let i = 0; i < length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}
/**
 * @internal
 *
 * Efficiently compare byte arrays, using {@link arraysEqual}.
 *
 * @param a A byte array.
 * @param b Another byte array.
 *
 * @return `true` if the byte arrays have the same length and bytes, `false` otherwise.
 *
 * @group Internal
 */
function bytesEqual(a, b) {
    return arraysEqual(a, b);
}

},{}]},{},[1]);
