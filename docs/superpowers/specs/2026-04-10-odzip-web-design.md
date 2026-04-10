# odzip.odpay.net — Design Spec

A single-page web utility for compressing and decompressing `.odz` files in the browser using the real odzip library compiled to WASM.

## Goals

- Compress any file to `.odz` format
- Decompress `.odz` files back to their original
- Handle large files (hundreds of MB) via Web Workers
- Show stats: original size, result size, compression ratio, time taken
- Dark, minimal, not-AI aesthetic — calm and focused

## Architecture

```
odzip.odpay.net/
├── index.html          # Single page UI
├── style.css           # Dark theme
├── app.js              # UI logic, drag/drop, state machine
├── worker.js           # Web Worker — loads WASM, runs operations
├── wasm/
│   ├── odzip_web.c     # Thin C wrapper (buffer-based API over FILE*)
│   ├── odzip.js        # Emscripten glue (generated)
│   └── odzip.wasm      # Compiled library (generated)
└── build-wasm.sh       # Emscripten build script
```

### WASM Build

A thin C wrapper (`odzip_web.c`) bridges the library's FILE*-based API to memory buffers usable from JS:

```c
// Takes input buffer, returns output buffer, sets output length
uint8_t* odz_web_compress(const uint8_t* input, uint32_t input_len, uint32_t* output_len);
uint8_t* odz_web_decompress(const uint8_t* input, uint32_t input_len, uint32_t* output_len);
void odz_web_free(uint8_t* ptr);
```

Emscripten compiles all C sources from `/Users/josh/odzip/` plus this wrapper, exporting the three functions above. Uses `-O2` optimization, `ALLOW_MEMORY_GROWTH=1` for large files, and `MODULARIZE=1` for clean Worker loading.

Threading: The C library supports multi-threaded compression via pthreads, but Emscripten pthreads require `SharedArrayBuffer` and specific CORS headers (`Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`). Since this is a simple static site and those headers add deployment complexity, we compile single-threaded (`threads=0/1` in options). The Web Worker already keeps the UI responsive.

### Web Worker

`worker.js` loads the Emscripten module and exposes two operations:

- Receives: `{ type: "compress"|"decompress", buffer: ArrayBuffer, filename: string }`
- Sends back: `{ type: "progress", percent: number }` during processing
- Sends back: `{ type: "done", buffer: ArrayBuffer, originalSize: number, resultSize: number, timeMs: number }` on completion
- Sends back: `{ type: "error", message: string }` on failure

Progress: The C library's `odz_progress_fn` callback is wired through Emscripten to post progress messages back to the main thread.

File transfer uses `Transferable` (zero-copy) for the ArrayBuffer in both directions.

### Memory Considerations

Files are held entirely in memory (input + output + WASM overhead). Practical browser limit is roughly 1-2 GB depending on the device. No explicit size cap in the UI — if the browser runs out of memory, the Worker catches the error and reports it.

## UI Design

### Visual Style

- **Background:** `#1a1a2e` (deep navy-charcoal)
- **Text:** `#c8c8d0` primary, `#666` secondary
- **Borders:** `#2a2a3e`
- **Accents:** `#7a7aad` (muted lavender) for interactive elements and progress bar
- **Font:** System font stack (`-apple-system, system-ui, sans-serif`)
- **Border radius:** Small (4-8px), nothing overly rounded
- **No gradients, no shadows, no glassmorphism**

### Layout

Vertically centered single column, max-width ~480px. Three elements only:

1. **Wordmark** — "odzip" in small uppercase text, top center
2. **Drop zone** — Central interaction area (changes based on state)
3. **Footer** — Single line: link to GitHub repo

### State Machine

**Idle:**
- Dashed border drop zone
- Text: "Drop a file to compress or decompress"
- Click anywhere in zone to open file picker
- Drag-over: border brightens

**Processing:**
- Drop zone replaced by progress bar
- Filename displayed
- "Compressing..." or "Decompressing..." label
- Percentage text

**Done:**
- Stats displayed:
  - `original.txt` — filename
  - `48.2 KB → 12.1 KB` — sizes
  - `75% smaller` — ratio
  - `0.3s` — time
- Download button (styled as text link, not a garish button)
- "Drop another file" to reset

### File Detection

- Extension `.odz` → decompress
- Anything else → compress
- Output filename: `foo.txt` → `foo.txt.odz` (compress), `foo.txt.odz` → `foo.txt` (decompress)

### Responsive

The layout is a centered column — works on any screen width. Drop zone is the full width of the container on mobile. No special mobile considerations beyond that.

## Tech Stack

- **HTML/CSS/JS** — no framework, no bundler, no build step for the frontend
- **Emscripten** — compiles C to WASM (one-time build, output checked in or built in CI)
- **Web Worker** — offloads WASM processing from UI thread
- **Static hosting** — deploy anywhere (Netlify, Vercel, GitHub Pages, etc.)

## Out of Scope

- Multiple file / batch processing
- Archive support (directories)
- User accounts or server-side processing
- Service worker / offline support
- Dark/light theme toggle (dark only)
