const crypto = require("crypto");

class ConsistentHashing {
    constructor(replicas = 100) {
        this.nodes = new Map();
        this.keys = [];
        this.replicas = replicas;
    }

    /**
     * Add a node to the hash ring
     * @param {string} nodeId - The node identifier
     */
    addNode(nodeId) {
        for (let i = 0; i < this.replicas; i++) {
            const hash = this._getHash(`${nodeId}:${i}`);
            this.nodes.set(hash, nodeId);
            this.keys.push(hash);
        }

        // Sort the keys
        this.keys.sort((a, b) => a - b);
        return true;
    }

    /**
     * Remove a node from the hash ring
     * @param {string} nodeId - The node identifier
     */
    removeNode(nodeId) {
        for (let i = 0; i < this.replicas; i++) {
            const hash = this._getHash(`${nodeId}:${i}`);
            this.nodes.delete(hash);

            const index = this.keys.indexOf(hash);
            if (index !== -1) {
                this.keys.splice(index, 1);
            }
        }
        return true;
    }

    /**
     * Get the node for a specific key
     * @param {string} key - The cache key
     * @returns {string|null} - The node ID or null if no nodes available
     */
    getNode(key) {
        if (this.keys.length === 0) {
            return null;
        }

        const hash = this._getHash(key);

        // Find the first node with a hash greater than or equal to our key hash
        for (let i = 0; i < this.keys.length; i++) {
            if (this.keys[i] >= hash) {
                return this.nodes.get(this.keys[i]);
            }
        }

        // If we reach here, it means the hash is greater than all node hashes
        // So we need to wrap around to the first node
        return this.nodes.get(this.keys[0]);
    }

    /**
     * Get all nodes that should contain this key (for replication)
     * @param {string} key - The cache key
     * @param {number} replicaCount - Number of replicas to return
     * @returns {Array<string>} - Array of node IDs
     */
    getReplicaNodes(key, replicaCount = 2) {
        if (this.nodes.size === 0) {
            return [];
        }

        // Ensure we don't try to get more replicas than available nodes
        const actualReplicaCount = Math.min(replicaCount, this.nodes.size);
        const hash = this._getHash(key);
        const nodes = new Set();

        // Find the first node
        let startIndex = 0;
        for (let i = 0; i < this.keys.length; i++) {
            if (this.keys[i] >= hash) {
                startIndex = i;
                break;
            }
        }

        // Collect the required number of unique nodes
        let currentIndex = startIndex;
        while (nodes.size < actualReplicaCount) {
            nodes.add(this.nodes.get(this.keys[currentIndex]));
            currentIndex = (currentIndex + 1) % this.keys.length;

            // Avoid infinite loop if we don't have enough unique nodes
            if (currentIndex === startIndex) {
                break;
            }
        }

        return Array.from(nodes);
    }

    /**
     * Get all nodes in the hash ring
     * @returns {Set<string>} - Set of node IDs
     */
    getAllNodes() {
        return new Set(this.nodes.values());
    }

    /**
     * Calculate the hash of a key
     * @private
     * @param {string} key - The key to hash
     * @returns {number} - The hash value
     */
    _getHash(key) {
        return parseInt(
            crypto.createHash("md5").update(key).digest("hex").substring(0, 8),
            16
        );
    }
}

module.exports = ConsistentHashing;
