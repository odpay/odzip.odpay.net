#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <emscripten.h>
#include "libodzip.h"

/* Post progress to the main thread via the Worker's postMessage. */
EM_JS(void, report_progress, (int percent), {
    postMessage({type: "progress", percent: percent});
});

static int progress_cb(uint64_t processed, uint64_t total, void *userdata) {
    (void)userdata;
    if (total > 0) {
        int pct = (int)((processed * 100) / total);
        report_progress(pct);
    }
    return 0;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* odz_web_compress(const uint8_t *input, uint32_t input_len,
                          uint32_t *output_len) {
    *output_len = 0;

    FILE *f = fopen("/tmp/in", "wb");
    if (!f) return NULL;
    if (fwrite(input, 1, input_len, f) != input_len) { fclose(f); return NULL; }
    fclose(f);

    FILE *fin = fopen("/tmp/in", "rb");
    FILE *fout = fopen("/tmp/out", "wb");
    if (!fin || !fout) {
        if (fin) fclose(fin);
        if (fout) fclose(fout);
        return NULL;
    }

    odz_options_t opts = { .progress = progress_cb, .userdata = NULL, .threads = 1 };
    int rc = odz_compress(fin, fout, &opts);
    fclose(fin);
    fclose(fout);
    remove("/tmp/in");

    if (rc != ODZ_OK) { remove("/tmp/out"); return NULL; }

    FILE *res = fopen("/tmp/out", "rb");
    if (!res) return NULL;
    fseek(res, 0, SEEK_END);
    long size = ftell(res);
    fseek(res, 0, SEEK_SET);

    uint8_t *buf = (uint8_t *)malloc((size_t)size);
    if (!buf) { fclose(res); remove("/tmp/out"); return NULL; }
    fread(buf, 1, (size_t)size, res);
    fclose(res);
    remove("/tmp/out");

    *output_len = (uint32_t)size;
    return buf;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* odz_web_decompress(const uint8_t *input, uint32_t input_len,
                            uint32_t *output_len) {
    *output_len = 0;

    FILE *f = fopen("/tmp/in", "wb");
    if (!f) return NULL;
    if (fwrite(input, 1, input_len, f) != input_len) { fclose(f); return NULL; }
    fclose(f);

    FILE *fin = fopen("/tmp/in", "rb");
    FILE *fout = fopen("/tmp/out", "wb");
    if (!fin || !fout) {
        if (fin) fclose(fin);
        if (fout) fclose(fout);
        return NULL;
    }

    odz_options_t opts = { .progress = progress_cb, .userdata = NULL, .threads = 1 };
    int rc = odz_decompress(fin, fout, &opts);
    fclose(fin);
    fclose(fout);
    remove("/tmp/in");

    if (rc != ODZ_OK) { remove("/tmp/out"); return NULL; }

    FILE *res = fopen("/tmp/out", "rb");
    if (!res) return NULL;
    fseek(res, 0, SEEK_END);
    long size = ftell(res);
    fseek(res, 0, SEEK_SET);

    uint8_t *buf = (uint8_t *)malloc((size_t)size);
    if (!buf) { fclose(res); remove("/tmp/out"); return NULL; }
    fread(buf, 1, (size_t)size, res);
    fclose(res);
    remove("/tmp/out");

    *output_len = (uint32_t)size;
    return buf;
}

EMSCRIPTEN_KEEPALIVE
const char* odz_web_strerror(int err) {
    return odz_strerror(err);
}

EMSCRIPTEN_KEEPALIVE
void odz_web_free(uint8_t *ptr) {
    free(ptr);
}
