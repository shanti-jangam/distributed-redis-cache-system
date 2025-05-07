const fs = require("fs");
const { exec } = require("child_process");
const axios = require("axios");

async function checkReplication() {
    console.log("🔍 Checking Redis Replication Configuration");
    console.log("==========================================\n");

    // 1. Check .env file for REPLICA_FACTOR
    try {
        console.log("📋 Checking .env file:");
        if (fs.existsSync(".env")) {
            const envContent = fs.readFileSync(".env", "utf8");
            const replicaFactorMatch = envContent.match(
                /REPLICA_FACTOR\s*=\s*(\d+)/
            );
            if (replicaFactorMatch) {
                console.log(`   REPLICA_FACTOR = ${replicaFactorMatch[1]}`);
                if (replicaFactorMatch[1] < 2) {
                    console.log(
                        "   ⚠️ REPLICA_FACTOR should be at least 2 for fault tolerance"
                    );
                }
            } else {
                console.log("   ❌ REPLICA_FACTOR not found in .env file");
            }

            // Check other relevant settings
            const redisSettings = envContent.match(/REDIS_[A-Z_]+=.*/g);
            if (redisSettings && redisSettings.length > 0) {
                console.log("   Other Redis settings:");
                redisSettings.forEach((setting) =>
                    console.log(`   ${setting}`)
                );
            }
        } else {
            console.log("   ❌ .env file not found");
        }
    } catch (error) {
        console.error("   ❌ Error reading .env file:", error.message);
    }

    console.log("\n");

    // 2. Check docker-compose.yml for Redis configuration
    try {
        console.log("📋 Checking docker-compose.yml:");
        if (fs.existsSync("docker-compose.yml")) {
            const dockerContent = fs.readFileSync("docker-compose.yml", "utf8");

            // Count Redis nodes
            const redisNodeMatches = dockerContent.match(/redis-node\d+/g);
            if (redisNodeMatches) {
                const uniqueNodes = [...new Set(redisNodeMatches)];
                console.log(
                    `   Found ${
                        uniqueNodes.length
                    } Redis nodes: ${uniqueNodes.join(", ")}`
                );
            } else {
                console.log("   ❌ No Redis nodes found in docker-compose.yml");
            }

            // Check for REPLICA_FACTOR environment variable
            const replicaFactorMatch = dockerContent.match(
                /REPLICA_FACTOR:\s*(\d+)/
            );
            if (replicaFactorMatch) {
                console.log(
                    `   REPLICA_FACTOR in docker-compose = ${replicaFactorMatch[1]}`
                );
            }
        } else {
            console.log("   ❌ docker-compose.yml file not found");
        }
    } catch (error) {
        console.error("   ❌ Error reading docker-compose.yml:", error.message);
    }

    console.log("\n");

    // 3. Check running containers
    try {
        console.log("📋 Checking running Docker containers:");
        exec("docker-compose ps", (error, stdout, stderr) => {
            if (error) {
                console.error(`   ❌ Error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`   ❌ Error: ${stderr}`);
                return;
            }
            console.log(stdout);

            // Count Redis nodes that are running
            const runningRedisNodes = stdout.match(/redis-node\d+.+Up/g);
            if (runningRedisNodes) {
                console.log(
                    `   ✅ ${runningRedisNodes.length} Redis nodes are running`
                );
            } else {
                console.log("   ⚠️ No Redis nodes appear to be running");
            }
        });
    } catch (error) {
        console.error("   ❌ Error checking Docker containers:", error.message);
    }

    console.log("\n");

    // 4. Check application configuration via API
    try {
        console.log("📋 Checking application configuration via API:");
        const urls = [
            "http://localhost:3000/health",
            "http://localhost:3000/config",
            "http://localhost:3000/nodes",
        ];

        for (const url of urls) {
            try {
                const response = await axios.get(url);
                console.log(`   ✅ ${url}: ${JSON.stringify(response.data)}`);
            } catch (error) {
                console.log(`   ❌ ${url}: ${error.message}`);
            }
        }
    } catch (error) {
        console.error("   ❌ Error checking API:", error.message);
    }

    console.log("\n");
    console.log("📋 Recommendations:");
    console.log("1. Make sure REPLICA_FACTOR is set to at least 2 in .env");
    console.log("2. Ensure all Redis nodes are running");
    console.log(
        "3. Check that your replication logic is working in your cache manager"
    );
    console.log(
        "4. Verify consistent hashing is properly handling node failures"
    );
}

checkReplication();
