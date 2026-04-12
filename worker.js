/* Orchestrator worker: splits files into 1MB blocks and distributes
 * across parallel block workers for compression/decompression.
 * Falls back to single-threaded for files with 1 block or fewer.
 *
 * Messages in:  { type: "compress"|"decompress", buffer: ArrayBuffer, filename: string }
 * Messages out: { type: "progress", percent: number }
 *               { type: "done", buffer: ArrayBuffer, originalSize, resultSize, timeMs }
 *               { type: "error", message: string } */

var BLOCK_SIZE = 1 << 20; // 1MB, matches ODZ_BLOCK_SIZE in odz.h
var NUM_WORKERS = Math.min(navigator.hardwareConcurrency || 4, 8);

var blockWorkers = null;
var Module = null;

/* ---- Single-threaded path (small files) ---- */

async function ensureModule() {
    if (!Module) {
        importScripts("wasm/odzip.js");
        Module = await createOdzipModule({ locateFile: function (path) { return "wasm/" + path; } });
    }
}

function compressSingle(input) {
    var inputPtr = Module._malloc(input.length);
    Module.HEAPU8.set(input, inputPtr);
    var outLenPtr = Module._malloc(4);
    var outPtr = Module._odz_web_compress(inputPtr, input.length, outLenPtr);
    Module._free(inputPtr);
    if (outPtr === 0) { Module._free(outLenPtr); return null; }
    var outLen = Module.getValue(outLenPtr, "i32");
    Module._free(outLenPtr);
    var result = new Uint8Array(outLen);
    result.set(Module.HEAPU8.subarray(outPtr, outPtr + outLen));
    Module._odz_web_free(outPtr);
    return result;
}

function decompressSingle(input) {
    var inputPtr = Module._malloc(input.length);
    Module.HEAPU8.set(input, inputPtr);
    var outLenPtr = Module._malloc(4);
    var outPtr = Module._odz_web_decompress(inputPtr, input.length, outLenPtr);
    Module._free(inputPtr);
    if (outPtr === 0) { Module._free(outLenPtr); return null; }
    var outLen = Module.getValue(outLenPtr, "i32");
    Module._free(outLenPtr);
    var result = new Uint8Array(outLen);
    result.set(Module.HEAPU8.subarray(outPtr, outPtr + outLen));
    Module._odz_web_free(outPtr);
    return result;
}

/* ---- Parallel path (large files) ---- */

function initBlockWorkers() {
    if (blockWorkers) return;
    blockWorkers = [];
    for (var i = 0; i < NUM_WORKERS; i++) {
        blockWorkers.push(new Worker("block-worker.js"));
    }
}

function runBlockJobs(jobs) {
    /* jobs: [{ type, data, index, rawSize? }]
     * Returns promise resolving to array of ArrayBuffers indexed by job index */
    return new Promise(function (resolve, reject) {
        var results = new Array(jobs.length);
        var completed = 0;
        var nextJob = 0;

        function sendNext(workerIdx) {
            if (nextJob >= jobs.length) return;
            var job = jobs[nextJob++];
            var w = blockWorkers[workerIdx];

            w.onmessage = function (e) {
                if (e.data.type === "block-done") {
                    results[e.data.index] = new Uint8Array(e.data.data);
                    completed++;
                    self.postMessage({ type: "progress", percent: Math.round((completed / jobs.length) * 100) });
                    if (completed === jobs.length) resolve(results);
                    else sendNext(workerIdx);
                } else if (e.data.type === "block-error") {
                    reject(new Error(e.data.message));
                }
            };

            var buf = job.data.buffer ? job.data.buffer.slice(0) : job.data.slice(0);
            var msg = { type: job.type, data: buf, index: job.index };
            if (job.rawSize !== undefined) msg.rawSize = job.rawSize;
            w.postMessage(msg, [buf]);
        }

        for (var i = 0; i < Math.min(NUM_WORKERS, jobs.length); i++) {
            sendNext(i);
        }
    });
}

function writeU32LE(arr, offset, val) {
    arr[offset]     = val & 0xFF;
    arr[offset + 1] = (val >>> 8) & 0xFF;
    arr[offset + 2] = (val >>> 16) & 0xFF;
    arr[offset + 3] = (val >>> 24) & 0xFF;
}

function readU32LE(arr, offset) {
    return (arr[offset] | (arr[offset+1] << 8) | (arr[offset+2] << 16) | (arr[offset+3] << 24)) >>> 0;
}

