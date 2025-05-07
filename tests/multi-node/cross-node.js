const axios = require("axios");

// Configuration
const NODE1_URL = process.env.NODE1_URL || "http://localhost:3000";
const NODE2_URL = process.env.NODE2_URL || "http://localhost:3001";
const NODE3_URL = process.env.NODE3_URL || "http://localhost:3002";
const TEST_KEY = "multi-node-" + Date.now();
const TEST_VALUE1 = "Value stored via node 1";
const TEST_VALUE2 = "Value updated via node 2";
const TEST_VALUE3 = "Value updated via node 3";

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        // Try to delete from each node
        await deleteCache(NODE1_URL, TEST_KEY).catch(() => {});
        await deleteCache(NODE2_URL, TEST_KEY).catch(() => {});
        await deleteCache(NODE3_URL, TEST_KEY).catch(() => {});
        console.log("✅ Cleanup completed");
    } catch (error) {
        console.error("⚠️ Cleanup error:", error.message);
    }
    process.exit(1);
});

// Function to set a cache value on a specific node
async function setCache(nodeUrl, key, value, ttl = 3600) {
    try {
        const response = await axios.post(`${nodeUrl}/cache`, {
            key,
            value,
            ttl,
        });
        console.log(`✅ Set Cache on ${nodeUrl}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error setting cache on ${nodeUrl}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to get a cache value from a specific node
async function getCache(nodeUrl, key) {
    try {
        const response = await axios.get(`${nodeUrl}/cache/${key}`);
        console.log(`✅ Get Cache from ${nodeUrl}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error getting cache from ${nodeUrl}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to delete a cache value from a specific node
async function deleteCache(nodeUrl, key) {
    try {
        const response = await axios.delete(`${nodeUrl}/cache/${key}`);
        console.log(`✅ Delete Cache from ${nodeUrl}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error deleting cache from ${nodeUrl}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to check health status of a node
async function checkHealth(nodeUrl) {
    try {
        const response = await axios.get(`${nodeUrl}/health`);
        console.log(`✅ Health check for ${nodeUrl}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Health check failed for ${nodeUrl}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Check function to verify value
async function checkValue(nodeUrl, key, expectedValue, description) {
    console.log(`Checking: ${description}`);
    try {
        const result = await getCache(nodeUrl, key);

        if (result && result.value === expectedValue) {
            console.log(`✅ Success! Value verified on ${nodeUrl}`);
            return { success: true, result };
        } else {
            console.error(
                `❌ Value mismatch on ${nodeUrl}. Expected: ${expectedValue}, Got: ${result?.value}`
            );
            return { success: false, result };
        }
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.error(`❌ Key not found on ${nodeUrl}`);
            return { success: false, error: "NOT_FOUND" };
        }
        throw error;
    }
}

// Check if a key has been deleted
async function checkDeleted(nodeUrl, key, description) {
    console.log(`Checking: ${description}`);
    try {
        const result = await getCache(nodeUrl, key);
        console.error(`❌ Key still exists on ${nodeUrl}: ${result.value}`);
        return { success: false, exists: true };
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log(`✅ Key successfully deleted from ${nodeUrl}`);
            return { success: true, exists: false };
        }
        throw error;
    }
}

// Cleanup function
async function cleanup() {
    console.log("\n📝 Cleaning up test data");

    let cleanupSuccessful = true;

    // Try to delete from node 1 first, as deletes should propagate
    try {
        await deleteCache(NODE1_URL, TEST_KEY);
        console.log("✅ Test data deleted via node 1");
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.log("✅ Key already deleted from node 1");
        } else {
            console.error("⚠️ Cleanup warning from node 1:", error.message);
            cleanupSuccessful = false;

            // Try other nodes as fallback
            try {
                await deleteCache(NODE2_URL, TEST_KEY).catch(() => {});
                await deleteCache(NODE3_URL, TEST_KEY).catch(() => {});
            } catch (backupError) {
                console.error("⚠️ Backup cleanup failed:", backupError.message);
            }
        }
    }

    return cleanupSuccessful;
}

// Run multi-node tests
async function runMultiNodeTests() {
    console.log("🚀 Starting Multi-Node Tests with ZooKeeper Coordination...");
    console.log("Node URLs:", NODE1_URL, NODE2_URL, NODE3_URL);
    console.log("Test key:", TEST_KEY);
    console.log(
        "✨ Zero-wait synchronization test (immediate consistency check)"
    );

    try {
        // Test 1: Check health of all nodes
        console.log("\n📝 Test 1: Checking health of all nodes");
        await checkHealth(NODE1_URL);
        await checkHealth(NODE2_URL);
        await checkHealth(NODE3_URL);

        // Test 2: Set value on node 1
        console.log("\n📝 Test 2: Setting value on node 1");
        await setCache(NODE1_URL, TEST_KEY, TEST_VALUE1);

        // Test 3: Read value from node 2 immediately
        console.log("\n📝 Test 3: Reading value from node 2 immediately");
        const node2Read = await checkValue(
            NODE2_URL,
            TEST_KEY,
            TEST_VALUE1,
            "Verifying value from node 1 is immediately available on node 2"
        );

        if (!node2Read.success) {
            console.error(
                "❌ Cross-node replication failed from node 1 to node 2"
            );
            process.exit(1);
        }

        // Test 4: Update value via node 2
        console.log("\n📝 Test 4: Updating value via node 2");
        await setCache(NODE2_URL, TEST_KEY, TEST_VALUE2);

        // Test 5: Verify update is reflected on node 1 immediately
        console.log(
            "\n📝 Test 5: Verifying update is reflected on node 1 immediately"
        );
        const node1Update = await checkValue(
            NODE1_URL,
            TEST_KEY,
            TEST_VALUE2,
            "Verifying value updated on node 2 is immediately reflected on node 1"
        );

        if (!node1Update.success) {
            console.error(
                "❌ Cross-node replication failed from node 2 to node 1"
            );
            process.exit(1);
        }

        // Test 6: Update value via node 3
        console.log("\n📝 Test 6: Updating value via node 3");
        await setCache(NODE3_URL, TEST_KEY, TEST_VALUE3);

        // Test 7: Verify update is reflected on all nodes immediately
        console.log(
            "\n📝 Test 7: Verifying update is reflected on all nodes immediately"
        );
        console.log("Checking for immediate replication across all nodes...");

        // Get value from each node
        const node3Check = await checkValue(
            NODE3_URL,
            TEST_KEY,
            TEST_VALUE3,
            "Verifying node 3 has its own updated value"
        );

        const node1Check = await checkValue(
            NODE1_URL,
            TEST_KEY,
            TEST_VALUE3,
            "Verifying node 1 immediately reflects update from node 3"
        );

        const node2Check = await checkValue(
            NODE2_URL,
            TEST_KEY,
            TEST_VALUE3,
            "Verifying node 2 immediately reflects update from node 3"
        );

        if (!node3Check.success || !node1Check.success || !node2Check.success) {
            console.error(
                "❌ Cross-node replication failed for updates from node 3"
            );
            process.exit(1);
        }

        console.log(
            "\n✅ Value is consistent across all nodes with zero wait time!"
        );

        // Test 8: Delete the value from node 1
        console.log("\n📝 Test 8: Deleting value from node 1");
        await deleteCache(NODE1_URL, TEST_KEY);

        // Test 9: Verify deletion is reflected across all nodes immediately
        console.log(
            "\n📝 Test 9: Verifying deletion is reflected across all nodes immediately"
        );

        // Check if deletion succeeded on all nodes
        const node1DeleteCheck = await checkDeleted(
            NODE1_URL,
            TEST_KEY,
            "Verifying key was deleted from node 1"
        );

        const node2DeleteCheck = await checkDeleted(
            NODE2_URL,
            TEST_KEY,
            "Verifying key was deleted from node 2"
        );

        const node3DeleteCheck = await checkDeleted(
            NODE3_URL,
            TEST_KEY,
            "Verifying key was deleted from node 3"
        );

        if (
            !node1DeleteCheck.success ||
            !node2DeleteCheck.success ||
            !node3DeleteCheck.success
        ) {
            console.error("❌ Cross-node deletion propagation failed");
            process.exit(1);
        }

        console.log(
            "\n✅ Deletion successfully propagated across all nodes with zero wait time!"
        );

        console.log("\n----- 🎉 Test Summary 🎉 -----");
        console.log(
            "✅ ZooKeeper coordination provides immediate consistency across nodes"
        );
        console.log(
            "✅ Cross-node replication works correctly for all operations with no delay"
        );
        console.log(
            "✅ All nodes remain perfectly synchronized without artificial wait times"
        );
        console.log("--------------------------------");
    } catch (error) {
        console.error(
            "❌ Multi-node tests encountered an unexpected error:",
            error.message
        );
        if (error.response) {
            console.error("HTTP Status:", error.response.status);
            console.error("Response Data:", error.response.data);
        }

        // Attempt cleanup even if tests fail
        await cleanup();

        process.exit(1);
    }
}

// Run the tests
runMultiNodeTests();
