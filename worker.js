/* Web Worker: loads odzip WASM module and handles compress/decompress requests.
 *
 * Messages in:  { type: "compress"|"decompress", buffer: ArrayBuffer, filename: string }
 * Messages out: { type: "progress", percent: number }
 *               { type: "done", buffer: ArrayBuffer, originalSize, resultSize, timeMs }
 *               { type: "error", message: string }
 *
 * Progress messages come from the C code's EM_JS bridge (report_progress)
 * which calls postMessage directly — they arrive between the "start" and "done"
 * messages without any JS-side polling. */

let Module = null;

self.onmessage = async function (e) {
    const { type, buffer, filename } = e.data;

    try {
        if (!Module) {
            importScripts("wasm/odzip.js");
            Module = await createOdzipModule({
                locateFile: (path) => "wasm/" + path,
            });
        }

        const input = new Uint8Array(buffer);
        const inputLen = input.length;

        /* Allocate input in WASM heap */
        const inputPtr = Module._malloc(inputLen);
        Module.HEAPU8.set(input, inputPtr);

        /* Allocate space for the output-length out-parameter (uint32_t = 4 bytes) */
        const outLenPtr = Module._malloc(4);

        const start = performance.now();

        const outPtr =
            type === "compress"
                ? Module._odz_web_compress(inputPtr, inputLen, outLenPtr)
                : Module._odz_web_decompress(inputPtr, inputLen, outLenPtr);

        const timeMs = performance.now() - start;

        Module._free(inputPtr);

        if (outPtr === 0) {
            Module._free(outLenPtr);
            self.postMessage({ type: "error", message: type + " failed" });
            return;
        }

        const outLen = Module.getValue(outLenPtr, "i32");
        Module._free(outLenPtr);

        /* Copy result out of WASM heap before freeing */
        const result = new Uint8Array(outLen);
        result.set(Module.HEAPU8.subarray(outPtr, outPtr + outLen));
        Module._odz_web_free(outPtr);

        const resultBuffer = result.buffer;
        self.postMessage(
            {
                type: "done",
                buffer: resultBuffer,
                originalSize: inputLen,
                resultSize: outLen,
                timeMs: timeMs,
            },
            [resultBuffer],
        );
    } catch (err) {
        self.postMessage({ type: "error", message: err.message || String(err) });
    }
};
