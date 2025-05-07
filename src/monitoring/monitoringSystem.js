const client = require("prom-client");
const logger = require("../utils/logger");

class MonitoringSystem {
    constructor(cacheManager) {
        this.cacheManager = cacheManager;
        this.register = new client.Registry();
        this.metrics = {};
        this.initialized = false;
        this.collectInterval = null;
        this.nodeId = process.env.NODE_ID || "node1";
    }

    /**
     * Initialize the monitoring system
     */
    async initialize() {
        logger.info("Initializing monitoring system");

        // Add default metrics
        client.collectDefaultMetrics({
            register: this.register,
            prefix: "redis_cache_",
            labels: { node_id: this.nodeId },
        });

        // Define custom metrics
        this.defineMetrics();

        // Start collecting metrics
        this.startMetricsCollection();

        this.initialized = true;
        logger.info("Monitoring system initialized successfully");
        return true;
    }

    /**
     * Define custom prometheus metrics
     */
    defineMetrics() {
        // Cache operations counter
        this.metrics.cacheOperations = new client.Counter({
            name: "redis_cache_operations_total",
            help: "Total number of cache operations",
            labelNames: ["operation", "node_id", "status"],
            registers: [this.register],
        });

        // Operation errors counter
        this.metrics.operationErrors = new client.Counter({
            name: "redis_cache_operations_errors_total",
            help: "Total number of cache operation errors",
            labelNames: ["operation", "node_id", "error_type"],
            registers: [this.register],
        });

        // Cache hit ratio
        this.metrics.cacheHits = new client.Counter({
            name: "redis_cache_hits_total",
            help: "Total number of cache hits",
            labelNames: ["node_id"],
            registers: [this.register],
        });

        this.metrics.cacheMisses = new client.Counter({
            name: "redis_cache_misses_total",
            help: "Total number of cache misses",
            labelNames: ["node_id"],
            registers: [this.register],
        });

        // Cache size
        this.metrics.cacheSize = new client.Gauge({
            name: "redis_cache_size_keys",
            help: "Number of keys in the cache",
            labelNames: ["node_id"],
            registers: [this.register],
        });

        // Cache memory usage
        this.metrics.cacheMemory = new client.Gauge({
            name: "redis_cache_memory_bytes",
            help: "Memory used by the cache in bytes",
            labelNames: ["node_id"],
            registers: [this.register],
        });

        // Node count
        this.metrics.nodeCount = new client.Gauge({
            name: "redis_cache_nodes_total",
            help: "Total number of nodes in the cluster",
            registers: [this.register],
        });

        // Response time
        this.metrics.responseTime = new client.Histogram({
            name: "redis_cache_op_duration_seconds",
            help: "Operation duration in seconds",
            labelNames: ["operation", "node_id"],
            buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
            registers: [this.register],
        });
    }

    /**
     * Start collecting metrics at regular intervals
     */
    startMetricsCollection() {
        const interval = parseInt(process.env.METRICS_INTERVAL || "10000", 10);

        this.collectInterval = setInterval(async () => {
            try {
                await this.collectMetrics();
            } catch (error) {
                logger.error(`Failed to collect metrics: ${error.message}`);
            }
        }, interval);
    }

    /**
     * Collect metrics from Redis and update Prometheus metrics
     */
    async collectMetrics() {
        try {
            // Collect cache stats
            const stats = await this.cacheManager.getStats();

            // Update metrics
            if (stats.keys !== undefined) {
                this.metrics.cacheSize.set(
                    { node_id: this.nodeId },
                    stats.keys
                );
            }

            if (stats.memory && stats.memory.used) {
                // Parse memory string like "1.05M" to bytes
                const memoryString = stats.memory.used;
                let memoryBytes = 0;

                if (memoryString.endsWith("K")) {
                    memoryBytes = parseFloat(memoryString.slice(0, -1)) * 1024;
                } else if (memoryString.endsWith("M")) {
                    memoryBytes =
                        parseFloat(memoryString.slice(0, -1)) * 1024 * 1024;
                } else if (memoryString.endsWith("G")) {
                    memoryBytes =
                        parseFloat(memoryString.slice(0, -1)) *
                        1024 *
                        1024 *
                        1024;
                } else {
                    memoryBytes = parseFloat(memoryString);
                }

                this.metrics.cacheMemory.set(
                    { node_id: this.nodeId },
                    memoryBytes
                );
            }

            // Count nodes in the cluster
            const nodes =
                await this.cacheManager.coordinationService.getAllNodes();
            this.metrics.nodeCount.set(Object.keys(nodes).length);

            logger.debug("Metrics collected successfully");
        } catch (error) {
            logger.error(`Error collecting metrics: ${error.message}`);
        }
    }

    /**
     * Record a cache operation
     * @param {string} operation - Operation type (get, set, delete)
     * @param {boolean} success - Whether the operation was successful
     */
    recordOperation(operation, success) {
        if (!this.initialized) {
            return;
        }

        const status = success ? "success" : "failure";
        this.metrics.cacheOperations.inc({
            operation,
            node_id: this.nodeId,
            status,
        });
    }

    /**
     * Record an operation error
     * @param {string} operation - Operation type (get, set, delete)
     * @param {string} errorType - Type of error that occurred
     */
    recordError(operation, errorType) {
        if (!this.initialized) {
            return;
        }

        this.metrics.operationErrors.inc({
            operation,
            node_id: this.nodeId,
            error_type: errorType || "unknown",
        });
    }

    /**
     * Record a cache hit or miss
     * @param {boolean} hit - Whether the operation was a hit
     */
    recordHitOrMiss(hit) {
        if (!this.initialized) {
            return;
        }

        if (hit) {
            this.metrics.cacheHits.inc({ node_id: this.nodeId });
        } else {
            this.metrics.cacheMisses.inc({ node_id: this.nodeId });
        }
    }

    /**
     * Record response time for an operation
     * @param {string} operation - Operation type
     * @param {number} timeInSeconds - Time taken in seconds
     */
    recordResponseTime(operation, timeInSeconds) {
        if (!this.initialized) {
            return;
        }

        this.metrics.responseTime.observe(
            { operation, node_id: this.nodeId },
            timeInSeconds
        );
    }

    /**
     * Get all metrics in Prometheus format
     * @returns {Promise<string>} - Metrics in Prometheus format
     */
    async getMetrics() {
        return this.register.metrics();
    }

    /**
     * Shutdown the monitoring system
     */
    async shutdown() {
        logger.info("Shutting down monitoring system");

        if (this.collectInterval) {
            clearInterval(this.collectInterval);
        }

        // Clear all metrics
        this.register.clear();

        logger.info("Monitoring system shutdown completed");
    }
}

module.exports = MonitoringSystem;
