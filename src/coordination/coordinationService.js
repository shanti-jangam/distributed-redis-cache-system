const zookeeper = require("node-zookeeper-client");
const logger = require("../utils/logger");

class CoordinationService {
    constructor() {
        this.client = null;
        this.nodeWatchers = new Map();
        this.nodeCallbacks = [];
        this.basePath = "/redis-cache/nodes";
        this.ephemeralNodePath = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000; // 1 second, will increase exponentially
        this.nodePollingInterval = null;
        this.lastKnownNodes = {};
        this.sessionTimeout = 30000; // 30 seconds
        this.connected = false;
    }

    /**
     * Initialize the coordination service
     */
    async initialize() {
        logger.info("Initializing coordination service");

        try {
            const zookeeperHosts =
                process.env.ZOOKEEPER_HOSTS || "localhost:2181";

            logger.info(`Connecting to ZooKeeper hosts: ${zookeeperHosts}`);

            // Create ZooKeeper client
            this.client = zookeeper.createClient(zookeeperHosts, {
                sessionTimeout: this.sessionTimeout,
                spinDelay: 1000,
                retries: 3,
            });

            // Setup event listeners
            this.client.on("connected", () => {
                logger.info("Connected to ZooKeeper");
                this.connected = true;
                this.reconnectAttempts = 0;
            });

            this.client.on("disconnected", () => {
                logger.warn("Disconnected from ZooKeeper");
                this.connected = false;
                this.reconnect();
            });

            this.client.on("expired", () => {
                logger.warn("ZooKeeper session expired");
                this.connected = false;
                this.reconnect();
            });

            this.client.on("authenticationFailed", () => {
                logger.error("ZooKeeper authentication failed");
            });

            // Connect to ZooKeeper
            return new Promise((resolve, reject) => {
                this.client.once("connected", async () => {
                    try {
                        // Create base path if it doesn't exist
                        await this._ensureBasePath();

                        // Watch for node changes
                        this.watchNodes();

                        resolve(true);
                    } catch (error) {
                        logger.error(
                            `Failed to initialize ZooKeeper paths: ${error.message}`
                        );

                        // Fall back to polling
                        this._startNodePolling();

                        // Still resolve as true since we can use polling
                        resolve(true);
                    }
                });

                this.client.once("error", (error) => {
                    logger.error(
                        `Failed to connect to ZooKeeper: ${error.message}`
                    );

                    // Fall back to polling
                    this._startNodePolling();

                    // Resolve with polling as fallback
                    resolve(true);
                });

                this.client.connect();
            });
        } catch (error) {
            logger.error(
                `Failed to initialize coordination service: ${error.message}`
            );
            // Fall back to polling
            this._startNodePolling();

            // Return true since we have a fallback mechanism
            return true;
        }
    }

    /**
     * Ensure base path exists
     * @private
     */
    _ensureBasePath() {
        return new Promise((resolve, reject) => {
            // First check if the root exists
            this.client.exists("/", (error, stat) => {
                if (error) {
                    logger.error(`Error checking root path: ${error.message}`);
                    reject(error);
                    return;
                }

                // Split the path and create each segment
                const paths = this.basePath.split("/").filter((p) => p);
                let currentPath = "";

                const createNextPath = (index) => {
                    if (index >= paths.length) {
                        resolve();
                        return;
                    }

                    currentPath += "/" + paths[index];

                    this.client.exists(currentPath, (existsError, stat) => {
                        if (existsError) {
                            logger.error(
                                `Error checking path: ${currentPath}: ${existsError.message}`
                            );
                            reject(existsError);
                            return;
                        }

                        if (stat) {
                            // Path exists, create next level
                            createNextPath(index + 1);
                        } else {
                            // Create path
                            this.client.create(
                                currentPath,
                                null,
                                (createError) => {
                                    if (
                                        createError &&
                                        createError.code !==
                                            zookeeper.Exception.NODE_EXISTS
                                    ) {
                                        logger.error(
                                            `Error creating path ${currentPath}: ${createError.message}`
                                        );
                                        reject(createError);
                                        return;
                                    }

                                    logger.info(
                                        `Created ZooKeeper path: ${currentPath}`
                                    );

                                    // Continue with next path
                                    createNextPath(index + 1);
                                }
                            );
                        }
                    });
                };

                createNextPath(0);
            });
        });
    }

