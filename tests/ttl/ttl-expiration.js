const axios = require("axios");

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3000";
const TEST_KEY = "ttl-test-" + Date.now();
const TEST_VALUE = "This value will expire soon";
const SHORT_TTL = 5; // 5 seconds

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        // We try to clean up all potential test keys
        const LONG_TTL_KEY = "ttl-test-long-" + Date.now();
        await deleteCache(TEST_KEY).catch(() => {});
        await deleteCache(LONG_TTL_KEY).catch(() => {});
        console.log("✅ Cleanup completed");
    } catch (error) {
        console.error("⚠️ Cleanup error:", error.message);
    }
    process.exit(1);
});

// Function to set a cache value
async function setCache(key, value, ttl) {
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
        if (error.response && error.response.status === 404) {
            console.log("Key not found (expected for expired keys)");
        } else {
            console.error(
                "❌ Error getting cache:",
                error.response?.data || error.message
            );
        }
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
                `Key ${key} not found during cleanup (already expired)`
            );
        } else {
            console.error(
                "❌ Error deleting cache:",
                error.response?.data || error.message
            );
        }
        throw error;
    }
}

// Function to wait for a specific amount of time
function wait(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

// Cleanup function
async function cleanup(longTtlKey) {
    console.log("\n📝 Cleaning up test data");

    // No need to clean up short TTL key as it should already be expired
    try {
        if (longTtlKey) {
            await deleteCache(longTtlKey);
            console.log("✅ Long TTL test data cleaned up successfully");
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log("✅ Key already deleted or expired");
        } else {
            console.error("⚠️ Cleanup warning:", error.message);
        }
        // Don't fail the test if cleanup fails
    }
}

// Run TTL tests
async function runTTLTests() {
    console.log("🚀 Starting TTL Expiration Tests...");
    console.log("Using base URL:", BASE_URL);
    console.log("Test key:", TEST_KEY);

    let longTtlKey = null;

    try {
        // Test 1: Set a value with short TTL
        console.log("\n📝 Test 1: Setting value with short TTL (5 seconds)");
        await setCache(TEST_KEY, TEST_VALUE, SHORT_TTL);

        // Test 2: Immediately verify the value exists
        console.log("\n📝 Test 2: Immediately verifying value exists");
        try {
            const getValue = await getCache(TEST_KEY);
            if (getValue.value === TEST_VALUE) {
                console.log("✅ Value is available before expiration!");
            } else {
                console.error("❌ Value verification failed!");
            }
        } catch (error) {
            console.error("❌ Value should exist but doesn't!");
            throw error;
        }

        // Test 3: Wait for expiration
        console.log(
            `\n📝 Test 3: Waiting for ${
                SHORT_TTL + 1
            } seconds to let TTL expire...`
        );
        await wait(SHORT_TTL + 1);

        // Test 4: Verify the value is now expired
        console.log("\n📝 Test 4: Verifying value has expired");
        try {
            await getCache(TEST_KEY);
            console.error("❌ Value should have expired but still exists!");
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log("✅ Value has expired as expected!");
            } else {
                console.error("❌ Unexpected error:", error.message);
                throw error;
            }
        }

        // Test 5: Set a value with longer TTL
        longTtlKey = "ttl-test-long-" + Date.now();
        console.log("\n📝 Test 5: Setting value with longer TTL (60 seconds)");
        await setCache(longTtlKey, "This value will last longer", 60);

        // Test 6: Verify the longer TTL value exists
        console.log("\n📝 Test 6: Verifying longer TTL value exists");
        try {
            const getValue = await getCache(longTtlKey);
            console.log("✅ Longer TTL value is available as expected!");
        } catch (error) {
            console.error("❌ Longer TTL value should exist but doesn't!");
            throw error;
        }

        console.log("\n🎉 All TTL tests completed successfully!");

        // Clean up after successful tests
        await cleanup(longTtlKey);
    } catch (error) {
        console.error("❌ Tests failed:", error.message);

        // Attempt cleanup even if tests fail
        if (longTtlKey) {
            await cleanup(longTtlKey);
        }

        process.exit(1);
    }
}

// Run the tests
runTTLTests();
