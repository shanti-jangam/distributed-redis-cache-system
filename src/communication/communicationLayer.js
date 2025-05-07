const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

class CommunicationLayer {
    constructor(cacheManager) {
        this.cacheManager = cacheManager;
        this.server = null;
        this.clients = new Map();
        this.nodeId = process.env.NODE_ID || "node1";
        this.port = parseInt(process.env.GRPC_PORT || "50051", 10);

        // Explicitly set Docker environment
        process.env.IN_DOCKER = "true";
        process.env.DOCKER_ENV = "true";

        // Log environment detection
        logger.info("Running in Docker environment (forced setting)");
    }

    /**
     * Initialize the communication layer
     */
    async initialize() {
        logger.info("Initializing gRPC communication layer");

        // Create proto directory if it doesn't exist
        const protoDir = path.join(__dirname, "protos");
        if (!fs.existsSync(protoDir)) {
            fs.mkdirSync(protoDir, { recursive: true });
        }

        // Create proto file if it doesn't exist
        const protoPath = path.join(protoDir, "cache.proto");
        if (!fs.existsSync(protoPath)) {
            this.createProtoFile(protoPath);
        }

        // Load proto definition
        const packageDefinition = protoLoader.loadSync(protoPath, {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
        });

        this.protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

        // Start gRPC server
        await this.startServer();

        logger.info("gRPC communication layer initialized successfully");
        return true;
    }

    /**
     * Create the proto file for gRPC service definition
     * @param {string} filePath - Path to create the proto file
     */
    createProtoFile(filePath) {
        const protoContent = `syntax = "proto3";

package cache;

service CacheService {
  // Invalidate a cache entry
  rpc InvalidateCache(InvalidateRequest) returns (InvalidateResponse) {}
  
  // Replicate data to another node
  rpc ReplicateData(ReplicateRequest) returns (ReplicateResponse) {}
  
  // Health check
  rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse) {}
}

message InvalidateRequest {
  string key = 1;
  string originator_node_id = 2;
}

message InvalidateResponse {
  bool success = 1;
  string message = 2;
}

message ReplicateRequest {
  string key = 1;
  string value = 2;
  int32 ttl = 3;
  string originator_node_id = 4;
}

message ReplicateResponse {
  bool success = 1;
  string message = 2;
}

message HealthCheckRequest {
  string node_id = 1;
}

message HealthCheckResponse {
  bool status = 1;
  string message = 2;
}`;

        fs.writeFileSync(filePath, protoContent);
        logger.info(`Created proto file at ${filePath}`);
    }

    /**
     * Start the gRPC server
     */
    async startServer() {
        this.server = new grpc.Server();

        // Add service implementation
        this.server.addService(
            this.protoDescriptor.cache.CacheService.service,
            {
                invalidateCache: this.handleInvalidateCache.bind(this),
                replicateData: this.handleReplicateData.bind(this),
                healthCheck: this.handleHealthCheck.bind(this),
            }
        );

        // Start server
        return new Promise((resolve, reject) => {
            this.server.bindAsync(
                `0.0.0.0:${this.port}`,
                grpc.ServerCredentials.createInsecure(),
                (err) => {
                    if (err) {
                        logger.error(
                            `Failed to start gRPC server: ${err.message}`
                        );
                        reject(err);
                        return;
                    }

                    this.server.start();
                    logger.info(`gRPC server running on port ${this.port}`);
                    resolve(true);
                }
            );
        });
    }

