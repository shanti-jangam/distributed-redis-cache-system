const Redis = require("ioredis");
const ConsistentHashing = require("../utils/consistentHashing");
const logger = require("../utils/logger");

class CacheManager {
    constructor(coordinationService) {
        this.coordinationService = coordinationService;
        this.consistentHashing = new ConsistentHashing();
        this.nodeId = process.env.NODE_ID || "node1";
        this.replicaFactor = parseInt(process.env.REPLICA_FACTOR || "3", 10);
        this.redisClients = new Map();
        this.localRedis = null;
        this.communicationLayer = null;
    }

    /**
     * Set the communication layer reference
     * @param {Object} communicationLayer - Reference to the communication layer
     */
    setCommunicationLayer(communicationLayer) {
        this.communicationLayer = communicationLayer;
        logger.info("Communication layer reference set in cache manager");
    }

    /**
     * Initialize the cache manager
     */
    async initialize() {
        logger.info(`Initializing cache manager with node ID: ${this.nodeId}`);

        // Initialize local Redis client
        this.localRedis = new Redis({
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379", 10),
            password: process.env.REDIS_PASSWORD || "",
            keyPrefix: `${this.nodeId}:`,
        });

        // Subscribe to node updates
        await this.coordinationService.subscribeToNodeUpdates(
            this.handleNodeUpdates.bind(this)
        );

        // Register this node
        await this.coordinationService.registerNode(this.nodeId, {
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379", 10),
            grpcPort: parseInt(process.env.GRPC_PORT || "50051", 10),
        });

        // Get existing nodes and add them to the hash ring
        const nodes = await this.coordinationService.getAllNodes();
        for (const [nodeId, nodeInfo] of Object.entries(nodes)) {
            this.addNodeToRing(nodeId, nodeInfo);
        }

        logger.info("Cache manager initialized successfully");
    }

    /**
     * Handle node updates from the coordination service
     * @param {Object} update - Node update information
     */
    async handleNodeUpdates(update) {
        const { type, nodeId, nodeInfo } = update;

        if (type === "add") {
            logger.info(`Adding node ${nodeId} to the cache ring`);
            this.addNodeToRing(nodeId, nodeInfo);
        } else if (type === "remove") {
            logger.info(`Removing node ${nodeId} from the cache ring`);
            this.removeNodeFromRing(nodeId);
        }
    }

    /**
     * Add a node to the hash ring
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection information
     */
    addNodeToRing(nodeId, nodeInfo) {
        // Skip if this is the local node or already in the ring
        if (nodeId === this.nodeId || this.redisClients.has(nodeId)) {
            return;
        }

        // Create a Redis client for the node
        const client = new Redis({
            host: nodeInfo.host,
            port: nodeInfo.port,
            password: nodeInfo.password || "",
        });

        this.redisClients.set(nodeId, client);
        this.consistentHashing.addNode(nodeId);
    }

    /**
     * Remove a node from the hash ring
     * @param {string} nodeId - Node identifier
     */
    removeNodeFromRing(nodeId) {
        if (!this.redisClients.has(nodeId)) {
            return;
        }

        // Close the Redis client
        const client = this.redisClients.get(nodeId);
        client.quit();

        // Remove from our maps
        this.redisClients.delete(nodeId);
        this.consistentHashing.removeNode(nodeId);
    }

