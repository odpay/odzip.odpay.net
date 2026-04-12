(function () {
    "use strict";

    /* ── DOM refs ──────────────────────────────────────────────── */
    var dropZone = document.getElementById("drop-zone");
    var fileInput = document.getElementById("file-input");
    var processing = document.getElementById("processing");
    var processingLabel = document.getElementById("processing-label");
    var processingFilename = document.getElementById("processing-filename");
    var progressBar = document.getElementById("progress-bar");
    var progressText = document.getElementById("progress-text");
    var done = document.getElementById("done");
    var doneFilename = document.getElementById("done-filename");
    var doneSizes = document.getElementById("done-sizes");
    var doneRatio = document.getElementById("done-ratio");
    var doneTime = document.getElementById("done-time");
    var downloadLink = document.getElementById("download-link");
    var resetBtn = document.getElementById("reset-btn");

    /* ── State ─────────────────────────────────────────────────── */
    var currentFile = null;
    var worker = new Worker("worker.js");

    /* ── Helpers ───────────────────────────────────────────────── */
    function formatBytes(bytes) {
        if (bytes === 0) return "0 B";
        var units = ["B", "KB", "MB", "GB"];
        var i = Math.floor(Math.log(bytes) / Math.log(1024));
        if (i >= units.length) i = units.length - 1;
        var val = bytes / Math.pow(1024, i);
        return (i === 0 ? val : val.toFixed(1)) + " " + units[i];
    }

    function formatTime(ms) {
        if (ms < 1000) return Math.round(ms) + "ms";
        return (ms / 1000).toFixed(1) + "s";
    }

    function outputFilename(name, operation) {
        if (operation === "compress") return name + ".odz";
        /* decompress: strip .odz */
        return name.replace(/\.odz$/i, "");
    }

    function isOdz(name) {
        return name.toLowerCase().endsWith(".odz");
    }

    /* ── State transitions ─────────────────────────────────────── */
    function showIdle() {
        dropZone.hidden = false;
        processing.hidden = true;
        done.hidden = true;
    }

    function showProcessing(filename, operation) {
        dropZone.hidden = true;
        processing.hidden = false;
        done.hidden = true;
        processingLabel.textContent =
            operation === "compress" ? "Compressing\u2026" : "Decompressing\u2026";
        processingFilename.textContent = filename;
        progressBar.style.width = "0%";
        progressText.textContent = "0%";
    }

    function showDone(result) {
        /* Revoke any previous blob URL */
        if (downloadLink.href && downloadLink.href.startsWith("blob:")) {
            URL.revokeObjectURL(downloadLink.href);
        }

        dropZone.hidden = true;
        processing.hidden = true;
        done.hidden = false;

        var op = isOdz(currentFile.name) ? "decompress" : "compress";
        var outName = outputFilename(currentFile.name, op);

        doneFilename.textContent = outName;
        doneSizes.textContent =
            formatBytes(result.originalSize) + " \u2192 " + formatBytes(result.resultSize);

        if (op === "compress" && result.originalSize > 0) {
            var pct = Math.round((1 - result.resultSize / result.originalSize) * 100);
            doneRatio.textContent = pct + "% smaller";
            doneRatio.hidden = false;
        } else {
            doneRatio.hidden = true;
        }

        doneTime.textContent = formatTime(result.timeMs);

        /* Prepare download */
        var blob = new Blob([result.buffer]);
        var url = URL.createObjectURL(blob);
        downloadLink.href = url;
        downloadLink.download = outName;
    }

    function showError(message) {
        /* Reset to idle and show a temporary error class */
        showIdle();
        var el = document.createElement("p");
        el.className = "error-message";
        el.textContent = message;
        dropZone.appendChild(el);
        setTimeout(function () {
            if (el.parentNode) el.parentNode.removeChild(el);
        }, 4000);
    }

    /* ── Worker messages ───────────────────────────────────────── */
    worker.onmessage = function (e) {
        var msg = e.data;
        if (msg.type === "progress") {
            progressBar.style.width = msg.percent + "%";
            progressText.textContent = msg.percent + "%";
        } else if (msg.type === "done") {
            showDone(msg);
        } else if (msg.type === "error") {
            showError(msg.message);
        }
    };

    /* ── File handling ─────────────────────────────────────────── */
    var MAX_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

    function processFile(file) {
        if (file.size > MAX_SIZE) {
            showError("File too large for browser. Use the CLI for files over 2 GB.");
            return;
        }
        currentFile = file;
        var operation = isOdz(file.name) ? "decompress" : "compress";
        showProcessing(file.name, operation);

        file.arrayBuffer().then(function (buffer) {
            worker.postMessage(
                { type: operation, buffer: buffer, filename: file.name },
                [buffer],
            );
        });
    }

    /* ── Drag & drop (works from any state) ──────────────────── */
    document.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (!dropZone.hidden) dropZone.classList.add("drag-over");
    });

    document.addEventListener("dragleave", function (e) {
        if (e.relatedTarget === null) dropZone.classList.remove("drag-over");
    });

    document.addEventListener("drop", function (e) {
        e.preventDefault();
        dropZone.classList.remove("drag-over");
        var file = e.dataTransfer.files[0];
        if (file) processFile(file);
    });

    /* ── Click to browse ───────────────────────────────────────── */
    dropZone.addEventListener("click", function () {
        fileInput.click();
    });

    fileInput.addEventListener("change", function () {
        var file = fileInput.files[0];
        if (file) processFile(file);
        fileInput.value = "";
    });

    /* ── Reset ─────────────────────────────────────────────────── */
    resetBtn.addEventListener("click", function () {
        /* Revoke previous download URL */
        if (downloadLink.href && downloadLink.href.startsWith("blob:")) {
            URL.revokeObjectURL(downloadLink.href);
        }
        showIdle();
    });

    /* Page-level drag listeners moved to the main drag & drop section above */
})();
