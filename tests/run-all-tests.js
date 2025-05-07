const { spawn } = require("child_process");
const path = require("path");

// Define test categories and their corresponding files
const testSuites = [
    {
        name: "Basic Operations",
        file: "basic/basic-operations.js",
        timeout: 30000,
    },
    { name: "JSON Values", file: "json/json-values.js", timeout: 30000 },
    { name: "TTL Expiration", file: "ttl/ttl-expiration.js", timeout: 30000 },
    { name: "Load Testing", file: "load/load-test.js", timeout: 60000 },
    {
        name: "Fault Tolerance",
        file: "fault-tolerance/node-failure.js",
        timeout: 120000,
    }, // 2 minutes for fault tolerance tests
    {
        name: "Multi-Node Operations",
        file: "multi-node/cross-node.js",
        timeout: 60000,
    },
    { name: "Metrics", file: "metrics/prometheus-metrics.js", timeout: 30000 },
];

// Function to run a command with streaming output and timeout
function runCommand(command, args, timeout) {
    return new Promise((resolve, reject) => {
        console.log(`\n🔄 Executing: ${command} ${args.join(" ")}`);

        // Create a timestamp for logging
        const timestamp = new Date().toISOString();
        console.log(
            `[${timestamp}] Starting test with ${timeout / 1000}s timeout...`
        );

        const childProcess = spawn(command, args, {
            stdio: "pipe", // Pipe streams for better output control
            shell: false, // Avoid shell to prevent certain issues
        });

        let stdoutData = "";
        let stderrData = "";

        // Stream output as it comes
        childProcess.stdout.on("data", (data) => {
            const output = data.toString();
            // Output in real-time
            process.stdout.write(output);
            stdoutData += output;
        });

        childProcess.stderr.on("data", (data) => {
            const output = data.toString();
            // Output in real-time
            process.stderr.write(output);
            stderrData += output;
        });

        // Add timeout handling
        const timeoutId = setTimeout(() => {
            console.error(
                `\n⏱️ Test timed out after ${timeout / 1000} seconds`
            );
            childProcess.kill(); // Kill the process on timeout
            reject(new Error(`Test timed out after ${timeout / 1000} seconds`));
        }, timeout);

        childProcess.on("close", (code) => {
            clearTimeout(timeoutId); // Clear timeout when process ends

            if (code === 0) {
                resolve({ stdout: stdoutData, stderr: stderrData });
            } else {
                console.error(`\n❌ Command failed with exit code ${code}`);
                reject(new Error(`Process exited with code ${code}`));
            }
        });

        childProcess.on("error", (error) => {
            clearTimeout(timeoutId);
            console.error(`\n❌ Failed to start command: ${error.message}`);
            reject(error);
        });
    });
}

// Function to run a specific test suite
async function runTestSuite(testSuite) {
    console.log(`\n\n======================================================`);
    console.log(`🚀 Running Test Suite: ${testSuite.name}`);
    console.log(`======================================================\n`);

    const testFile = path.join(__dirname, testSuite.file);
    try {
        await runCommand("node", [testFile], testSuite.timeout);
        console.log(`\n✅ Test Suite Completed: ${testSuite.name}`);
        return true;
    } catch (error) {
        console.error(`\n❌ Test Suite Failed: ${testSuite.name}`);
        console.error(`   Error: ${error.message}`);

        // Special handling for fault tolerance tests - they may fail by design
        if (testSuite.name === "Fault Tolerance") {
            console.log(
                "⚠️ Note: Fault tolerance tests may fail by design to demonstrate node failure handling"
            );
        }

        return false;
    }
}

// Function to run all test suites
async function runAllTests() {
    console.log(`\n🚀 Starting All Test Suites\n`);
    console.log(`Total test suites: ${testSuites.length}`);

    const startTime = Date.now();

    const results = {};
    let passed = 0;
    let failed = 0;

    // Get command line arguments to filter test suites
    const args = process.argv.slice(2);
    const selectedSuites =
        args.length > 0
            ? testSuites.filter((suite) =>
                  args.some((arg) =>
                      suite.name.toLowerCase().includes(arg.toLowerCase())
                  )
              )
            : testSuites;

    if (selectedSuites.length === 0) {
        console.log(
            `No test suites match the provided filters: ${args.join(", ")}`
        );
        process.exit(1);
    }

    console.log(
        `Running ${selectedSuites.length} test suites out of ${testSuites.length} total`
    );

    for (const suite of selectedSuites) {
        const suiteStartTime = Date.now();
        const success = await runTestSuite(suite);
        const suiteDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(2);

        results[suite.name] = {
            status: success ? "Passed" : "Failed",
            duration: suiteDuration,
        };

        if (success) {
            passed++;
        } else {
            failed++;
        }

        // Wait a moment between test suites to ensure cleanup
        if (selectedSuites.indexOf(suite) < selectedSuites.length - 1) {
            console.log("\n⏳ Waiting 3 seconds before next test suite...");
            await new Promise((resolve) => setTimeout(resolve, 3000));
        }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`\n\n======================================================`);
    console.log(`📊 Test Results Summary`);
    console.log(`======================================================\n`);
    console.log(`Total test suites run: ${selectedSuites.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total time: ${duration.toFixed(2)} seconds\n`);

    console.log(`Individual test suite results:`);
    for (const suite of selectedSuites) {
        const result = results[suite.name];
        const emoji = result.status === "Passed" ? "✅" : "❌";
        console.log(
            `${emoji} ${suite.name}: ${result.status} (${result.duration}s)`
        );
    }

    if (failed > 0) {
        console.log(
            `\n❌ Some test suites failed. Please check the logs above for details.`
        );
        process.exit(1);
    } else {
        console.log(`\n🎉 All test suites passed successfully!`);
    }
}

// Handle unexpected errors
process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    process.exit(1);
});

// Run all tests
runAllTests().catch((error) => {
    console.error("Error running tests:", error);
    process.exit(1);
});