async function compressParallel(input) {
    initBlockWorkers();

    /* Split into 1MB chunks */
    var jobs = [];
    for (var offset = 0; offset < input.length; offset += BLOCK_SIZE) {
        var end = Math.min(offset + BLOCK_SIZE, input.length);
        jobs.push({
            type: "compress-block",
            data: input.slice(offset, end),
            index: jobs.length,
        });
    }

    var blocks = await runBlockJobs(jobs);

    /* Assemble .odz file: 12-byte header + blocks */
    var totalBlockBytes = 0;
    for (var i = 0; i < blocks.length; i++) totalBlockBytes += blocks[i].length;

    var output = new Uint8Array(12 + totalBlockBytes);
    output[0] = 79; output[1] = 68; output[2] = 90; // "ODZ"
    output[3] = 2; // version
    writeU32LE(output, 4, input.length); // original size low 32 bits
    writeU32LE(output, 8, Math.floor(input.length / 0x100000000)); // high 32 bits

    var pos = 12;
    for (var i = 0; i < blocks.length; i++) {
        output.set(blocks[i], pos);
        /* Fix is_last flag: each block worker sets is_last=1 (single block file).
         * Clear it on all blocks except the actual last one. */
        if (i < blocks.length - 1) {
            output[pos] = output[pos] & 0xFE;
        } else {
            output[pos] = output[pos] | 0x01;
        }
        pos += blocks[i].length;
    }

    return output;
}

/* Parse .odz block boundaries for parallel decompression */
function parseBlockBoundaries(data) {
    var blocks = [];
    var pos = 12; // skip file header
    while (pos < data.length) {
        var flags = data[pos];
        var isLast = flags & 1;
        var blockType = (flags >> 1) & 3;
        var startPos = pos;

        pos++; // flags
        var rawSize = readU32LE(data, pos);
        pos += 4;

        var blockLen;
        if (blockType === 0) { // STORED
            blockLen = 5 + rawSize;
            pos += rawSize;
        } else { // HUFFMAN
            var compSize = readU32LE(data, pos);
            pos += 4;
            blockLen = 9 + compSize;
            pos += compSize;
        }

        blocks.push({ offset: startPos, length: blockLen, rawSize: rawSize });
        if (isLast) break;
    }
    return blocks;
}

async function decompressParallel(input) {
    initBlockWorkers();

    var blockInfo = parseBlockBoundaries(input);
    var jobs = [];
    for (var i = 0; i < blockInfo.length; i++) {
        var b = blockInfo[i];
        jobs.push({
            type: "decompress-block",
            data: input.slice(b.offset, b.offset + b.length),
            index: i,
            rawSize: b.rawSize,
        });
    }

    var blocks = await runBlockJobs(jobs);

    /* Concatenate decompressed blocks */
    var totalLen = 0;
    for (var i = 0; i < blocks.length; i++) totalLen += blocks[i].length;
    var output = new Uint8Array(totalLen);
    var pos = 0;
    for (var i = 0; i < blocks.length; i++) {
        output.set(blocks[i], pos);
        pos += blocks[i].length;
    }

    return output;
}

/* ---- Main handler ---- */

self.onmessage = async function (e) {
    var type = e.data.type;
    var input = new Uint8Array(e.data.buffer);
    var start = performance.now();

    try {
        var result;
        var numBlocks = Math.ceil(input.length / BLOCK_SIZE);

        if (type === "compress") {
            if (numBlocks <= 1) {
                await ensureModule();
                self.postMessage({ type: "progress", percent: 0 });
                result = compressSingle(input);
                if (!result) throw new Error("compress failed");
                self.postMessage({ type: "progress", percent: 100 });
            } else {
                result = await compressParallel(input);
            }
        } else {
            /* For decompression, check block count from the .odz file */
            var blockInfo = parseBlockBoundaries(input);
            if (blockInfo.length <= 1) {
                await ensureModule();
                self.postMessage({ type: "progress", percent: 0 });
                result = decompressSingle(input);
                if (!result) throw new Error("decompress failed");
                self.postMessage({ type: "progress", percent: 100 });
            } else {
                result = await decompressParallel(input);
            }
        }

        var timeMs = performance.now() - start;
        var buf = result.buffer;
        self.postMessage({
            type: "done",
            buffer: buf,
            originalSize: input.length,
            resultSize: result.length,
            timeMs: timeMs,
        }, [buf]);
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
