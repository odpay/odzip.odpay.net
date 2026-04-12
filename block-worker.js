/* Block worker: compresses or decompresses a single block using its own WASM instance.
 * Multiple instances of this worker run in parallel, one per CPU core.
 *
 * Compress:   receives raw bytes, returns .odz block data (header + compressed)
 * Decompress: receives .odz block data + rawSize, returns decompressed bytes */

let Module = null;

async function ensureModule() {
    if (!Module) {
        importScripts("wasm/odzip.js");
        Module = await createOdzipModule({ locateFile: (path) => "wasm/" + path });
    }
}

function wasmCompress(input) {
    var inputPtr = Module._malloc(input.length);
    Module.HEAPU8.set(input, inputPtr);
    var outLenPtr = Module._malloc(4);

    var outPtr = Module._odz_web_compress(inputPtr, input.length, outLenPtr);
    Module._free(inputPtr);

    if (outPtr === 0) {
        Module._free(outLenPtr);
        return null;
    }

    var outLen = Module.getValue(outLenPtr, "i32");
    Module._free(outLenPtr);

    /* odz_web_compress returns a full .odz file: 12-byte header + 1 block.
     * Strip the header, return just the block bytes. */
    var block = new Uint8Array(outLen - 12);
    block.set(Module.HEAPU8.subarray(outPtr + 12, outPtr + outLen));
    Module._odz_web_free(outPtr);
    return block;
}

function wasmDecompress(blockData, rawSize) {
    /* Build a fake .odz file: 12-byte header + block data with is_last set */
    var fake = new Uint8Array(12 + blockData.length);
    fake[0] = 79; fake[1] = 68; fake[2] = 90; // "ODZ"
    fake[3] = 2; // version
    fake[4] = rawSize & 0xFF;
    fake[5] = (rawSize >>> 8) & 0xFF;
    fake[6] = (rawSize >>> 16) & 0xFF;
    fake[7] = (rawSize >>> 24) & 0xFF;
    /* bytes 8-11 stay 0 (files < 4GB) */
    fake.set(blockData, 12);
    fake[12] = fake[12] | 0x01; // ensure is_last is set

    var inputPtr = Module._malloc(fake.length);
    Module.HEAPU8.set(fake, inputPtr);
    var outLenPtr = Module._malloc(4);

    var outPtr = Module._odz_web_decompress(inputPtr, fake.length, outLenPtr);
    Module._free(inputPtr);

    if (outPtr === 0) {
        Module._free(outLenPtr);
        return null;
    }

    var outLen = Module.getValue(outLenPtr, "i32");
    Module._free(outLenPtr);

    var result = new Uint8Array(outLen);
    result.set(Module.HEAPU8.subarray(outPtr, outPtr + outLen));
    Module._odz_web_free(outPtr);
    return result;
}

self.onmessage = async function (e) {
    var msg = e.data;
    try {
        await ensureModule();

        if (msg.type === "compress-block") {
            var block = wasmCompress(new Uint8Array(msg.data));
            if (!block) {
                self.postMessage({ type: "block-error", index: msg.index, message: "compress failed" });
                return;
            }
            self.postMessage(
                { type: "block-done", data: block.buffer, index: msg.index },
                [block.buffer]
            );
        } else if (msg.type === "decompress-block") {
            var result = wasmDecompress(new Uint8Array(msg.data), msg.rawSize);
            if (!result) {
                self.postMessage({ type: "block-error", index: msg.index, message: "decompress failed" });
                return;
            }
            self.postMessage(
                { type: "block-done", data: result.buffer, index: msg.index },
                [result.buffer]
            );
        }
    } catch (err) {
        self.postMessage({ type: "block-error", index: msg.index, message: err.message || String(err) });
    }
};
