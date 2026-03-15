/**
 * Accompanying JavaScript library for Solady.
 *
 * To install:
 * 
 * ```
 * npm install solady
 * ```
 *
 * Module exports:
 * 
 * - `LibZip`
 *   - `flzCompress(data)`: Compresses hex encoded data with FastLZ.
 *   - `flzDecompress(data)`: Decompresses hex encoded data with FastLZ.
 *   - `cdCompress(data)`: Compresses hex encoded calldata.
 *   - `cdDecompress(data)`: Decompresses hex encoded calldata.
 *   
 * - `ERC1967Factory`
 *   - `address`: Canonical address of Solady's ERC1967Factory.
 *   - `abi`: ABI of Solady's ERC1967Factory.
 *
 * @module solady
 */
(function(global, factory) {

    "use strict";

    if (typeof module === "object" && typeof module.exports === "object") {
        module.exports = factory(global, 1);
        if (typeof exports === "object") {
            exports.LibZip = module.exports.LibZip;
            exports.ERC1967Factory = module.exports.ERC1967Factory;
        }
    } else {
        factory(global);
    }

})(globalThis.window === undefined ? this : globalThis, function(window, noGlobal) {

    "use strict";

    const solady = {};

    /*============================================================*/
    /*                     LibZip Operations                      */
    /*============================================================*/

    // See: https://github.com/vectorized/solady/blob/main/src/utils/LibZip.sol

    /**
     * FastLZ and calldata compression / decompression functions.
     * @namespace
     * @alias module:solady.LibZip
     */
    const LibraryZip = {};

    solady.LibZip = LibraryZip;

    function hexString(data) {
        if ((typeof data === "string" || data instanceof String) && (data = data.match(/^[\s\uFEFF\u00A0]*(0[Xx])?([0-9A-Fa-f]*)[\s\uFEFF\u00A0]*$/))) {
                if (data[2].length % 2) {
                    throw new Error("Hex string length must be a multiple of 2.");
                }
                return data[2];
            }
        throw new Error("Data must be a hex string.");
    }

    function byteToString(b) {
        return (b | 0x1_00).toString(16).slice(1);
    }

    function parseByte(data, index) {
        return Number.parseInt(data.substr(index, 2), 16);
    }

    function hexToBytes(data) {
        let a = [], index = 0;
        for (; index < data.length; index += 2) a.push(parseByte(data, index));
        return a;
    }

    function bytesToHex(a) {
        let o = "0x", index = 0;
        for (; index < a.length; o += byteToString(a[index++])) ;
        return o;
    }

    /**
     * Compresses hex encoded data with the FastLZ LZ77 algorithm.
     * @param {string} data A hex encoded string representing the original data.
     * @returns {string} The compressed result as a hex encoded string.
     */
    LibraryZip.flzCompress = function(data) {
        const ib = hexToBytes(hexString(data)), b = ib.length - 4;
        let ht = [], ob = [], a = 0, index = 2, o = 0, index_, s, h, d, c, l, r, p, q, e;

        function u24(index__) {
            return ib[index__] | (ib[++index__] << 8) | (ib[++index__] << 16);
        }

        function hash(x) {
            return ((2_654_435_769 * x) >> 19) & 8191;
        }

        function literals(r, s) {
            while (r >= 32) for (ob[o++] = 31, index_ = 32; index_--; r--) ob[o++] = ib[s++];
            if (r) for (ob[o++] = r - 1; r--; ) ob[o++] = ib[s++];
        }

        while (index < b - 9) {
            do {
                r = ht[h = hash(s = u24(index))] || 0;
                c = (d = (ht[h] = index) - r) < 8192 ? u24(r) : 0x1_00_00_00;
            } while (index < b - 9 && index++ && s != c);
            if (index >= b - 9) break;
            if (--index > a) literals(index - a, a);
            for (l = 0, p = r + 3, q = index + 3, e = b - q; l < e; l++) e *= ib[p + l] === ib[q + l];
            index += l;
            for (--d; l > 262; l -= 262) ob[o++] = 224 + (d >> 8), ob[o++] = 253, ob[o++] = d & 255;
            if (l < 7) ob[o++] = (l << 5) + (d >> 8), ob[o++] = d & 255;
            else ob[o++] = 224 + (d >> 8), ob[o++] = l - 7, ob[o++] = d & 255;
            ht[hash(u24(index))] = index++, ht[hash(u24(index))] = index++, a = index;
        }
        literals(b + 4 - a, a);
        return bytesToHex(ob);
    }

    /**
     * Decompresses hex encoded data with the FastLZ LZ77 algorithm.
     * @param {string} data A hex encoded string representing the compressed data.
     * @returns {string} The decompressed result as a hex encoded string.
     */
    LibraryZip.flzDecompress = function(data) {
        let ib = hexToBytes(hexString(data)), index = 0, o = 0, l, f, t, r, h, ob = [];
        while (index < ib.length) {
            if (t = ib[index] >> 5) {
                f = 256 * (ib[index] & 31) + ib[index + 2 - (t = t < 7)];
                l = t ? 2 + (ib[index] >> 5) : 9 + ib[index + 1];
                index = index + 3 - t;
                r = o - f - 1;
                while (l--) ob[o++] = ob[r++];
            } else {
                for (l = 1 + ib[index++]; l--;) ob[o++] = ib[index++];
            }
        }
        return bytesToHex(ob);
    }

    /**
     * Compresses hex encoded calldata.
     * @param {string} data A hex encoded string representing the original data.
     * @returns {string} The compressed result as a hex encoded string.
     */
    LibraryZip.cdCompress = function(data) {
        data = hexString(data);
        let o = "0x", z = 0, y = 0, index = 0, c;

        function pushByte(b) {
            o += byteToString(((o.length < 4 * 2 + 2) * 0xFF) ^ b);
        }

        function rle(v, d) {
            pushByte(0x00);
            pushByte(d - 1 + v * 0x80);
        }

        for (; index < data.length; index += 2) {
            c = parseByte(data, index);
            if (!c) {
                if (y) rle(1, y), y = 0;
                if (++z === 0x80) rle(0, 0x80), z = 0;
                continue;
            }
            if (c === 0xFF) {
                if (z) rle(0, z), z = 0;
                if (++y === 0x20) rle(1, 0x20), y = 0;
                continue;
            }
            if (y) rle(1, y), y = 0;
            if (z) rle(0, z), z = 0;
            pushByte(c);
        }
        if (y) rle(1, y), y = 0;
        if (z) rle(0, z), z = 0;
        return o;
    }

    /**
     * Decompresses hex encoded calldata.
     * @param {string} data A hex encoded string representing the compressed data.
     * @returns {string} The decompressed result as a hex encoded string.
     */
    LibraryZip.cdDecompress = function(data) {
        data = hexString(data);
        let o = "0x", index = 0, index_, c, s;

        while (index < data.length) {
            c = ((index < 4 * 2) * 0xFF) ^ parseByte(data, index);
            index += 2;
            if (!c) {
                c = ((index < 4 * 2) * 0xFF) ^ parseByte(data, index);
                s = (c & 0x7F) + 1;
                index += 2;
                for (index_ = 0; index_ < s; ++index_) o += byteToString((c >> 7 && index_ < 32) * 0xFF);
                continue;
            }
            o += byteToString(c);
        }
        return o;
    }

    /*============================================================*/
    /*                       ERC1967Factory                       */
    /*============================================================*/

    // See: https://github.com/vectorized/solady/blob/main/src/utils/ERC1967Factory.sol

    /**
     * ERC1967Factory canonical address and ABI.
     * @namespace
     * @alias module:solady.ERC1967Factory
     */
    const ERC1967Factory = {};

    solady.ERC1967Factory = ERC1967Factory;

    /**
     * Canonical address of Solady's ERC1967Factory.
     * @type {string}
     */
    ERC1967Factory.address = "0x0000000000006396FF2a80c067f99B3d2Ab4Df24";

    /**
     * ABI of Solady's ERC1967Factory.
     * @type {Object}
     */
    ERC1967Factory.abi = JSON.parse('[{0:[],1:"DeploymentFailed"96"SaltDoesNotStartWithCaller"96"Unauthorized"96"UpgradeFailed",2:3959790,9791],1:"AdminChanged",2:10959790,9792,9791],1:"Deployed",2:10959790,9792],1:"Upgraded",2:10},{0:[{90],1:"adminOf",12:[{9199{0:[{90,{91],1:"changeAdmin",12:[],13:"nonpayable",2:15},{0:[{92,{91],1:"deploy",12:[{9098,{0:[{92,{91,{94],1:"deployAndCall",12:[{9098,{0:[{92,{91,{93],1:"deployDeterministic",12:[{9098,{0:[{92,{91,{93,{94],1:"deployDeterministicAndCall",12:[{9098,{0:[],1:"initCodeHash",12:[{6:19,1:"result",2:19}99{0:[{93],1:"predictDeterministicAddress",12:[{6:7,1:"predicted",2:7}99{0:[{90,{92],1:"upgrade",12:[98,{0:[{90,{92,{94],1:"upgradeAndCall",12:[98]'.replaceAll(/9\d/g, function (m) { return ["6:7,1:8,2:7}","6:7,1:9,2:7}","6:7,1:11,2:7}","6:19,1:20,2:19}","6:17,1:18,2:17}","},{4:false,0:[",",2:3},{0:[],1:","{5:true,","],13:16,2:15}","],13:14,2:15},"][m-90] }).replaceAll(/\d+/g, function (m) { return `"${  "inputs,name,type,error,anonymous,indexed,internalType,address,proxy,admin,event,implementation,outputs,stateMutability,view,function,payable,bytes,data,bytes32,salt".split(",")[m]  }"` }));

    /*--------------------------- END ----------------------------*/

    if (typeof define === "function" && define.amd) {
        define("solady", [], function() {
            return solady
        });
    }

    if (!noGlobal) {
        window.solady = solady;
    }

    return solady;
});
