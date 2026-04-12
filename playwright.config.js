import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    timeout: 60000,
    webServer: {
        command: "node server.js 3000",
        port: 3000,
        reuseExistingServer: true,
    },
    use: {
        baseURL: "http://localhost:3000",
    },
    projects: [
        { name: "chromium", use: { browserName: "chromium" } },
    ],
});
