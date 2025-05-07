# Distributed Redis Cache Test Suite

This directory contains automated tests for the Distributed Redis Cache system. The tests are organized by scenario to help validate different aspects of the system.

## Test Structure

The tests are organized into the following categories:

-   **Basic Operations** (`basic/`): Tests basic set, get, and delete operations
-   **JSON Values** (`json/`): Tests handling of complex JSON objects
-   **TTL Expiration** (`ttl/`): Tests time-to-live expiration functionality
-   **Load Testing** (`load/`): Tests system behavior under high load
-   **Fault Tolerance** (`fault-tolerance/`): Tests system resilience when nodes fail
-   **Multi-Node Operations** (`multi-node/`): Tests cross-node operations and consistency
-   **Metrics** (`metrics/`): Tests Prometheus metrics collection and reporting

## Detailed Test Case Descriptions

### Basic Operations (basic/)

-   **Set/Get/Delete Operations**: Verifies core cache operations work correctly
    -   Sets a key-value pair and verifies it can be retrieved
    -   Updates an existing key and verifies the value is updated
    -   Deletes a key and verifies it's removed from the cache
    -   Tests handling of non-existent keys

### JSON Values (json/)

-   **Complex Object Storage**: Tests storage and retrieval of complex JSON objects
    -   Stores nested objects with multiple data types (strings, numbers, arrays, objects)
    -   Verifies objects maintain their structure when retrieved
    -   Tests objects with special characters and Unicode content
    -   Checks handling of large JSON objects

### TTL Expiration (ttl/)

-   **Time-to-Live Functionality**: Tests automatic expiration of cache entries
    -   Sets keys with different TTL values (short, medium, long)
    -   Verifies keys are accessible before expiration
    -   Verifies keys are automatically removed after TTL expires
    -   Tests updating TTL of existing keys

### Load Testing (load/)

-   **High-Volume Performance**: Tests system under heavy load conditions
    -   Creates many keys simultaneously with concurrent requests
    -   Performs mixed operations (set/get/delete) under load
    -   Measures operation latency under different load levels
    -   Tests system stability with sustained heavy traffic

### Fault Tolerance (fault-tolerance/)

-   **Node Failure Handling**: Tests system resilience during node failures
    -   Simulates a Redis node failure by stopping a container
    -   Verifies the system continues to function with remaining nodes
    -   Tests automatic redistribution of requests to available nodes
    -   Verifies data recovery and system stabilization when failed node returns

### Multi-Node Operations (multi-node/)

-   **Cross-Node Consistency**: Tests data consistency across multiple cache nodes
    -   Sets a value on one node and verifies it propagates to other nodes
    -   Updates values on different nodes and checks consistency
    -   Deletes values and verifies deletion propagates across the cluster
    -   Tests immediate consistency with ZooKeeper coordination
    -   Verifies proper handling of conflicting updates

### Metrics (metrics/)

-   **Prometheus Metrics Verification**: Tests metrics collection and reporting
    -   Verifies all required metrics are being exposed on the /metrics endpoint
    -   Tests accuracy of operation counters (get/set/delete)
    -   Verifies hit/miss ratio metrics correctly reflect cache activity
    -   Checks error tracking metrics
    -   Tests node discovery and cluster health metrics

## Prerequisites

Before running the tests, make sure:

1. All required Docker containers are running via `docker-compose up -d`
2. The system has had a few moments to initialize fully

## Running the Tests

### Run All Tests

To run all test suites:

```
npm run test:all
```

### Run Specific Test Categories

You can run specific test categories using these npm scripts:

```
npm run test:basic      # Basic operations
npm run test:json       # JSON value handling
npm run test:ttl        # TTL expiration
npm run test:load       # Load testing
npm run test:fault      # Fault tolerance
npm run test:multi      # Multi-node operations
npm run test:metrics    # Metrics collection
```

### Run Selected Test Suites

You can also filter which test suites to run by providing arguments to the test runner:

```
# Run only the basic and json test suites
node tests/run-all-tests.js basic json
```

## Test Customization

Several tests can be customized using environment variables:

-   **Load Testing**:

    -   `TEST_COUNT`: Number of keys to create (default: 100)
    -   `CONCURRENT_REQUESTS`: Number of concurrent requests (default: 10)

-   **All Tests**:
    -   `API_URL`: Base URL for the cache service (default: http://localhost:3000)
    -   `NODE1_URL`, `NODE2_URL`, `NODE3_URL`: URLs for specific cache service nodes

Example:

```
TEST_COUNT=1000 CONCURRENT_REQUESTS=20 npm run test:load
```

## Test Output

Each test provides detailed output about:

-   Test steps being executed
-   Success/failure of each step
-   Timing information for performance tests
-   Error details when failures occur

Tests will exit with code 0 on success and non-zero on failure, making them suitable for CI/CD pipelines.

## Notes on Fault Tolerance Testing

The fault tolerance tests will temporarily stop one of the Redis nodes. The test includes cleanup code to ensure the node is restarted even if the test fails, but if you notice the node is still down after a test failure, you may need to manually restart it:

```
docker-compose start redis-node2
```
