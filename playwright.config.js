const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./e2e",
    workers: 1,
    use: {
        baseURL: "https://assocomptes.localhost:18443",
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        ignoreHTTPSErrors: true
    }
});
