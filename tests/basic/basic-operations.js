const axios = require("axios");

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3000";
const TEST_KEY = "basic-test-" + Date.now();
const TEST_VALUE = "This is a basic test value";

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        await deleteCache(TEST_KEY).catch(() => {});
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

// Cleanup function
async function cleanup() {
    console.log("\n📝 Cleaning up test data");
    try {
        // This test already includes deletion as part of the test flow,
        // but we'll try to delete again just to be sure
        await deleteCache(TEST_KEY).catch(() => {});
        console.log("✅ Cleanup completed");
        return true;
    } catch (error) {
        console.error("⚠️ Cleanup warning:", error.message);
        return false;
    }
}

// Run basic operation tests
async function runBasicTests() {
    console.log("🚀 Starting Basic Operation Tests...");
    console.log("Using base URL:", BASE_URL);
    console.log("Test key:", TEST_KEY);

    try {
        // Test 1: Set a cache value
        console.log("\n📝 Test 1: Setting cache value");
        await setCache(TEST_KEY, TEST_VALUE);

        // Test 2: Get the cache value
        console.log("\n📝 Test 2: Getting cache value");
        const getValue = await getCache(TEST_KEY);

        // Verify the value matches
        if (getValue.value === TEST_VALUE) {
            console.log("✅ Value verification passed!");
        } else {
            console.error("❌ Value verification failed!");
            console.error("Expected:", TEST_VALUE);
            console.error("Received:", getValue.value);
        }

        // Test 3: Delete the cache value
        console.log("\n📝 Test 3: Deleting cache value");
        await deleteCache(TEST_KEY);

        // Test 4: Try to get the deleted value (should fail)
        console.log("\n📝 Test 4: Verifying deletion");
        try {
            await getCache(TEST_KEY);
            console.error("❌ Value should be deleted but still exists!");
        } catch (error) {
            console.log("✅ Value successfully deleted!");
        }

        console.log("\n🎉 All basic operation tests completed successfully!");

        // Run final cleanup check, though deletion is already part of the test
        await cleanup();
    } catch (error) {
        console.error("❌ Tests failed:", error.message);

        // Attempt cleanup even if tests fail
        await cleanup();

        process.exit(1);
    }
}

// Run the tests
runBasicTests();
