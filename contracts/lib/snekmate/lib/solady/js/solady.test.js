const solady = require("./solady.js");

function test(message, function_) {
    message = message.replaceAll(/^[\s\uFEFF\u00A0]+|[\s\uFEFF\u00A0]+$/g, "").replace(/([^\.])$/, "$1.");
    try {
        function_();
        console.log("\u001B[32m[PASS]\u001B[0m", message);
    } catch (error) {
        process.exitCode = 1;
        console.error("\u001B[31m[FAIL]\u001B[0m", message);
        console.error(error.stack);
    }
}

function assert(cond, message) {
    if (!cond) throw new Error(message);
}

function assertEq(a, b) {
    assert(a === b, `Assertion failed!\n    Expected: ${  b  }\n    Actual: ${  a}`);
}

function expectRevert(function_) {
    let hasRevert = false;
    try { function_() } catch { hasRevert = true }
    assert(hasRevert, `Revert expected.\n${  function_}`);
}

function randomData() {
    const n = Math.trunc(Math.random() * 2000);
    let s = Math.random() < 0.5 ? "" : "0x";
    const g = Math.random() < 0.5 ? 0.45 : (Math.random() ? 0.99 : 0.999);
    const h = g + 0.5 * (1 - g);
    for (let index = 0; index < n; ++index) {
        const r = Math.random();
        if (r < g) {
            s += "00";
        } else if (r < h) {
            s += "ff";
        } else {
            const b = ((Math.random() * 0x1_00) & 0xFF).toString(16);
            s += b.length === 1 ? `0${  b}` : b;
        }
    }
    return Math.random() < 0.5 ? s.toUpperCase() : s.toLowerCase();
}

function padRandomWhitespace(data) {
    let before = "";
    let after = "";
    while (Math.random() < 0.5) before += Math.random() ? "\t" : " ";
    while (Math.random() < 0.5) after += Math.random() ? "\t" : " ";
    return before + data + after;
}

function testCompressDecompress(compress, decompress) {
    let totalDataLength = 0;
    let totalCompressedLength = 0;
    for (let t = 0; t < 1000; ++t) {
        const data = randomData();
        const compressed = compress(padRandomWhitespace(data));
        const decompressed = decompress(padRandomWhitespace(compressed));
        totalDataLength += data.length;
        totalCompressedLength += compressed.length;
        assertEq(compressed.slice(0, 2), "0x");
        assertEq(decompressed.slice(0, 2), "0x");
        assertEq(decompressed.replace(/^0x/, ""), data.toLowerCase().replace(/^0x/, ""));
    }
    assert(totalCompressedLength < totalDataLength, "Compress not working as intended.");

    assertEq(compress(""), "0x");
    assertEq(compress("0x"), "0x");
    assertEq(decompress(""), "0x");
    assertEq(decompress("0x"), "0x");

    function checkRevertOnInvalidInputs(function_) {
        expectRevert(function () { function_("hehe") });
        expectRevert(function () { function_("0xa") });
        expectRevert(function () { function_("0xas") });
        expectRevert(function () { function_(123) });
        expectRevert(function () { function_(false) });
        expectRevert(function () { function_(null) });
        expectRevert(function () { function_() });
        expectRevert(function () { function_([]) });
        expectRevert(function () { function_({}) });
    }

    checkRevertOnInvalidInputs(compress);
    checkRevertOnInvalidInputs(decompress);
}

test("LibZip: FastLZ compress / decompress.", function() {
    testCompressDecompress(solady.LibZip.flzCompress, solady.LibZip.flzDecompress);
});

test("LibZip: Calldata compress / decompress.", function() {
    testCompressDecompress(solady.LibZip.cdCompress, solady.LibZip.cdDecompress);
});

test("LibZip: Calldata compress", function() {
    const data = "0xac9650d80000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000000a40c49ccbe000000000000000000000000000000000000000000000000000000000005b70e00000000000000000000000000000000000000000000000000000dfc79825feb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000645c48a7000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000084fc6f7865000000000000000000000000000000000000000000000000000000000005b70e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000ffffffffffffffffffffffffffffffff00000000000000000000000000000000ffffffffffffffffffffffffffffffff00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f1cdf1a632eaaab40d1c263edf49faf749010a1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064df2ab5bb0000000000000000000000007f5c764cbc14f9669b88837ca1490cca17c3160700000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f1cdf1a632eaaab40d1c263edf49faf749010a100000000000000000000000000000000000000000000000000000000";
    const expected = "0x5369af27001e20001e04001e80001d0160001d0220001d02a0001ea40c49ccbe001c05b70e00190dfc79825feb005b645c48a7003a84fc6f7865001c05b70e002f008f000f008f003a4449404b7c002b1f1cdf1a632eaaab40d1c263edf49faf749010a1003a64df2ab5bb000b7f5c764cbc14f9669b88837ca1490cca17c31607002b1f1cdf1a632eaaab40d1c263edf49faf749010a1001b";
    assertEq(solady.LibZip.cdCompress(data), expected);
});

test("LibZip: Calldata decompress on invalid input", function() {
    const data = "0xffffffff00ff";
    const expected = "0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    assertEq(solady.LibZip.cdDecompress(data), expected);
});

test("ERC1967Factory: ABI and address", function() {
    function hashFnv32a(s) {
        let h = 0x81_1C_9D_C5;
        for (let index = 0; index < s.length; index++) {
            h ^= s.charCodeAt(index);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return h >>> 0;
    }
    assertEq(hashFnv32a(JSON.stringify(solady.ERC1967Factory.abi)), 1_277_805_820);
    assertEq(solady.ERC1967Factory.address, "0x0000000000006396FF2a80c067f99B3d2Ab4Df24");
});
