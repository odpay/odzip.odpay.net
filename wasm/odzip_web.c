#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <emscripten.h>
#include "libodzip.h"
#include "odz.h"

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
    if (fread(buf, 1, (size_t)size, res) != (size_t)size) {
        free(buf); fclose(res); remove("/tmp/out"); return NULL;
    }
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
    if (fread(buf, 1, (size_t)size, res) != (size_t)size) {
        free(buf); fclose(res); remove("/tmp/out"); return NULL;
    }
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

/* ---- Helpers for JS-level parallel block processing ----
 * All format knowledge lives here so JS never parses .odz directly.
 * If the format changes, this recompiles with the updated headers. */

EMSCRIPTEN_KEEPALIVE
uint32_t odz_web_block_size(void) {
    return ODZ_BLOCK_SIZE;
}

EMSCRIPTEN_KEEPALIVE
uint32_t odz_web_header_size(void) {
    return 12; /* "ODZ"(3) + version(1) + original_size(8) */
}

/* Write a file header into buf (must be >= 12 bytes) */
EMSCRIPTEN_KEEPALIVE
void odz_web_write_header(uint8_t *buf, uint32_t size_lo, uint32_t size_hi) {
    buf[0] = 'O'; buf[1] = 'D'; buf[2] = 'Z';
    buf[3] = ODZ_VERSION;
    wr_u32le(buf + 4, size_lo);
    wr_u32le(buf + 8, size_hi);
}

/* Read original size from a file header (low 32 bits, enough for < 4GB) */
EMSCRIPTEN_KEEPALIVE
uint32_t odz_web_read_header_size(const uint8_t *buf) {
    return rd_u32le(buf + 4);
}

/* Given a complete .odz output (header + 1 block), strip the 12-byte header
 * and return a copy of just the block data. Caller frees with odz_web_free. */
EMSCRIPTEN_KEEPALIVE
uint8_t* odz_web_strip_header(const uint8_t *data, uint32_t len, uint32_t *out_len) {
    if (len <= 12) { *out_len = 0; return NULL; }
    uint32_t block_len = len - 12;
    uint8_t *buf = (uint8_t *)malloc(block_len);
    if (!buf) { *out_len = 0; return NULL; }
    memcpy(buf, data + 12, block_len);
    *out_len = block_len;
    return buf;
}

/* Set or clear the is_last flag (bit 0) on a block's flags byte */
EMSCRIPTEN_KEEPALIVE
void odz_web_set_last(uint8_t *block, int is_last) {
    if (is_last) block[0] |= 0x01;
    else         block[0] &= 0xFE;
}

/* Build a fake single-block .odz file for decompressing one block.
 * block_data includes the block header (flags + sizes + data).
 * raw_size is the expected decompressed size for this block.
 * Returns a malloc'd buffer. Caller frees with odz_web_free. */
EMSCRIPTEN_KEEPALIVE
uint8_t* odz_web_wrap_block(const uint8_t *block_data, uint32_t block_len,
                            uint32_t raw_size, uint32_t *out_len) {
    uint32_t total = 12 + block_len;
    uint8_t *buf = (uint8_t *)malloc(total);
    if (!buf) { *out_len = 0; return NULL; }

    buf[0] = 'O'; buf[1] = 'D'; buf[2] = 'Z';
    buf[3] = ODZ_VERSION;
    wr_u32le(buf + 4, raw_size);
    wr_u32le(buf + 8, 0);
    memcpy(buf + 12, block_data, block_len);
    buf[12] |= 0x01; /* ensure is_last */

    *out_len = total;
    return buf;
}

/* Parse block boundaries from a complete .odz file.
 * Returns a packed array of uint32 triples: [offset, length, rawSize, ...].
 * *num_blocks is set to the number of blocks found.
 * Caller frees with odz_web_free. */
EMSCRIPTEN_KEEPALIVE
uint32_t* odz_web_parse_blocks(const uint8_t *data, uint32_t len,
                               uint32_t *num_blocks) {
    *num_blocks = 0;

    /* Count blocks first */
    uint32_t count = 0;
    uint32_t pos = 12;
    while (pos < len) {
        uint8_t flags = data[pos];
        int block_type = (flags >> 1) & 3;
        pos++; /* flags */
        uint32_t raw_size = rd_u32le(data + pos);
        pos += 4;

        if (block_type == ODZ_BLOCK_STORED) {
            pos += raw_size;
        } else if (block_type == ODZ_BLOCK_HUFFMAN) {
            uint32_t comp_size = rd_u32le(data + pos);
            pos += 4;
            pos += comp_size;
        } else {
            return NULL; /* unknown block type */
        }
        count++;
        if (flags & 1) break; /* is_last */
    }

    /* Allocate output: 3 uint32s per block */
    uint32_t *out = (uint32_t *)malloc(count * 3 * sizeof(uint32_t));
    if (!out) return NULL;

    /* Second pass: fill in offsets */
    pos = 12;
    uint32_t idx = 0;
    while (pos < len && idx < count) {
        uint32_t block_start = pos;
        uint8_t flags = data[pos];
        int block_type = (flags >> 1) & 3;
        pos++;
        uint32_t raw_size = rd_u32le(data + pos);
        pos += 4;

        uint32_t block_len;
        if (block_type == ODZ_BLOCK_STORED) {
            block_len = 5 + raw_size;
            pos += raw_size;
        } else {
            uint32_t comp_size = rd_u32le(data + pos);
            pos += 4;
            block_len = 9 + comp_size;
            pos += comp_size;
        }

        out[idx * 3]     = block_start;
        out[idx * 3 + 1] = block_len;
        out[idx * 3 + 2] = raw_size;
        idx++;
        if (flags & 1) break;
    }

    *num_blocks = count;
    return out;
}