    /**
     * Handle invalidate cache request
     * @param {Object} call - gRPC call object
     * @param {Function} callback - gRPC callback
     */
    async handleInvalidateCache(call, callback) {
        const { key, originator_node_id } = call.request;

        logger.info(
            `Received invalidate request for key ${key} from node ${originator_node_id}`
        );

        try {
            // Only delete from local Redis to avoid infinite recursion
            if (this.cacheManager.localRedis) {
                // We need to handle both prefixed and non-prefixed keys
                // First, try with current node's prefix
                const nodePrefix = `${this.nodeId}:`;

                // Try directly as received - for compatibility with older formats
                await this.cacheManager.localRedis.del(key);

                // Also try with our node prefix - since localRedis might use prefixes
                if (!key.startsWith(nodePrefix)) {
                    await this.cacheManager.localRedis.del(
                        `${nodePrefix}${key}`
                    );
                }

                logger.info(
                    `Successfully invalidated key ${key} on local node`
                );

                callback(null, {
                    success: true,
                    message: "Cache invalidated successfully",
                });
            } else {
                callback(null, {
                    success: false,
                    message: "Local Redis client not initialized",
                });
            }
        } catch (error) {
            logger.error(`Error invalidating cache: ${error.message}`);

            callback(null, {
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * Handle replicate data request
     * @param {Object} call - gRPC call object
     * @param {Function} callback - gRPC callback
     */
    async handleReplicateData(call, callback) {
        const { key, value, ttl, originator_node_id } = call.request;

        logger.info(
            `Received replicate request for key ${key} from node ${originator_node_id}`
        );

        try {
            // Store in local Redis
            if (this.cacheManager.localRedis) {
                // Make sure we prioritize successful replication
                try {
                    // Check if the incoming value has a timestamp (part of conflict resolution)
                    let incomingTimestamp = 0;
                    let parsedValue = value;

                    try {
                        const parsed = JSON.parse(value);
                        if (
                            parsed &&
                            typeof parsed.timestamp === "number" &&
                            "data" in parsed
                        ) {
                            incomingTimestamp = parsed.timestamp;
                            parsedValue = value; // Keep the entire wrapped object
                            logger.debug(
                                `Incoming value has timestamp: ${incomingTimestamp}`
                            );
                        }
                    } catch (parseError) {
                        // Not a JSON value, proceed with original value
                        logger.debug(
                            `Incoming value is not JSON, no timestamp available`
                        );
                    }

                    // Check if we already have this key with a timestamp
                    let shouldUpdate = true;
                    const existingValue =
                        await this.cacheManager.localRedis.get(key);

                    if (existingValue) {
                        try {
                            const existingParsed = JSON.parse(existingValue);
                            if (
                                existingParsed &&
                                typeof existingParsed.timestamp === "number"
                            ) {
                                const existingTimestamp =
                                    existingParsed.timestamp;

                                // Only update if incoming is newer
                                if (incomingTimestamp <= existingTimestamp) {
                                    logger.info(
                                        `Skipping replication for key ${key} - existing timestamp ${existingTimestamp} is newer than or equal to incoming ${incomingTimestamp}`
                                    );
                                    shouldUpdate = false;

                                    callback(null, {
                                        success: true,
                                        message:
                                            "Skipped replication due to older timestamp",
                                    });
                                    return;
                                } else {
                                    logger.info(
                                        `Accepting replication for key ${key} - incoming timestamp ${incomingTimestamp} is newer than existing ${existingTimestamp}`
                                    );
                                }
                            }
                        } catch (existingParseError) {
                            // Existing value is not JSON or doesn't have a timestamp
                            // We'll overwrite it with our timestamped value
                            logger.debug(
                                `Existing value doesn't have a timestamp, will update with timestamped value`
                            );
                        }
                    }

                    if (shouldUpdate) {
                        // Store the value with the key directly
                        if (ttl) {
                            await this.cacheManager.localRedis.set(
                                key,
                                parsedValue,
                                "EX",
                                ttl
                            );
                        } else {
                            await this.cacheManager.localRedis.set(
                                key,
                                parsedValue
                            );
                        }

                        logger.info(
                            `Successfully replicated key ${key} on local node with timestamped value`
                        );

                        callback(null, {
                            success: true,
                            message: "Data replicated successfully",
                        });
                    }
                } catch (innerError) {
                    logger.error(
                        `Inner error replicating data: ${innerError.message}`
                    );
                    callback(null, {
                        success: false,
                        message: innerError.message,
                    });
                }
            } else {
                callback(null, {
                    success: false,
                    message: "Local Redis client not initialized",
                });
            }
        } catch (error) {
            logger.error(`Error replicating data: ${error.message}`);

            callback(null, {
                success: false,
                message: error.message,
            });
        }
    }

    /**
     * Handle health check request
     * @param {Object} call - gRPC call object
     * @param {Function} callback - gRPC callback
     */
    handleHealthCheck(call, callback) {
        const { node_id } = call.request;

        logger.debug(`Received health check from node ${node_id}`);

        callback(null, {
            status: true,
            message: "Node is healthy",
        });
    }

    /**
     * Get or create gRPC client for a node
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @returns {Object} - gRPC client
     */
    getClient(nodeId, nodeInfo) {
        if (this.clients.has(nodeId)) {
            return this.clients.get(nodeId);
        }

        // Determine the proper gRPC port - docker services use standard port offsets
        let grpcPort;
        if (nodeInfo.grpcPort) {
            grpcPort = nodeInfo.grpcPort;
        } else {
            // Default port offset based on node number (e.g., node1=50051, node2=50052)
            const nodeNumber = nodeId.replace("node", "");
            grpcPort = 50050 + parseInt(nodeNumber, 10);
            logger.info(
                `Using derived gRPC port ${grpcPort} for node ${nodeId}`
            );
        }

        // Always use Docker service names in containerized environment
        // Docker service names follow the pattern "cache-service1", "cache-service2", etc.
        const nodeNumber = nodeId.replace("node", "");
        const serviceName = `cache-service${nodeNumber}`;

        logger.info(
            `Using Docker service name ${serviceName} for node ${nodeId}`
        );
        const address = `${serviceName}:${grpcPort}`;

        logger.info(`Creating gRPC client for ${nodeId} at address ${address}`);

        try {
            const client = new this.protoDescriptor.cache.CacheService(
                address,
                grpc.credentials.createInsecure(),
                {
                    "grpc.keepalive_time_ms": 10000,
                    "grpc.keepalive_timeout_ms": 5000,
                    "grpc.keepalive_permit_without_calls": 1,
                    "grpc.http2.max_pings_without_data": 0,
                    "grpc.http2.min_time_between_pings_ms": 10000,
                    "grpc.http2.min_ping_interval_without_data_ms": 5000,
                }
            );

            this.clients.set(nodeId, client);
            return client;
        } catch (error) {
            logger.error(
                `Error creating gRPC client for ${nodeId}: ${error.message}`
            );
            throw error;
        }
    }

    /**
     * Invalidate cache on other nodes
     * @param {string} key - Cache key to invalidate
     * @returns {Promise<boolean>} - Success status
     */
    async invalidateCache(key) {
        try {
            const nodes =
                await this.cacheManager.coordinationService.getAllNodes();
            const promises = [];
            const MAX_RETRIES = 3; // Increase max retries

            logger.info(
                `Invalidating cache for key=${key} on all nodes. Available nodes: ${Object.keys(
                    nodes
                ).join(", ")}`
            );

            if (Object.keys(nodes).length <= 1) {
                logger.warn(
                    `Only found ${
                        Object.keys(nodes).length
                    } nodes for invalidation: ${Object.keys(nodes)}`
                );
            }

            for (const [nodeId, nodeInfo] of Object.entries(nodes)) {
                // Skip local node
                if (nodeId === this.nodeId) {
                    logger.debug(
                        `Skipping local node ${nodeId} for invalidation`
                    );
                    continue;
                }

                logger.info(
                    `Adding node ${nodeId} to invalidation targets for key=${key}`
                );
                promises.push(
                    this.invalidateCacheOnNodeWithRetry(
                        nodeId,
                        nodeInfo,
                        key,
                        MAX_RETRIES
                    )
                );
            }

            if (promises.length === 0) {
                logger.warn(`No remote nodes found to invalidate key=${key}`);
                return true; // Successfully did nothing
            }

            // Wait for all promises to settle with timeout
            const INVALIDATION_TIMEOUT = 8000; // 8 seconds timeout
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    logger.warn(
                        `Invalidation timeout after ${INVALIDATION_TIMEOUT}ms for key=${key}`
                    );
                    resolve({ status: "timeout" });
                }, INVALIDATION_TIMEOUT);
            });

            // Race all promises against the timeout
            const results = await Promise.race([
                Promise.allSettled(promises),
                timeoutPromise,
            ]);

            if (results.status === "timeout") {
                logger.warn(`Invalidation timed out for key=${key}`);
                return true; // Consider it a success to avoid blocking operations
            }

            const successCount = results.filter(
                (result) =>
                    result.status === "fulfilled" && result.value === true
            ).length;

            logger.info(
                `Invalidation complete for key=${key}. Success on ${successCount}/${promises.length} nodes.`
            );

            // Return true if at least one invalidation succeeded or if we didn't need to invalidate any nodes
            return successCount > 0 || promises.length === 0;
        } catch (error) {
            logger.error(
                `Error in invalidateCache for key=${key}: ${error.message}`
            );
            return false;
        }
    }

