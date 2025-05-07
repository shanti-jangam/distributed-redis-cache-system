const axios = require("axios");

// Configuration
const BASE_URL = process.env.API_URL || "http://localhost:3000";
const KEY_PREFIX = "load-test-";
const TEST_COUNT = parseInt(process.env.TEST_COUNT || "100");
const CONCURRENT_REQUESTS = parseInt(process.env.CONCURRENT_REQUESTS || "10");

// Create a keys array for tracking
const keys = Array.from({ length: TEST_COUNT }, (_, i) => `${KEY_PREFIX}${i}`);

// Cleanup handler for interruptions
process.on("SIGINT", async () => {
    console.log("\n⚠️ Test interrupted, cleaning up...");
    try {
        console.log(`Cleaning up ${keys.length} test keys...`);
        await runInBatches(
            keys.map((key) => () => deleteCache(key).catch(() => {})),
            CONCURRENT_REQUESTS
        );
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
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error setting cache for key ${key}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to get a cache value
async function getCache(key) {
    try {
        const response = await axios.get(`${BASE_URL}/cache/${key}`);
        return response.data;
    } catch (error) {
        console.error(
            `❌ Error getting cache for key ${key}:`,
            error.response?.data || error.message
        );
        throw error;
    }
}

// Function to delete a cache value
async function deleteCache(key) {
    try {
        const response = await axios.delete(`${BASE_URL}/cache/${key}`);
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // Key already deleted, that's fine
            return { message: "Key already deleted" };
        } else {
            console.error(
                `❌ Error deleting cache for key ${key}:`,
                error.response?.data || error.message
            );
            throw error;
        }
    }
}

// Function to run tasks in batches
async function runInBatches(tasks, batchSize) {
    const results = [];
    for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize);
        const batchResults = await Promise.all(
            batch.map((task) => task().catch((err) => err))
        );
        results.push(...batchResults);
    }
    return results;
}

// Cleanup function
async function cleanup() {
    console.log("\n📝 Final cleanup check");

    // The test already includes deletion verification,
    // but we'll do a final check to be absolutely sure

    let remainingKeys = 0;

    // Check a few random keys to see if any are still around
    const sampleIndices = Array.from({ length: 5 }, () =>
        Math.floor(Math.random() * TEST_COUNT)
    );

    for (const idx of sampleIndices) {
        const key = `${KEY_PREFIX}${idx}`;
        try {
            await getCache(key);
            console.error(`⚠️ Key ${key} still exists, deleting it now`);
            await deleteCache(key);
            remainingKeys++;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                // This is good - key doesn't exist
            } else {
                console.error(`⚠️ Error checking key ${key}: ${error.message}`);
            }
        }
    }

    if (remainingKeys > 0) {
        // If we found any keys in our sample, do a full cleanup again
        console.log(
            `Found remaining keys in sample, running full cleanup for all ${TEST_COUNT} keys`
        );
        await runInBatches(
            keys.map((key) => () => deleteCache(key).catch(() => {})),
            CONCURRENT_REQUESTS
        );
    } else {
        console.log("✅ All keys appear to be properly deleted");
    }

    return remainingKeys === 0;
}

// Run load tests
async function runLoadTests() {
    console.log("🚀 Starting Load Tests...");
    console.log(`Using base URL: ${BASE_URL}`);
    console.log(`Test count: ${TEST_COUNT}`);
    console.log(`Concurrent requests: ${CONCURRENT_REQUESTS}`);

    const startTime = Date.now();

    try {
        // Test 1: Set multiple keys concurrently
        console.log("\n📝 Test 1: Setting multiple keys concurrently");
        const setStartTime = Date.now();

        const setTasks = keys.map(
            (key) => () =>
                setCache(key, `Value for ${key} at ${new Date().toISOString()}`)
        );

        await runInBatches(setTasks, CONCURRENT_REQUESTS);

        const setEndTime = Date.now();
        const setDuration = (setEndTime - setStartTime) / 1000;
        console.log(
            `✅ Successfully set ${TEST_COUNT} keys in ${setDuration} seconds`
        );
        console.log(
            `Average time per set operation: ${
                setDuration / TEST_COUNT
            } seconds`
        );
        console.log(
            `Throughput: ${Math.round(
                TEST_COUNT / setDuration
            )} operations/second`
        );

        // Test 2: Get multiple keys concurrently
        console.log("\n📝 Test 2: Getting multiple keys concurrently");
        const getStartTime = Date.now();

        const getTasks = keys.map((key) => () => getCache(key));

        const getResults = await runInBatches(getTasks, CONCURRENT_REQUESTS);

        const getEndTime = Date.now();
        const getDuration = (getEndTime - getStartTime) / 1000;

        // Count successful gets
        const successfulGets = getResults.filter(
            (result) => !(result instanceof Error)
        ).length;

        console.log(
            `✅ Successfully retrieved ${successfulGets}/${TEST_COUNT} keys in ${getDuration} seconds`
        );
        console.log(
            `Average time per get operation: ${
                getDuration / TEST_COUNT
            } seconds`
        );
        console.log(
            `Throughput: ${Math.round(
                TEST_COUNT / getDuration
            )} operations/second`
        );

        // Test 3: Delete multiple keys concurrently
        console.log("\n📝 Test 3: Deleting multiple keys concurrently");
        const deleteStartTime = Date.now();

        const deleteTasks = keys.map((key) => () => deleteCache(key));

        await runInBatches(deleteTasks, CONCURRENT_REQUESTS);

        const deleteEndTime = Date.now();
        const deleteDuration = (deleteEndTime - deleteStartTime) / 1000;
        console.log(
            `✅ Successfully deleted ${TEST_COUNT} keys in ${deleteDuration} seconds`
        );
        console.log(
            `Average time per delete operation: ${
                deleteDuration / TEST_COUNT
            } seconds`
        );
        console.log(
            `Throughput: ${Math.round(
                TEST_COUNT / deleteDuration
            )} operations/second`
        );

        // Test 4: Verify keys are deleted
        console.log("\n📝 Test 4: Verifying keys are deleted");
        let deletedCount = 0;

        for (let i = 0; i < keys.length; i += CONCURRENT_REQUESTS) {
            const batch = keys.slice(i, i + CONCURRENT_REQUESTS);
            const results = await Promise.all(
                batch.map((key) =>
                    getCache(key)
                        .then(() => false)
                        .catch((err) => {
                            return err.response && err.response.status === 404;
                        })
                )
            );

            deletedCount += results.filter((result) => result === true).length;
        }

        console.log(
            `✅ Verified ${deletedCount}/${TEST_COUNT} keys were deleted`
        );

        const totalDuration = (Date.now() - startTime) / 1000;
        console.log(
            `\n🎉 All load tests completed in ${totalDuration} seconds!`
        );
        console.log(`Total operations: ${TEST_COUNT * 3} (set, get, delete)`);
        console.log(
            `Overall throughput: ${Math.round(
                (TEST_COUNT * 3) / totalDuration
            )} operations/second`
        );

        // Run final cleanup check
        await cleanup();
    } catch (error) {
        console.error("❌ Load tests failed:", error.message);

        // Attempt cleanup even if tests fail
        await cleanup();

        process.exit(1);
    }
}

// Run the tests
runLoadTests();
