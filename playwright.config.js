const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./e2e",
    workers: 1,
    use: { baseURL: "http://127.0.0.1:18080", trace: "retain-on-failure" }
});