    /**
     * Reconnect to ZooKeeper if connection is lost
     */
    async reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error("Maximum reconnect attempts reached, giving up");
            return false;
        }

        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        this.reconnectAttempts++;

        logger.info(
            `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`
        );

        return new Promise((resolve) => {
            setTimeout(() => {
                try {
                    if (this.client) {
                        this.client.close();
                    }

                    const zookeeperHosts =
                        process.env.ZOOKEEPER_HOSTS || "localhost:2181";
                    this.client = zookeeper.createClient(zookeeperHosts, {
                        sessionTimeout: this.sessionTimeout,
                        spinDelay: 1000,
                        retries: 3,
                    });

                    this.client.on("connected", () => {
                        logger.info("Reconnected to ZooKeeper");
                        this.connected = true;
                        this.reconnectAttempts = 0;
                        this._ensureBasePath();

                        // Rewatch nodes
                        this.watchNodes();
                        resolve(true);
                    });

                    this.client.on("disconnected", () => {
                        logger.warn("Disconnected from ZooKeeper");
                        this.connected = false;
                        this.reconnect();
                    });

                    this.client.connect();
                } catch (error) {
                    logger.error(`Failed to reconnect: ${error.message}`);

                    // Try again recursively after delay
                    setTimeout(() => {
                        resolve(this.reconnect());
                    }, this.reconnectDelay);
                }
            }, delay);
        });
    }

    /**
     * Register a node in the coordination service
     * @param {string} nodeId - Node identifier
     * @param {Object} nodeInfo - Node information (host, port, etc.)
     * @returns {Promise<boolean>} - Success status
     */
    async registerNode(nodeId, nodeInfo) {
        return new Promise((resolve, reject) => {
            try {
                const nodePath = `${this.basePath}/${nodeId}`;
                const nodeData = Buffer.from(JSON.stringify(nodeInfo));

                // Store path for later cleanup
                this.ephemeralNodePath = nodePath;

                // Create an ephemeral node
                this.client.create(
                    nodePath,
                    nodeData,
                    zookeeper.CreateMode.EPHEMERAL,
                    (error) => {
                        if (error) {
                            // If node already exists, try to delete it first
                            if (
                                error.code === zookeeper.Exception.NODE_EXISTS
                            ) {
                                this.client.remove(nodePath, (removeError) => {
                                    if (removeError) {
                                        logger.error(
                                            `Failed to remove existing node ${nodeId}: ${removeError.message}`
                                        );
                                        reject(removeError);
                                        return;
                                    }

                                    // Now try to create it again
                                    this.client.create(
                                        nodePath,
                                        nodeData,
                                        zookeeper.CreateMode.EPHEMERAL,
                                        (createError) => {
                                            if (createError) {
                                                logger.error(
                                                    `Failed to register node ${nodeId}: ${createError.message}`
                                                );
                                                reject(createError);
                                                return;
                                            }

                                            logger.info(
                                                `Node ${nodeId} registered successfully`
                                            );
                                            resolve(true);
                                        }
                                    );
                                });
                            } else {
                                logger.error(
                                    `Failed to register node ${nodeId}: ${error.message}`
                                );
                                reject(error);
                            }
                            return;
                        }

                        logger.info(`Node ${nodeId} registered successfully`);
                        resolve(true);
                    }
                );
            } catch (error) {
                logger.error(
                    `Failed to register node ${nodeId}: ${error.message}`
                );
                reject(error);
            }
        });
    }

    /**
     * Unregister a node from the coordination service
     * @param {string} nodeId - Node identifier
     * @returns {Promise<boolean>} - Success status
     */
    async unregisterNode(nodeId) {
        return new Promise((resolve) => {
            try {
                const nodePath = `${this.basePath}/${nodeId}`;

                this.client.remove(nodePath, (error) => {
                    if (error) {
                        logger.error(
                            `Failed to unregister node ${nodeId}: ${error.message}`
                        );
                        resolve(false);
                        return;
                    }

                    logger.info(`Node ${nodeId} unregistered successfully`);
                    resolve(true);
                });
            } catch (error) {
                logger.error(
                    `Failed to unregister node ${nodeId}: ${error.message}`
                );
                resolve(false);
            }
        });
    }

    /**
     * Get all registered nodes
     * @returns {Promise<Object>} - Map of nodeId to nodeInfo
     */
    async getAllNodes() {
        return new Promise((resolve) => {
            try {
                this.client.getChildren(this.basePath, (error, children) => {
                    if (error) {
                        logger.error(
                            `Failed to get all nodes: ${error.message}`
                        );
                        resolve({});
                        return;
                    }

                    if (!children || children.length === 0) {
                        resolve({});
                        return;
                    }

                    const nodes = {};
                    let completed = 0;

                    // Get data for each child node
                    children.forEach((nodeId) => {
                        const nodePath = `${this.basePath}/${nodeId}`;

                        this.client.getData(nodePath, (dataError, data) => {
                            completed++;

                            if (!dataError && data) {
                                try {
                                    const nodeInfo = JSON.parse(
                                        data.toString()
                                    );
                                    nodes[nodeId] = nodeInfo;
                                } catch (parseError) {
                                    logger.error(
                                        `Error parsing node data for ${nodeId}: ${parseError.message}`
                                    );
                                }
                            }

                            if (completed === children.length) {
                                resolve(nodes);
                            }
                        });
                    });
                });
            } catch (error) {
                logger.error(`Failed to get all nodes: ${error.message}`);
                resolve({});
            }
        });
    }

    /**
     * Watch for node changes and notify subscribers
     */
    watchNodes() {
        try {
            // Setup watcher function for child changes
            const watcher = (event) => {
                logger.info(`ZooKeeper event: ${event.type} - ${event.path}`);

                if (event.type === zookeeper.Event.NODE_CHILDREN_CHANGED) {
                    // Get updated list of nodes when children change
                    this._processNodeChanges();
                }

                // Re-register the watcher
                this.client.getChildren(
                    this.basePath,
                    watcher,
                    () => {} // Empty callback
                );
            };

            // Initial watch setup
            this.client.getChildren(
                this.basePath,
                watcher,
                (error, children) => {
                    if (error) {
                        logger.error(
                            `Error setting up node watcher: ${error.message}`
                        );
                        // Fall back to polling
                        this._startNodePolling();
                        return;
                    }

                    // Process initial node list
                    this._processNodeChanges();
                }
            );

            return true;
        } catch (error) {
            logger.error(`Failed to watch nodes: ${error.message}`);
            // Fall back to polling for node changes
            this._startNodePolling();
            return false;
        }
    }

    /**
     * Process changes to nodes and notify subscribers
     * @private
     */
    async _processNodeChanges() {
        try {
            const currentNodes = await this.getAllNodes();
            const lastNodes = this.lastKnownNodes || {};

            // Check for added or updated nodes
            for (const [nodeId, nodeInfo] of Object.entries(currentNodes)) {
                const lastNodeInfo = lastNodes[nodeId];

                // Node is new or has changed
                if (
                    !lastNodeInfo ||
                    JSON.stringify(lastNodeInfo) !== JSON.stringify(nodeInfo)
                ) {
                    logger.info(`Node added/updated: ${nodeId}`);

                    // Notify callbacks
                    for (const callback of this.nodeCallbacks) {
                        try {
                            callback({
                                type: "add",
                                nodeId,
                                nodeInfo,
                            });
                        } catch (callbackError) {
                            logger.error(
                                `Error in node update callback: ${callbackError.message}`
                            );
                        }
                    }
                }
            }

            // Check for removed nodes
            for (const [nodeId] of Object.entries(lastNodes)) {
                if (!currentNodes[nodeId]) {
                    logger.info(`Node removed: ${nodeId}`);

                    // Notify callbacks
                    for (const callback of this.nodeCallbacks) {
                        try {
                            callback({
                                type: "remove",
                                nodeId,
                            });
                        } catch (callbackError) {
                            logger.error(
                                `Error in node remove callback: ${callbackError.message}`
                            );
                        }
                    }
                }
            }

            // Update last known state
            this.lastKnownNodes = currentNodes;
        } catch (error) {
            logger.error(`Error processing node changes: ${error.message}`);
        }
    }

    /**
     * Start polling for node changes as a fallback
     * @private
     */
    _startNodePolling() {
        // Clear any existing polling interval
        if (this.nodePollingInterval) {
            clearInterval(this.nodePollingInterval);
        }

        // Store the last known node state
        this.lastKnownNodes = {};

        // Poll every 2 seconds instead of 5 seconds to improve consistency
        const POLLING_INTERVAL = 2000;

        // Set up polling
        this.nodePollingInterval = setInterval(async () => {
            try {
                // Get all nodes
                const currentNodes = await this.getAllNodes();

                // Compare with last known state
                const lastNodes = this.lastKnownNodes || {};

                // Check for added or updated nodes
                for (const [nodeId, nodeInfo] of Object.entries(currentNodes)) {
                    const lastNodeInfo = lastNodes[nodeId];

                    // Node is new or has changed
                    if (
                        !lastNodeInfo ||
                        JSON.stringify(lastNodeInfo) !==
                            JSON.stringify(nodeInfo)
                    ) {
                        logger.info(`Node added/updated (polling): ${nodeId}`);

                        // Notify callbacks
                        for (const callback of this.nodeCallbacks) {
                            try {
                                callback({
                                    type: "add",
                                    nodeId,
                                    nodeInfo,
                                });
                            } catch (callbackError) {
                                logger.error(
                                    `Error in node update callback (polling): ${callbackError.message}`
                                );
                            }
                        }
                    }
                }

                // Check for removed nodes
                for (const [nodeId] of Object.entries(lastNodes)) {
                    if (!currentNodes[nodeId]) {
                        logger.info(`Node removed (polling): ${nodeId}`);

                        // Notify callbacks
                        for (const callback of this.nodeCallbacks) {
                            try {
                                callback({
                                    type: "remove",
                                    nodeId,
                                });
                            } catch (callbackError) {
                                logger.error(
                                    `Error in node remove callback (polling): ${callbackError.message}`
                                );
                            }
                        }
                    }
                }

                // Update last known state
                this.lastKnownNodes = currentNodes;
            } catch (error) {
                logger.error(`Error during node polling: ${error.message}`);
            }
        }, POLLING_INTERVAL);

        logger.info(
            `Node polling started with interval of ${POLLING_INTERVAL}ms`
        );
    }

    /**
     * Subscribe to node updates
     * @param {Function} callback - Function to call when nodes change
     */
    async subscribeToNodeUpdates(callback) {
        this.nodeCallbacks.push(callback);
        logger.info("Subscribed to node updates");
        return true;
    }

    /**
     * Unsubscribe from node updates
     * @param {Function} callback - Function to unsubscribe
     */
    async unsubscribeFromNodeUpdates(callback) {
        const index = this.nodeCallbacks.indexOf(callback);
        if (index !== -1) {
            this.nodeCallbacks.splice(index, 1);
            logger.info("Unsubscribed from node updates");
            return true;
        }
        return false;
    }

    /**
     * Shutdown the coordination service
     */
    async shutdown() {
        logger.info("Shutting down coordination service");

        // Clear polling interval if it exists
        if (this.nodePollingInterval) {
            clearInterval(this.nodePollingInterval);
            this.nodePollingInterval = null;
            logger.info("Node polling stopped");
        }

        // Clear all callbacks
        this.nodeCallbacks = [];

        // Close ZooKeeper client
        try {
            if (this.client) {
                // If we registered an ephemeral node, it will be automatically
                // removed when the session is closed

                try {
                    this.client.close();
                    logger.info("ZooKeeper client closed");
                } catch (clientError) {
                    logger.error(
                        `Error closing ZooKeeper client: ${clientError.message}`
                    );
                }
                this.client = null;
            }
        } catch (error) {
            logger.error(
                `Error during ZooKeeper client shutdown: ${error.message}`
            );
        }

        logger.info("Coordination service shutdown completed");
    }
}

module.exports = CoordinationService;
