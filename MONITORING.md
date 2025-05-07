# Prometheus Query Guide for Redis Cache Monitoring

This guide covers the essential Prometheus queries to monitor your distributed Redis cache effectively, along with step-by-step instructions for setting up visualizations.

## Basic PromQL Concepts

-   **Instant Vector**: Single sample for each time series at a specific time (`redis_cache_size_keys`)
-   **Range Vector**: Range of samples over time (`redis_cache_size_keys[5m]`)
-   **Functions**: Aggregate data (`rate()`, `sum()`, `avg()`)
-   **Selectors**: Filter metrics (`{job="redis_cache", node_id="node1"}`)

## Essential Queries

### Cache Operations

```promql
# Total operations by type (set, get, delete)
sum(redis_cache_operations_total) by (operation)

# Operation rate (per second over 5min window)
sum(rate(redis_cache_operations_total[5m])) by (operation)

# Success rate percentage
sum(redis_cache_operations_total{status="success"}) by (operation) / sum(redis_cache_operations_total) by (operation) * 100
```

### Error Tracking

```promql
# Total errors by type
sum(redis_cache_operations_errors_total) by (error_type)

# Error rate per second
rate(redis_cache_operations_errors_total[5m])

# Error percentage by operation
sum(redis_cache_operations_total{status="failure"}) by (operation) / sum(redis_cache_operations_total) by (operation) * 100
```

### Cache Performance

```promql
# Average operation duration
sum(rate(redis_cache_op_duration_seconds_sum[5m])) by (operation) / sum(rate(redis_cache_op_duration_seconds_count[5m])) by (operation)

# 95th percentile duration for set operations
histogram_quantile(0.95, sum(rate(redis_cache_op_duration_seconds_bucket{operation="set"}[5m])) by (le))

# Cache hit ratio
sum(rate(redis_cache_hits_total[5m])) / (sum(rate(redis_cache_hits_total[5m])) + sum(rate(redis_cache_misses_total[5m])))
```

### Resource Usage

```promql
# Number of keys per node
redis_cache_size_keys

# Memory usage per node
redis_cache_memory_bytes

# Compare memory usage between nodes
topk(3, sort(sum(redis_cache_memory_bytes) by (node_id)))
```

### Cluster Health

```promql
# Total nodes in the cluster
redis_cache_nodes_total

# Node count change over time
delta(redis_cache_nodes_total[1h])
```

## Advanced Queries

### Operational Insights

```promql
# Busiest node by operation count
topk(1, sum(rate(redis_cache_operations_total[5m])) by (node_id))

# Most error-prone operation
topk(1, sum(rate(redis_cache_operations_errors_total[5m])) by (operation))

# Slowest operations (95th percentile)
sort_desc(histogram_quantile(0.95, sum(rate(redis_cache_op_duration_seconds_bucket[5m])) by (operation, le)))
```

### Alerting Considerations

```promql
# High error rate (>5%)
sum(rate(redis_cache_operations_total{status="failure"}[5m])) / sum(rate(redis_cache_operations_total[5m])) > 0.05

# Slow operation response time (>100ms avg)
sum(rate(redis_cache_op_duration_seconds_sum[5m])) by (operation) / sum(rate(redis_cache_op_duration_seconds_count[5m])) by (operation) > 0.1

# Low hit ratio (<50%)
sum(rate(redis_cache_hits_total[5m])) / (sum(rate(redis_cache_hits_total[5m])) + sum(rate(redis_cache_misses_total[5m]))) < 0.5

# Node count decrease
delta(redis_cache_nodes_total[15m]) < 0
```

## Step-by-Step Setup Guide

### 1. Accessing Prometheus UI

1. Start your Docker environment if not running:

    ```bash
    docker-compose up -d
    ```

2. Access the Prometheus UI:

    ```
    http://localhost:9090
    ```

3. Navigate to the "Graph" tab for visualization

### 2. Creating Basic Prometheus Graphs

#### Creating Your First Graph