    /**
     * Invalidate cache on a specific node with retry mechanism
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @param {string} key - Cache key to invalidate
     * @param {number} retriesLeft - Number of retries left
     * @returns {Promise<boolean>} - Success status
     */
    async invalidateCacheOnNodeWithRetry(nodeId, nodeInfo, key, retriesLeft) {
        try {
            const result = await this.invalidateCacheOnNode(
                nodeId,
                nodeInfo,
                key
            );
            if (result) {
                logger.info(
                    `Successfully invalidated key=${key} on node ${nodeId}`
                );
                return true;
            }

            // If failed and we have retries left, try again after delay
            if (retriesLeft > 0) {
                const delay = 500 * (4 - retriesLeft); // Progressive backoff: 500ms, 1000ms, 1500ms
                logger.info(
                    `Retrying invalidation to node ${nodeId} for key=${key}. Retries left: ${retriesLeft}, waiting ${delay}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, delay)); // Use variable delay
                return this.invalidateCacheOnNodeWithRetry(
                    nodeId,
                    nodeInfo,
                    key,
                    retriesLeft - 1
                );
            }

            logger.warn(
                `Failed to invalidate cache on node ${nodeId} for key=${key} after all retry attempts`
            );
            return false;
        } catch (error) {
            logger.error(
                `Error in invalidation retry to node ${nodeId}: ${error.message}`
            );

            // If we have retries left, try again
            if (retriesLeft > 0) {
                const delay = 500 * (4 - retriesLeft); // Progressive backoff
                logger.info(
                    `Retrying after error for node ${nodeId}. Retries left: ${retriesLeft}, waiting ${delay}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, delay)); // Use variable delay
                return this.invalidateCacheOnNodeWithRetry(
                    nodeId,
                    nodeInfo,
                    key,
                    retriesLeft - 1
                );
            }

            return false;
        }
    }

    /**
     * Invalidate cache on a specific node
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @param {string} key - Cache key to invalidate
     * @returns {Promise<boolean>} - Success status
     */
    invalidateCacheOnNode(nodeId, nodeInfo, key) {
        return new Promise((resolve) => {
            try {
                const client = this.getClient(nodeId, nodeInfo);

                client.invalidateCache(
                    {
                        key,
                        originator_node_id: this.nodeId,
                    },
                    (error, response) => {
                        if (error) {
                            logger.error(
                                `Error invalidating cache on node ${nodeId}: ${error.message}`
                            );
                            resolve(false);
                            return;
                        }

                        if (!response.success) {
                            logger.warn(
                                `Failed to invalidate cache on node ${nodeId}: ${response.message}`
                            );
                            resolve(false);
                            return;
                        }

                        logger.info(
                            `Cache invalidated on node ${nodeId} for key ${key}`
                        );
                        resolve(true);
                    }
                );
            } catch (error) {
                logger.error(
                    `Error connecting to node ${nodeId}: ${error.message}`
                );
                resolve(false);
            }
        });
    }

    /**
     * Replicate data to other nodes
     * @param {string} key - Cache key
     * @param {string} value - Value to replicate
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<boolean>} - Success status
     */
    async replicateData(key, value, ttl) {
        try {
            const nodes =
                await this.cacheManager.coordinationService.getAllNodes();
            const promises = [];
            const MAX_RETRIES = 3; // Increase max retries from 2 to 3

            logger.info(
                `Replicating data for key=${key} to all nodes. Available nodes: ${Object.keys(
                    nodes
                ).join(", ")}`
            );

            if (Object.keys(nodes).length <= 1) {
                logger.warn(
                    `Only found ${
                        Object.keys(nodes).length
                    } nodes for replication: ${Object.keys(nodes)}`
                );
            }

            for (const [nodeId, nodeInfo] of Object.entries(nodes)) {
                // Skip local node
                if (nodeId === this.nodeId) {
                    logger.debug(
                        `Skipping local node ${nodeId} for replication`
                    );
                    continue;
                }

                logger.info(
                    `Adding node ${nodeId} to replication targets for key=${key}`
                );

                // Use retry mechanism for each node
                promises.push(
                    this.replicateDataToNodeWithRetry(
                        nodeId,
                        nodeInfo,
                        key,
                        value,
                        ttl,
                        MAX_RETRIES
                    )
                );
            }

            if (promises.length === 0) {
                logger.warn(`No remote nodes found to replicate key=${key}`);
                return true; // Successfully did nothing
            }

            // Wait for all promises to settle with timeout
            const REPLICATION_TIMEOUT = 8000; // 8 seconds timeout
            const timeoutPromise = new Promise((resolve) => {
                setTimeout(() => {
                    logger.warn(
                        `Replication timeout after ${REPLICATION_TIMEOUT}ms for key=${key}`
                    );
                    resolve({ status: "timeout" });
                }, REPLICATION_TIMEOUT);
            });

            // Race all promises against the timeout
            const results = await Promise.race([
                Promise.allSettled(promises),
                timeoutPromise,
            ]);

            if (results.status === "timeout") {
                logger.warn(`Replication timed out for key=${key}`);
                return true; // Consider it a success to avoid blocking operations
            }

            const successCount = results.filter(
                (result) =>
                    result.status === "fulfilled" && result.value === true
            ).length;

            logger.info(
                `Replication complete for key=${key}. Success on ${successCount}/${promises.length} nodes.`
            );

            // Return true if at least one replication succeeded or if we didn't need to replicate to any nodes
            return successCount > 0 || promises.length === 0;
        } catch (error) {
            logger.error(
                `Error in replicateData for key=${key}: ${error.message}`
            );
            return false;
        }
    }

    /**
     * Replicate data to a specific node with retry mechanism
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @param {string} key - Cache key
     * @param {string} value - Value to replicate
     * @param {number} ttl - Time to live in seconds
     * @param {number} retriesLeft - Number of retries left
     * @returns {Promise<boolean>} - Success status
     */
    async replicateDataToNodeWithRetry(
        nodeId,
        nodeInfo,
        key,
        value,
        ttl,
        retriesLeft
    ) {
        try {
            const result = await this.replicateDataToNode(
                nodeId,
                nodeInfo,
                key,
                value,
                ttl
            );
            if (result) {
                logger.info(
                    `Successfully replicated key=${key} to node ${nodeId}`
                );
                return true;
            }

            // If failed and we have retries left, try again after delay
            if (retriesLeft > 0) {
                const delay = 500 * (4 - retriesLeft); // Progressive backoff: 500ms, 1000ms, 1500ms
                logger.info(
                    `Retrying replication to node ${nodeId} for key=${key}. Retries left: ${retriesLeft}, waiting ${delay}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, delay)); // Use variable delay
                return this.replicateDataToNodeWithRetry(
                    nodeId,
                    nodeInfo,
                    key,
                    value,
                    ttl,
                    retriesLeft - 1
                );
            }

            logger.warn(
                `Failed to replicate data to node ${nodeId} for key=${key} after all retry attempts`
            );
            return false;
        } catch (error) {
            logger.error(
                `Error in replication retry to node ${nodeId}: ${error.message}`
            );

            // If we have retries left, try again
            if (retriesLeft > 0) {
                const delay = 500 * (4 - retriesLeft); // Progressive backoff
                logger.info(
                    `Retrying after error for node ${nodeId}. Retries left: ${retriesLeft}, waiting ${delay}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, delay)); // Use variable delay
                return this.replicateDataToNodeWithRetry(
                    nodeId,
                    nodeInfo,
                    key,
                    value,
                    ttl,
                    retriesLeft - 1
                );
            }

            return false;
        }
    }

    /**
     * Replicate data to a specific node
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @param {string} key - Cache key
     * @param {string} value - Value to replicate
     * @param {number} ttl - Time to live in seconds
     * @returns {Promise<boolean>} - Success status
     */
    replicateDataToNode(nodeId, nodeInfo, key, value, ttl) {
        return new Promise((resolve) => {
            try {
                const client = this.getClient(nodeId, nodeInfo);

                client.replicateData(
                    {
                        key,
                        value,
                        ttl: ttl || 0,
                        originator_node_id: this.nodeId,
                    },
                    (error, response) => {
                        if (error) {
                            logger.error(
                                `Error replicating data to node ${nodeId}: ${error.message}`
                            );
                            resolve(false);
                            return;
                        }

                        if (!response.success) {
                            logger.warn(
                                `Failed to replicate data to node ${nodeId}: ${response.message}`
                            );
                            resolve(false);
                            return;
                        }

                        logger.info(
                            `Data replicated to node ${nodeId} for key ${key}`
                        );
                        resolve(true);
                    }
                );
            } catch (error) {
                logger.error(
                    `Error connecting to node ${nodeId}: ${error.message}`
                );
                resolve(false);
            }
        });
    }

    /**
     * Check if a node is healthy
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node connection info
     * @returns {Promise<boolean>} - Health status
     */
    async checkNodeHealth(nodeId, nodeInfo) {
        return new Promise((resolve) => {
            try {
                const client = this.getClient(nodeId, nodeInfo);

                client.healthCheck(
                    {
                        node_id: this.nodeId,
                    },
                    (error, response) => {
                        if (error) {
                            logger.warn(
                                `Node ${nodeId} health check failed: ${error.message}`
                            );
                            resolve(false);
                            return;
                        }

                        if (!response.status) {
                            logger.warn(
                                `Node ${nodeId} reported unhealthy status: ${response.message}`
                            );
                            resolve(false);
                            return;
                        }

                        logger.debug(`Node ${nodeId} is healthy`);
                        resolve(true);
                    }
                );
            } catch (error) {
                logger.warn(
                    `Error connecting to node ${nodeId}: ${error.message}`
                );
                resolve(false);
            }
        });
    }

    /**
     * Shutdown the communication layer
     */
    async shutdown() {
        logger.info("Shutting down communication layer");

        // Close all gRPC clients
        this.clients.clear();

        // Stop gRPC server
        if (this.server) {
            return new Promise((resolve) => {
                this.server.tryShutdown(() => {
                    logger.info("gRPC server shut down");
                    resolve();
                });
            });
        }

        return Promise.resolve();
    }
}

module.exports = CommunicationLayer;
