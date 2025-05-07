# Distributed Redis Cache System

A distributed caching system that stores data across multiple Redis containers to ensure fast access and fault tolerance. This system reduces database load and improves overall application performance through efficient data caching techniques.

## Features

-   **Distributed Caching**: Multiple Redis nodes for distributed data storage
-   **Consistent Hashing**: Efficient data distribution across nodes
-   **Automatic Failover**: Node failure detection and recovery
-   **Data Replication**: Ensures data availability through replication
-   **Centralized Monitoring**: Prometheus-based metrics collection
-   **Coordination Service**: Uses ZooKeeper for service discovery and cluster management
-   **gRPC Communication**: Fast inter-node communication

## Prerequisites

-   Node.js (v14 or later)
-   Redis
-   ZooKeeper
-   Docker and Docker Compose (for multi-node deployment)

## Architecture

This diagram provides a high-level overview of the distributed cache system. It shows how clients interact with multiple cache service instances, each connected to its own Redis node. ZooKeeper is used for coordination, while Prometheus and Grafana handle monitoring and visualization.


![architecture](https://github.com/user-attachments/assets/e61516cf-ecf0-406e-85e7-89048b7f1b5b)


The system consists of the following components:

1. **Cache Nodes**: Multiple containerized Redis instances
2. **Coordination Service**: ZooKeeper for service discovery and cluster management
3. **Communication Layer**: gRPC for inter-node communication
4. **Monitoring System**: Prometheus for tracking performance metrics

## Distributed Coordination

The system uses ZooKeeper to solve critical distributed system challenges:

### Race Condition Prevention

-   **Node Registration**: Each cache node registers itself as an ephemeral ZooKeeper node, automatically removed on failure
-   **Distributed Locks**: Uses ZooKeeper's atomic operations to prevent race conditions during updates
-   **Watch Mechanisms**: Real-time node change notifications ensure consistent cluster state
-   **Polling Fallback**: Automatic fallback to polling if watching fails, ensuring robustness

### Consistency Model

-   **Eventual Consistency**: The system uses an eventual consistency model appropriate for caching
-   **Conflict Resolution**: Timestamp-based conflict resolution for simultaneous updates
-   **Replication Strategy**: Changes propagate to other nodes with retries and timeouts

## Architecture Diagrams

### 1. Cache Operation Sequence 


<img width="544" alt="Screenshot 2025-05-07 at 1 13 13 AM" src="https://github.com/user-attachments/assets/2fcfb1b0-87a0-47dc-b71a-98087e6d8db8" />


This sequence diagram illustrates the flow of a typical cache operation (set/get/delete). The client sends a request to the cache service, which may consult ZooKeeper for coordination, performs the operation on the appropriate Redis node, and returns the result to the client.

### 2. Metrics Flow 


<img width="542" alt="Screenshot 2025-05-07 at 1 33 12 AM" src="https://github.com/user-attachments/assets/6c7ac65b-d186-41d2-84c0-b6fe44316b86" />


This diagram shows how metrics are collected and visualized. The cache service exposes a metrics endpoint, which Prometheus scrapes. Grafana queries Prometheus to visualize these metrics for users.

### 3. Test Coverage 


<img width="814" alt="Screenshot 2025-05-07 at 1 55 26 AM" src="https://github.com/user-attachments/assets/a5b2af56-0c7c-4a64-bf1e-4b52cc2b6f2e" />


This diagram outlines the scope of the test suite. It covers basic cache operations, JSON value handling, TTL expiration, load testing, fault tolerance, multi-node consistency, and metrics exposure. Each test area is mapped to the relevant system component.

You can find the Mermaid source for these diagrams in the `diagrams/` directory.

## Grafana Visualization


<img width="1440" alt="Screenshot 2025-05-07 at 12 43 15 AM" src="https://github.com/user-attachments/assets/7a1164f9-99ba-495c-86dd-cc7869d3f44b" />


The Grafana dashboard provides real-time insights into the distributed cache system. It visualizes:

- **Operation Rates**: Track the rate of cache operations (get, set, delete) over time.
- **Success Rates**: Monitor the percentage of successful cache operations for each type.
- **Cache Hit Ratio**: See how often requested data is found in the cache versus missed.
- **Memory Usage**: Observe memory consumption for each cache node.
- **Node Count**: View the number of active nodes in the cluster.
- **Response Times**: Analyze the latency of cache operations.

These visualizations help users quickly assess the health, performance, and efficiency of the cache cluster, identify bottlenecks, and ensure high availability.

## Test Cases

The test suite for this project covers the following scenarios:

- **Basic Operations**: Verifies set, get, and delete functionality for cache keys.
- **JSON Values**: Ensures the cache can store and retrieve complex JSON objects.
- **TTL Expiration**: Tests that keys expire correctly after their time-to-live (TTL) elapses.
- **Load Testing**: Simulates high-volume operations to assess performance and stability.
- **Fault Tolerance**: Simulates node failures and checks that the system maintains availability and consistency.
- **Multi-Node Operations**: Validates data consistency and replication across multiple cache nodes.
- **Metrics**: Confirms that the `/metrics` endpoint exposes Prometheus-compatible metrics for all key operations.

## Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/redis-distributed-cache.git
cd redis-distributed-cache
```

2. Install the dependencies:

```bash
npm install
```

3. Configure the environment:

Create a `.env` file based on the provided example:

```bash
cp .env.example .env
```

Edit the `.env` file to match your environment settings.

## Running the Service

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm start
```

## Docker Deployment

To run a multi-node setup using Docker Compose:

```bash
# Build the Docker images first
docker-compose build

# Then start the services
docker-compose up -d
```

This will start multiple Redis nodes, ZooKeeper, and the cache service instances.

## Running Test Cases

To run all test cases and verify the system's functionality:

```bash
npm run test:all
```

This command will execute the complete test suite, covering basic operations, JSON handling, TTL expiration, load, fault tolerance, multi-node consistency, and metrics.

## API Usage

### Set a Cache Value

```bash
curl -X POST http://localhost:3000/cache \
  -H "Content-Type: application/json" \
  -d '{"key": "example-key", "value": "example-value", "ttl": 3600}'
```

### Get a Cache Value

```bash
curl http://localhost:3000/cache/example-key
```

### Delete a Cache Value

```bash
curl -X DELETE http://localhost:3000/cache/example-key
```

### View Metrics

```bash
curl http://localhost:3000/metrics
```

## Monitoring

The system exposes Prometheus metrics at the `/metrics` endpoint. You can configure Prometheus to scrape these metrics and visualize them using Grafana.