1. Go to Prometheus UI (http://localhost:9090)
2. Click on the "Graph" tab
3. In the expression field, enter:
    ```
    sum(rate(redis_cache_operations_total[5m])) by (operation)
    ```
4. Click "Execute"
5. Switch to the "Graph" view to see the visualization
6. Adjust the time range using the dropdown (e.g., "Last 1h")
7. For advanced settings, click on "Add graph at cursor" (stacked view)

#### Saving and Exporting Queries

1. After creating a useful graph, click on the gear icon (⚙️)
2. Use "Share" to get a direct link to the graph
3. Use "Export" to save the graph as an image or data

### 3. Setting Up Grafana (Recommended)

#### Initial Grafana Setup

1. Access Grafana at:

    ```
    http://localhost:3100
    ```

2. Log in with default credentials:
    - Username: `admin`
    - Password: `admin`
    - Set a new password when prompted

#### Adding Prometheus Data Source

1. Go to Configuration (gear icon) → Data Sources
2. Click "Add data source"
3. Select "Prometheus"
4. Configure the data source:
    - Name: `Redis Cache Prometheus`
    - URL: `http://prometheus:9090` (use Docker service name)
    - Access: `Server (default)`
5. Click "Save & Test" - you should see "Data source is working"

### 4. Creating a Comprehensive Grafana Dashboard

#### Dashboard Setup

1. Click "+ Create" → "Dashboard"
2. Click "Add new panel"
3. In the "Query" tab, make sure Prometheus is selected as the data source
4. Create your first panel with the query:
    ```
    sum(rate(redis_cache_operations_total[5m])) by (operation)
    ```
5. Set visualization type to "Time series"
6. In the right panel, add:
    - Panel Title: "Cache Operations Rate"
    - Description: "Number of operations per second by type"
7. Click "Apply" to add the panel to your dashboard

#### Building a Complete Dashboard

Create the following panels (click "Add panel" for each new panel):

1. **Operations Rate Panel**

    - Query: `sum(rate(redis_cache_operations_total[5m])) by (operation)`
    - Visualization: Time series
    - Settings: Enable stacking, legend to the right

2. **Success Rate Panel**

    - Query: `sum(redis_cache_operations_total{status="success"}) by (operation) / sum(redis_cache_operations_total) by (operation) * 100`
    - Visualization: Gauge
    - Settings: Set min to 0, max to 100, thresholds at 50 (red), 80 (yellow), 95 (green)

3. **Error Rate Panel**

    - Query: `sum(rate(redis_cache_operations_errors_total[5m])) by (error_type)`
    - Visualization: Time series
    - Settings: Use a red color palette

4. **Cache Hit Ratio Panel**

    - Query: `sum(rate(redis_cache_hits_total[5m])) / (sum(rate(redis_cache_hits_total[5m])) + sum(rate(redis_cache_misses_total[5m])))`
    - Visualization: Gauge
    - Settings: Set min to 0, max to 1, thresholds at 0.5 (red), 0.7 (yellow), 0.9 (green)

5. **Response Time Panel**

    - Query: `sum(rate(redis_cache_op_duration_seconds_sum[5m])) by (operation) / sum(rate(redis_cache_op_duration_seconds_count[5m])) by (operation)`
    - Visualization: Time series
    - Settings: Set unit to "seconds", Y-axis min to 0

6. **Node Count Panel**

    - Query: `redis_cache_nodes_total`
    - Visualization: Stat
    - Settings: Show sparkline, color mode "value"

7. **Memory Usage Panel**

    - Query: `redis_cache_memory_bytes`
    - Visualization: Time series
    - Settings: Set unit to "bytes", legend to show min/max

8. **Keys Per Node Panel**
    - Query: `redis_cache_size_keys`
    - Visualization: Bar gauge
    - Settings: Set orientation to horizontal

### 5. Organizing the Dashboard

1. Click the gear icon at the top of the dashboard to access dashboard settings
2. Add a title like "Redis Cache Monitoring"
3. Add a description
4. Set time options (auto-refresh every 10s recommended)
5. Save the dashboard (click the save icon)

#### Adding Rows to Group Panels

1. Hover between panels and click "Add panel"
2. Select "Add a new row"
3. Name each row by section:
    - "Operations & Performance"
    - "Error Tracking"
    - "Cluster Health"
    - "Resource Usage"
4. Drag and drop panels to appropriate rows

### 6. Setting Up Alerts

1. For any panel, click "Edit"
2. Go to the "Alert" tab
3. Click "Create alert rule from this panel"
4. Configure alert rules for critical metrics:
    - High error rates (>5%)
    - Slow operation times (>100ms)
    - Low hit ratios (<50%)
    - Node count decreases

### 7. Testing Your Monitoring Setup

Run the following commands to generate traffic and observe dashboard changes:

```bash
# Generate 100 SET operations
for i in {1..100}; do curl -X POST -H "Content-Type: application/json" -d '{"key":"load-test-$i","value":"test"}' http://localhost:3000/cache; done

# Generate GET operations
for i in {1..100}; do curl http://localhost:3000/cache/load-test-$i; done

# Generate DELETE operations
for i in {1..20}; do curl -X DELETE http://localhost:3000/cache/load-test-$i; done

# Generate errors (non-existent keys)
for i in {1..10}; do curl http://localhost:3000/cache/nonexistent-$i; done
```

Watch your dashboards update in real-time!

## Example Dashboards

### Operation Dashboard

1. **Operation Rate Panel**:

    - Query: `sum(rate(redis_cache_operations_total[5m])) by (operation)`
    - Visualization: Graph
    - Description: Shows the rate of each operation type over time

2. **Success Rate Panel**:
    - Query: `sum(redis_cache_operations_total{status="success"}) by (operation) / sum(redis_cache_operations_total) by (operation) * 100`
    - Visualization: Gauge
    - Description: Displays success percentage for each operation

### Performance Dashboard

1. **Average Duration Panel**:

    - Query: `sum(rate(redis_cache_op_duration_seconds_sum[5m])) by (operation) / sum(rate(redis_cache_op_duration_seconds_count[5m])) by (operation)`
    - Visualization: Graph
    - Description: Shows average operation duration

2. **Cache Hit Ratio Panel**:
    - Query: `sum(rate(redis_cache_hits_total[5m])) / (sum(rate(redis_cache_hits_total[5m])) + sum(rate(redis_cache_misses_total[5m])))`
    - Visualization: Gauge
    - Description: Displays percentage of cache hits

### Resource Dashboard

1. **Cache Size Panel**:

    - Query: `redis_cache_size_keys`
    - Visualization: Graph
    - Description: Shows number of keys in each cache node

2. **Memory Usage Panel**:
    - Query: `redis_cache_memory_bytes`
    - Visualization: Graph
    - Description: Displays memory usage of each cache node

### Error Dashboard

1. **Error Rate Panel**:

    - Query: `sum(rate(redis_cache_operations_errors_total[5m])) by (error_type)`
    - Visualization: Graph
    - Description: Shows rate of different error types

2. **Most Common Errors Panel**:
    - Query: `topk(5, sum(redis_cache_operations_errors_total) by (error_type))`
    - Visualization: Table
    - Description: Lists the top 5 error types by count
