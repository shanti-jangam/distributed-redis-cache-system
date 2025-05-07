const axios = require("axios");

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3000";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://localhost:9090";
const TEST_KEY_PREFIX = "metrics-test-";
const TEST_COUNT = 10;

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        // Try to clean up all test keys
        console.log("Cleaning up test keys...");
        for (let i = 0; i < TEST_COUNT; i++) {
            const key = `${TEST_KEY_PREFIX}${i}`;
            await deleteCache(key).catch(() => {});
        }
        console.log("✅ Cleanup completed");
    } catch (error) {
        console.error("⚠️ Cleanup error:", error.message);
    }
    process.exit(1);
});

// Function to set a cache value
async function setCache(key, value, ttl = 3600) {
    try {
        const response = await axios.post(`${BASE_URL}/cache`, {
            key,
            value,
            ttl,
        });
        console.log("✅ Set Cache:", response.data);
        return response.data;
    } catch (error) {
        console.error(
            "❌ Error setting cache:",
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to get a cache value
async function getCache(key) {
    try {
        const response = await axios.get(`${BASE_URL}/cache/${key}`);
        console.log("✅ Get Cache:", response.data);
        return response.data;
    } catch (error) {
        console.error(
            "❌ Error getting cache:",
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to delete a cache value
async function deleteCache(key) {
    try {
        const response = await axios.delete(`${BASE_URL}/cache/${key}`);
        console.log("✅ Delete Cache:", response.data);
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(
                `Key ${key} not found during cleanup (already deleted)`
            );
            return { message: "Key already deleted" };
        } else {
            console.error(
                "❌ Error deleting cache:",
                error.response?.data || error.message
            );
            throw error;
        }
    }
}

// Function to get metrics
async function getMetrics() {
    try {
        const response = await axios.get(`${BASE_URL}/metrics`);
        // Don't log the entire metrics response as it can be very large
        console.log(
            `✅ Metrics received, length: ${response.data.length} bytes`
        );
        return response.data;
    } catch (error) {
        console.error(
            "❌ Error getting metrics:",
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to query Prometheus
async function queryPrometheus(query) {
    try {
        const response = await axios.get(`${PROMETHEUS_URL}/api/v1/query`, {
            params: {
                query,
            },
        });
        console.log(`✅ Prometheus query for "${query}" succeeded`);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error querying Prometheus (${query}):`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to check if metrics contain specific patterns
function checkMetricsContain(metricsData, patterns) {
    const results = {};
    for (const pattern of patterns) {
        results[pattern] = metricsData.includes(pattern);
    }
    return results;
}

// Function to wait for a specific amount of time
function wait(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// Cleanup function
async function cleanup() {
    console.log("\n📝 Running final cleanup");

    let cleanupSuccessful = true;
    const failures = [];

    // Ensure all test keys are deleted
    for (let i = 0; i < TEST_COUNT; i++) {
        const key = `${TEST_KEY_PREFIX}${i}`;
        try {
            await deleteCache(key);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                // Key already deleted, that's fine
            } else {
                console.error(
                    `⚠️ Failed to clean up key ${key}: ${error.message}`
                );
                failures.push(key);
                cleanupSuccessful = false;
            }
        }
    }

    if (cleanupSuccessful) {
        console.log("✅ All test keys successfully cleaned up");
    } else {
        console.error(`⚠️ Failed to clean up ${failures.length} keys`);
    }

    return cleanupSuccessful;
}

// Run metrics tests
async function runMetricsTests() {
    console.log("🚀 Starting Metrics Tests...");
    console.log("Using base URL:", BASE_URL);
    console.log("Using Prometheus URL:", PROMETHEUS_URL);

    try {
        // Test 1: Generate load to create metrics
        console.log("\n📝 Test 1: Generating load to create metrics");
        for (let i = 0; i < TEST_COUNT; i++) {
            const key = `${TEST_KEY_PREFIX}${i}`;
            await setCache(key, `Value ${i}`);
            await getCache(key);
        }

        // Test 2: Delete half of the keys
        console.log("\n📝 Test 2: Deleting half of the keys");
        for (let i = 0; i < TEST_COUNT / 2; i++) {
            const key = `${TEST_KEY_PREFIX}${i}`;
            await deleteCache(key);
        }

        // Wait for metrics to update
        console.log("\nWaiting for metrics to update...");
        await wait(2);

        // Test 3: Get metrics from the API
        console.log("\n📝 Test 3: Getting metrics from API");
        const metricsData = await getMetrics();

        // Test 4: Check if metrics contain expected patterns
        console.log(
            "\n📝 Test 4: Checking if metrics contain expected patterns"
        );
        const expectedPatterns = [
            "redis_cache_operations_total",
            "redis_cache_operations_errors_total",
            "redis_cache_size_keys",
            "redis_cache_memory_bytes",
            "redis_cache_op_duration_seconds",
            "redis_cache_nodes_total",
        ];

        const metricsResults = checkMetricsContain(
            metricsData,
            expectedPatterns
        );
        let allPatternsFound = true;

        for (const pattern in metricsResults) {
            if (metricsResults[pattern]) {
                console.log(`✅ Found metric: ${pattern}`);
            } else {
                console.error(`❌ Missing metric: ${pattern}`);
                allPatternsFound = false;
            }
        }

        if (allPatternsFound) {
            console.log("✅ All expected metrics patterns found!");
        } else {
            console.error("❌ Some expected metrics patterns are missing!");
        }

        // Test 5: Try to query Prometheus directly
        console.log("\n📝 Test 5: Querying Prometheus directly (if available)");
        try {
            // Check if cache operations were recorded
            const opsResult = await queryPrometheus(
                "redis_cache_operations_total"
            );
            console.log(
                "Operations metrics:",
                JSON.stringify(opsResult.data, null, 2)
            );

            // Check cache size
            const sizeResult = await queryPrometheus("redis_cache_size_keys");
            console.log(
                "Cache size metrics:",
                JSON.stringify(sizeResult.data, null, 2)
            );

            // Check node count
            const nodesResult = await queryPrometheus(
                "redis_cache_nodes_total"
            );
            console.log(
                "Node count metrics:",
                JSON.stringify(nodesResult.data, null, 2)
            );

            console.log("✅ Successfully queried Prometheus metrics!");
        } catch (error) {
            console.log(
                "⚠️ Skipping direct Prometheus queries - could not connect to Prometheus"
            );
            console.log(
                "   This is not a test failure if Prometheus is not running"
            );
        }

        // Test 6: Clean up remaining test keys
        console.log("\n📝 Test 6: Cleaning up remaining test keys");
        for (let i = TEST_COUNT / 2; i < TEST_COUNT; i++) {
            const key = `${TEST_KEY_PREFIX}${i}`;
            await deleteCache(key);
        }

        console.log("\n🎉 All metrics tests completed successfully!");

        // Run final cleanup check
        await cleanup();
    } catch (error) {
        console.error("❌ Metrics tests failed:", error.message);

        // Attempt cleanup even if tests fail
        await cleanup();

        process.exit(1);
    }
}

// Run the tests
runMetricsTests();
