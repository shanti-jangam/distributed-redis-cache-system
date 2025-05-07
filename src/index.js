require("dotenv").config();
const express = require("express");
const CacheManager = require("./cache/cacheManager");
const CoordinationService = require("./coordination/coordinationService");
const CommunicationLayer = require("./communication/communicationLayer");
const MonitoringSystem = require("./monitoring/monitoringSystem");
const logger = require("./utils/logger");

const app = express();
const PORT = process.env.API_PORT || 3000;

// Initialize services
const coordinationService = new CoordinationService();
const cacheManager = new CacheManager(coordinationService);
const communicationLayer = new CommunicationLayer(cacheManager);
const monitoringSystem = new MonitoringSystem(cacheManager);

// Set communication layer reference in cache manager
cacheManager.setCommunicationLayer(communicationLayer);

// Middleware
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});

// Cache API endpoints
app.get("/cache/:key", async (req, res) => {
    const startTime = process.hrtime();
    try {
        const value = await cacheManager.get(req.params.key);

        // Record operation completion time
        const endTime = process.hrtime(startTime);
        const durationInSeconds = endTime[0] + endTime[1] / 1e9;
        monitoringSystem.recordResponseTime("get", durationInSeconds);

        if (value === null) {
            // Record cache miss and operation result
            monitoringSystem.recordHitOrMiss(false);
            monitoringSystem.recordOperation("get", false);
            return res.status(404).json({ error: "Key not found" });
        }

        // Record cache hit and operation result
        monitoringSystem.recordHitOrMiss(true);
        monitoringSystem.recordOperation("get", true);
        res.json({ key: req.params.key, value });
    } catch (error) {
        // Record error and operation result
        monitoringSystem.recordError("get", error.name || "unknown");
        monitoringSystem.recordOperation("get", false);

        logger.error(
            `Error retrieving key ${req.params.key}: ${error.message}`
        );
        res.status(500).json({ error: error.message });
    }
});

app.post("/cache", async (req, res) => {
    const startTime = process.hrtime();
    try {
        const { key, value, ttl } = req.body;
        if (!key || value === undefined) {
            // Record error for bad request
            monitoringSystem.recordError("set", "BadRequest");
            monitoringSystem.recordOperation("set", false);
            return res
                .status(400)
                .json({ error: "Key and value are required" });
        }

        // Our cacheManager.set now handles the timestamping internally
        await cacheManager.set(key, value, ttl);

        // Record operation completion time and result
        const endTime = process.hrtime(startTime);
        const durationInSeconds = endTime[0] + endTime[1] / 1e9;
        monitoringSystem.recordResponseTime("set", durationInSeconds);
        monitoringSystem.recordOperation("set", true);

        res.status(201).json({ message: "Cached successfully" });
    } catch (error) {
        // Record error and operation result
        monitoringSystem.recordError("set", error.name || "unknown");
        monitoringSystem.recordOperation("set", false);

        logger.error(`Error setting cache: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

app.delete("/cache/:key", async (req, res) => {
    const startTime = process.hrtime();
    try {
        await cacheManager.delete(req.params.key);

        // Record operation completion time and result
        const endTime = process.hrtime(startTime);
        const durationInSeconds = endTime[0] + endTime[1] / 1e9;
        monitoringSystem.recordResponseTime("delete", durationInSeconds);
        monitoringSystem.recordOperation("delete", true);

        res.json({ message: "Key deleted successfully" });
    } catch (error) {
        // Record error and operation result
        monitoringSystem.recordError("delete", error.name || "unknown");
        monitoringSystem.recordOperation("delete", false);

        logger.error(`Error deleting key ${req.params.key}: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Monitoring endpoint
app.get("/metrics", async (req, res) => {
    try {
        const metrics = await monitoringSystem.getMetrics();
        res.set("Content-Type", "text/plain");
        res.send(metrics);
    } catch (error) {
        logger.error(`Error retrieving metrics: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Start the server
async function startup() {
    try {
        // Initialize coordination service
        await coordinationService.initialize();
        logger.info("Coordination service initialized");

        // Initialize cache manager
        await cacheManager.initialize();
        logger.info("Cache manager initialized");

        // Start communication layer
        await communicationLayer.initialize();
        logger.info("Communication layer initialized");

        // Start monitoring system
        await monitoringSystem.initialize();
        logger.info("Monitoring system initialized");

        // Log environment information for debugging
        logger.info(
            `Environment: NODE_ID=${process.env.NODE_ID}, REDIS_HOST=${process.env.REDIS_HOST}, REDIS_PORT=${process.env.REDIS_PORT}, GRPC_PORT=${process.env.GRPC_PORT}, API_PORT=${PORT}`
        );

        // Start HTTP API server
        app.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
        });

        // Handle graceful shutdown
        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
    } catch (error) {
        logger.error(`Failed to start server: ${error.message}`);
        process.exit(1);
    }
}

async function shutdown() {
    logger.info("Shutting down server...");

    try {
        await communicationLayer.shutdown();
        await cacheManager.shutdown();
        await coordinationService.shutdown();
        await monitoringSystem.shutdown();
        logger.info("Graceful shutdown completed");
        process.exit(0);
    } catch (error) {
        logger.error(`Error during shutdown: ${error.message}`);
        process.exit(1);
    }
}

startup();
