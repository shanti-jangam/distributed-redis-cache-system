const axios = require("axios");

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3000";
const TEST_KEY = "json-test-" + Date.now();
const TEST_JSON_VALUE = {
    name: "John Doe",
    age: 30,
    address: {
        city: "New York",
        zip: "10001",
    },
    tags: ["developer", "nodejs"],
    isActive: true,
    metadata: {
        created: new Date().toISOString(),
        lastModified: null,
    },
};

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        await deleteCache(TEST_KEY);
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
        console.error(
            "❌ Error deleting cache:",
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to compare JSON objects
function compareJSON(obj1, obj2) {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
}

// Cleanup function to ensure test data is removed
async function cleanup() {
    console.log("\n📝 Cleaning up test data");
    try {
        await deleteCache(TEST_KEY);
        console.log("✅ Test data cleaned up successfully");
    } catch (error) {
        console.error("⚠️ Cleanup warning:", error.message);
        // Don't fail the test if cleanup fails
    }
}

// Run JSON value tests
async function runJsonTests() {
    console.log("🚀 Starting JSON Value Tests...");
    console.log("Using base URL:", BASE_URL);
    console.log("Test key:", TEST_KEY);

    try {
        // Test 1: Set a JSON value in cache
        console.log("\n📝 Test 1: Setting JSON value in cache");
        await setCache(TEST_KEY, TEST_JSON_VALUE);

        // Test 2: Get the JSON value
        console.log("\n📝 Test 2: Getting JSON value from cache");
        const getValue = await getCache(TEST_KEY);

        // Verify the JSON value matches
        if (compareJSON(getValue.value, TEST_JSON_VALUE)) {
            console.log("✅ JSON value verification passed!");
        } else {
            console.error("❌ JSON value verification failed!");
            console.error(
                "Expected:",
                JSON.stringify(TEST_JSON_VALUE, null, 2)
            );
            console.error("Received:", JSON.stringify(getValue.value, null, 2));
        }

        // Test 3: Test nested property access
        console.log("\n📝 Test 3: Verifying nested property access");
        if (getValue.value.address.city === TEST_JSON_VALUE.address.city) {
            console.log("✅ Nested property access works!");
        } else {
            console.error("❌ Nested property access failed!");
        }

        // Test 4: Test array property
        console.log("\n📝 Test 4: Verifying array property");
        if (compareJSON(getValue.value.tags, TEST_JSON_VALUE.tags)) {
            console.log("✅ Array property verification passed!");
        } else {
            console.error("❌ Array property verification failed!");
        }

        console.log("\n🎉 All JSON value tests completed successfully!");

        // Clean up after successful tests
        await cleanup();
    } catch (error) {
        console.error("❌ Tests failed:", error.message);

        // Attempt cleanup even if tests fail
        await cleanup();

        process.exit(1);
    }
}

// Run the tests
runJsonTests();
