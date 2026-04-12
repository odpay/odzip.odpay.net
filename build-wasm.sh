#!/bin/bash
set -e

ODZIP_SRC="${ODZIP_SRC:-../odzip}"

if [ ! -f "$ODZIP_SRC/libodzip.h" ]; then
    echo "Error: odzip source not found at $ODZIP_SRC"
    echo "Set ODZIP_SRC to the odzip repo path"
    exit 1
fi

echo "Building odzip WASM from $ODZIP_SRC..."

emcc -O3 -std=c17 -D_POSIX_C_SOURCE=200809L \
    -sWASM=1 \
    -sMODULARIZE=1 \
    -sEXPORT_NAME="createOdzipModule" \
    -sALLOW_MEMORY_GROWTH=1 \
    -sEXPORTED_FUNCTIONS="[ \
        '_odz_web_compress', \
        '_odz_web_decompress', \
        '_odz_web_strerror', \
        '_odz_web_free', \
        '_odz_web_block_size', \
        '_odz_web_header_size', \
        '_odz_web_write_header', \
        '_odz_web_read_header_size', \
        '_odz_web_strip_header', \
        '_odz_web_set_last', \
        '_odz_web_wrap_block', \
        '_odz_web_parse_blocks', \
        '_malloc', \
        '_free' \
    ]" \
    -sEXPORTED_RUNTIME_METHODS="['getValue','HEAPU8','HEAPU32','UTF8ToString']" \
    -I"$ODZIP_SRC" \
    "$ODZIP_SRC/odz_util.c" \
    "$ODZIP_SRC/bitstream.c" \
    "$ODZIP_SRC/huffman.c" \
    "$ODZIP_SRC/lz_hashchain.c" \
    "$ODZIP_SRC/compress.c" \
    "$ODZIP_SRC/decompress.c" \
    wasm/odzip_web.c \
    -o wasm/odzip.js

echo "Build complete: wasm/odzip.js + wasm/odzip.wasm"
ls -lh wasm/odzip.js wasm/odzip.wasm
