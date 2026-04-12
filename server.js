import { createServer } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = process.argv[2] || 3000;

const MIME = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".txt": "text/plain",
};

createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    const filePath = join(root, url === "/" ? "index.html" : url);

    try {
        const data = await readFile(filePath);
        res.writeHead(200, {
            "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
        });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end("Not found");
    }
}).listen(port, () => console.log(`http://localhost:${port}`));
