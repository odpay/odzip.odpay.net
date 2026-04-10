import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE = path.join(__dirname, "fixtures", "sample.txt");

test.describe("odzip.odpay.net", () => {
    test("page loads in idle state", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".wordmark")).toHaveText("odzip");
        await expect(page.locator("#drop-zone")).toBeVisible();
        await expect(page.locator("#processing")).toBeHidden();
        await expect(page.locator("#done")).toBeHidden();
    });

    test("compress a file and show stats", async ({ page }) => {
        await page.goto("/");

        /* Upload via the hidden file input (equivalent to drop) */
        await page.locator("#file-input").setInputFiles(FIXTURE);

        /* Processing state should appear */
        await expect(page.locator("#processing")).toBeVisible({ timeout: 10000 });
        await expect(page.locator("#processing-label")).toContainText("Compressing");

        /* Done state should appear */
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        /* Verify stats are populated */
        const sizes = await page.locator("#done-sizes").textContent();
        expect(sizes).toContain("\u2192");

        const ratio = await page.locator("#done-ratio").textContent();
        expect(ratio).toMatch(/\d+% smaller/);

        const time = await page.locator("#done-time").textContent();
        expect(time).toMatch(/\d+/);

        /* Verify download link has the right filename */
        const downloadName = await page.locator("#download-link").getAttribute("download");
        expect(downloadName).toBe("sample.txt.odz");

        /* Verify download link points to a blob URL */
        const href = await page.locator("#download-link").getAttribute("href");
        expect(href).toMatch(/^blob:/);
    });

    test("decompress a .odz file", async ({ page }) => {
        await page.goto("/");

        /* First compress to get a .odz file */
        await page.locator("#file-input").setInputFiles(FIXTURE);
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        /* Download the compressed result via JS in the page */
        const odzBase64 = await page.evaluate(async () => {
            const link = document.getElementById("download-link");
            const resp = await fetch(link.href);
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        });

        /* Reset to idle */
        await page.locator("#reset-btn").click();
        await expect(page.locator("#drop-zone")).toBeVisible();

        /* Write the .odz to a temp file and upload it */
        const tmpOdz = path.join(__dirname, "fixtures", "sample.txt.odz");
        fs.writeFileSync(tmpOdz, Buffer.from(odzBase64, "base64"));

        await page.locator("#file-input").setInputFiles(tmpOdz);
        await expect(page.locator("#processing-label")).toContainText("Decompressing");
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        /* Output filename should be sample.txt (stripped .odz) */
        const downloadName = await page.locator("#download-link").getAttribute("download");
        expect(downloadName).toBe("sample.txt");

        /* Clean up temp file */
        fs.unlinkSync(tmpOdz);
    });

    test("roundtrip preserves content", async ({ page }) => {
        await page.goto("/");
        const original = fs.readFileSync(FIXTURE);

        /* Compress */
        await page.locator("#file-input").setInputFiles(FIXTURE);
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        /* Get compressed bytes */
        const odzBase64 = await page.evaluate(async () => {
            const resp = await fetch(document.getElementById("download-link").href);
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        });

        /* Reset and decompress */
        await page.locator("#reset-btn").click();
        await expect(page.locator("#drop-zone")).toBeVisible();

        const tmpOdz = path.join(__dirname, "fixtures", "_roundtrip.odz");
        fs.writeFileSync(tmpOdz, Buffer.from(odzBase64, "base64"));
        await page.locator("#file-input").setInputFiles(tmpOdz);
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        /* Get decompressed bytes and compare */
        const resultBase64 = await page.evaluate(async () => {
            const resp = await fetch(document.getElementById("download-link").href);
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
            return btoa(binary);
        });

        const result = Buffer.from(resultBase64, "base64");
        expect(result.equals(original)).toBe(true);

        fs.unlinkSync(tmpOdz);
    });

    test("reset button returns to idle", async ({ page }) => {
        await page.goto("/");

        await page.locator("#file-input").setInputFiles(FIXTURE);
        await expect(page.locator("#done")).toBeVisible({ timeout: 30000 });

        await page.locator("#reset-btn").click();
        await expect(page.locator("#drop-zone")).toBeVisible();
        await expect(page.locator("#done")).toBeHidden();
    });
});