    /**
     * Get a value from the cache
     * @param {string} key - Cache key
     * @returns {Promise<any>} - Cached value or null
     */
    async get(key) {
        const targetNodes = this.consistentHashing.getReplicaNodes(
            key,
            this.replicaFactor
        );

        if (targetNodes.length === 0) {
            logger.warn(`No nodes available to retrieve key: ${key}`);
            return null;
        }

        let highestTimestamp = -1;
        let latestValue = null;

        // Try to get from each replica node and return the most recent value
        for (const nodeId of targetNodes) {
            try {
                let value;

                if (nodeId === this.nodeId) {
                    // Get from local Redis
                    value = await this.localRedis.get(key);
                } else {
                    // Get from remote Redis
                    const client = this.redisClients.get(nodeId);
                    if (!client) {
                        logger.warn(
                            `Redis client for node ${nodeId} not found`
                        );
                        continue;
                    }
                    value = await client.get(`${nodeId}:${key}`);
                }

                if (value !== null) {
                    // Try to parse JSON
                    try {
                        const parsed = JSON.parse(value);

                        // Check if this is a timestamped value
                        if (
                            parsed &&
                            typeof parsed.timestamp === "number" &&
                            "data" in parsed
                        ) {
                            // If this value is newer than what we've seen, keep it
                            if (parsed.timestamp > highestTimestamp) {
                                highestTimestamp = parsed.timestamp;
                                latestValue = parsed.data;
                                logger.debug(
                                    `Found newer value for ${key} on node ${nodeId} with timestamp ${parsed.timestamp}`
                                );
                            }
                        } else {
                            // Old format or non-timestamped value, use it if we don't have anything better
                            if (highestTimestamp === -1) {
                                latestValue = parsed;
                            }
                        }
                    } catch (e) {
                        // Not JSON, use it if we don't have anything better
                        if (highestTimestamp === -1) {
                            latestValue = value;
                        }
                    }
                }
            } catch (error) {
                logger.error(
                    `Error retrieving key ${key} from node ${nodeId}: ${error.message}`
                );
            }
        }

        return latestValue;
    }

    /**
     * Set a value in the cache
     * @param {string} key - Cache key
     * @param {any} value - Value to cache
     * @param {number} ttl - Time to live in seconds (optional)
     * @returns {Promise<boolean>} - Success status
     */
    async set(key, value, ttl) {
        const targetNodes = this.consistentHashing.getReplicaNodes(
            key,
            this.replicaFactor
        );

        if (targetNodes.length === 0) {
            logger.warn(`No nodes available to store key: ${key}`);
            return false;
        }

        // Add timestamp to value for conflict resolution
        const timestamp = Date.now();
        const wrappedValue = {
            timestamp,
            data: value,
        };

        // Convert wrapped value to string
        const stringValue = JSON.stringify(wrappedValue);

        // Store in all replica nodes determined by consistent hashing
        const promises = targetNodes.map(async (nodeId) => {
            try {
                if (nodeId === this.nodeId) {
                    // Store in local Redis
                    if (ttl) {
                        await this.localRedis.set(key, stringValue, "EX", ttl);
                    } else {
                        await this.localRedis.set(key, stringValue);
                    }
                } else {
                    // Store in remote Redis
                    const client = this.redisClients.get(nodeId);
                    if (!client) {
                        logger.warn(
                            `Redis client for node ${nodeId} not found`
                        );
                        return false;
                    }

                    if (ttl) {
                        await client.set(
                            `${nodeId}:${key}`,
                            stringValue,
                            "EX",
                            ttl
                        );
                    } else {
                        await client.set(`${nodeId}:${key}`, stringValue);
                    }
                }
                return true;
            } catch (error) {
                logger.error(
                    `Error storing key ${key} to node ${nodeId}: ${error.message}`
                );
                return false;
            }
        });

        // Wait for all direct Redis operations to complete
        await Promise.all(promises);

        // Immediately replicate to ALL nodes using the communication layer for maximum consistency
        // This ensures eventual synchronization across ALL nodes in the cluster
        try {
            if (this.communicationLayer) {
                // First replication attempt
                await this.communicationLayer.replicateData(
                    key,
                    stringValue,
                    ttl
                );
                logger.info(
                    `Replication initiated for key=${key} across all nodes with timestamp ${timestamp}`
                );

                // Add a second replication attempt after a short delay
                // This helps catch any nodes that might have missed the first attempt
                setTimeout(async () => {
                    try {
                        await this.communicationLayer.replicateData(
                            key,
                            stringValue,
                            ttl
                        );
                        logger.info(
                            `Secondary replication completed for key=${key} with timestamp ${timestamp}`
                        );
                    } catch (retryError) {
                        logger.warn(
                            `Secondary replication attempt failed: ${retryError.message}`
                        );
                    }
                }, 1000);
            }
            return true;
        } catch (error) {
            logger.error(
                `Error during cache replication for key=${key}: ${error.message}`
            );
            // Even if replication fails, we still return true if the direct Redis operations succeeded
            return true;
        }
    }

    /**
     * Delete a value from the cache
     * @param {string} key - Cache key
     * @returns {Promise<boolean>} - Success status
     */
    async delete(key) {
        // For delete operations, we want to be more aggressive to ensure consistency
        // Let's try to delete from all available nodes, not just the replica nodes
        let allNodes = [];

        try {
            // First, get all available nodes
            const nodes = await this.coordinationService.getAllNodes();
            allNodes = Object.keys(nodes);

            logger.info(
                `Deleting key ${key} from all ${allNodes.length} nodes for maximum consistency`
            );
        } catch (error) {
            logger.error(
                `Error getting all nodes for deletion: ${error.message}`
            );

            // Fall back to replica nodes if we can't get all nodes
            allNodes = this.consistentHashing.getReplicaNodes(
                key,
                this.replicaFactor
            );

            logger.warn(
                `Falling back to replica nodes (${allNodes.length}) for deletion of key ${key}`
            );
        }

        if (allNodes.length === 0) {
            logger.warn(`No nodes available to delete key: ${key}`);
            return false;
        }

        // Delete from all nodes
        const promises = allNodes.map(async (nodeId) => {
            try {
                if (nodeId === this.nodeId) {
                    // Delete from local Redis
                    await this.localRedis.del(key);
                    logger.info(
                        `Deleted key ${key} from local node ${this.nodeId}`
                    );
                } else {
                    // Delete from remote Redis
                    const client = this.redisClients.get(nodeId);
                    if (!client) {
                        logger.warn(
                            `Redis client for node ${nodeId} not found`
                        );
                        return false;
                    }
                    await client.del(`${nodeId}:${key}`);
                    logger.info(
                        `Deleted key ${key} from remote node ${nodeId}`
                    );
                }
                return true;
            } catch (error) {
                logger.error(
                    `Error deleting key ${key} from node ${nodeId}: ${error.message}`
                );
                return false;
            }
        });

        // Wait for all direct Redis operations to complete
        await Promise.all(promises);

        // Now invalidate the cache on ALL nodes using the communication layer
        // This ensures eventual synchronization across ALL nodes in the cluster
        try {
            if (this.communicationLayer) {
                // Use a more aggressive approach for deletions
                await this.communicationLayer.invalidateCache(key);

                // Wait a short time and try again to catch any nodes that might have missed it
                setTimeout(async () => {
                    try {
                        await this.communicationLayer.invalidateCache(key);
                        logger.info(
                            `Performed secondary invalidation for key=${key}`
                        );
                    } catch (retryError) {
                        logger.warn(
                            `Secondary invalidation attempt failed: ${retryError.message}`
                        );
                    }
                }, 2000);

                logger.info(
                    `Invalidation initiated for key=${key} across all nodes`
                );
            }
            return true;
        } catch (error) {
            logger.error(
                `Error during cache invalidation for key=${key}: ${error.message}`
            );
            // Even if invalidation fails, we still return true if the direct Redis operations succeeded
            return true;
        }
    }

    /**
     * Get cache stats for monitoring
     * @returns {Promise<Object>} - Cache statistics
     */
    async getStats() {
        try {
            const info = await this.localRedis.info();
            const dbSize = await this.localRedis.dbsize();

            // Parse Redis INFO command output
            const stats = {
                keys: dbSize,
                memory: {},
                connected_clients: 0,
                connections: {},
            };

            // Parse the INFO sections
            const sections = info.split("#");
            for (const section of sections) {
                const lines = section.split("\r\n");
                for (const line of lines) {
                    if (line.includes(":")) {
                        const [key, value] = line.split(":");

                        if (key === "used_memory_human") {
                            stats.memory.used = value;
                        } else if (key === "used_memory_peak_human") {
                            stats.memory.peak = value;
                        } else if (key === "connected_clients") {
                            stats.connected_clients = parseInt(value, 10);
                        } else if (key === "total_connections_received") {
                            stats.connections.total = parseInt(value, 10);
                        } else if (key === "rejected_connections") {
                            stats.connections.rejected = parseInt(value, 10);
                        }
                    }
                }
            }

            return stats;
        } catch (error) {
            logger.error(`Error getting cache stats: ${error.message}`);
            return {
                error: error.message,
            };
        }
    }

    /**
     * Shutdown the cache manager
     */
    async shutdown() {
        logger.info("Shutting down cache manager");

        // Unregister from coordination service
        await this.coordinationService.unregisterNode(this.nodeId);

        // Close all Redis connections
        if (this.localRedis) {
            await this.localRedis.quit();
        }

        for (const client of this.redisClients.values()) {
            await client.quit();
        }

        logger.info("Cache manager shutdown completed");
    }
}

module.exports = CacheManager;
