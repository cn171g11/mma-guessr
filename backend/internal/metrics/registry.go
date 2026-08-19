package metrics

import (
	"fmt"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// HTTPDurationBuckets matches the previous backend's histogram boundaries.
var HTTPDurationBuckets = []float64{0.01, 0.05, 0.1, 0.5, 1, 2.5, 10}

// Registry is an in-memory Prometheus text-format store mirroring the
// previous backend's metric names and label shapes.
type Registry struct {
	mu              sync.Mutex
	startedAt       time.Time
	version         string
	counters        map[string]int64 // key: "method route status"
	durationBuckets map[string][]int64
	durationCounts  map[string]int64
	durationSumMS   float64
	durationTotal   int64
}

// NewRegistry creates a registry with the given histogram bucket boundaries.
func NewRegistry(version string, buckets []float64) *Registry {
	if len(buckets) == 0 {
		buckets = HTTPDurationBuckets
	}
	return &Registry{
		startedAt:       time.Now(),
		version:         version,
		counters:        make(map[string]int64),
		durationBuckets: make(map[string][]int64),
		durationCounts:  make(map[string]int64),
	}
}

// RecordRequest counts one request and observes its duration.
func (r *Registry) RecordRequest(method, route string, status int, durationMs float64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	countKey := method + " " + route + " " + strconv.Itoa(status)
	r.counters[countKey]++

	histKey := method + " " + route
	r.durationCounts[histKey]++
	r.durationSumMS += durationMs
	r.durationTotal++

	buckets := r.durationBuckets[histKey]
	if buckets == nil {
		buckets = make([]int64, len(HTTPDurationBuckets))
	}
	seconds := durationMs / 1000
	for i, threshold := range HTTPDurationBuckets {
		if seconds <= threshold {
			buckets[i]++
		}
	}
	r.durationBuckets[histKey] = buckets
}

func escapeLabelValue(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	return strings.ReplaceAll(value, "\n", `\n`)
}

// Render produces the Prometheus text exposition format (version 0.0.4).
func (r *Registry) Render(poolTotal, poolIdle, poolWaiting int64) string {
	r.mu.Lock()
	defer r.mu.Unlock()

	var sb strings.Builder
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	sb.WriteString("# HELP process_uptime_seconds 进程运行时长（秒）\n")
	sb.WriteString("# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(&sb, "process_uptime_seconds %.0f\n", time.Since(r.startedAt).Seconds())

	sb.WriteString("# HELP process_memory_heap_bytes 进程堆内存（字节）\n")
	sb.WriteString("# TYPE process_memory_heap_bytes gauge\n")
	fmt.Fprintf(&sb, "process_memory_heap_bytes %d\n", mem.HeapAlloc)

	sb.WriteString("# HELP pg_pool_total PostgreSQL 连接池总连接数\n")
	sb.WriteString("# TYPE pg_pool_total gauge\n")
	fmt.Fprintf(&sb, "pg_pool_total %d\n", poolTotal)
	sb.WriteString("# HELP pg_pool_idle PostgreSQL 连接池空闲连接数\n")
	sb.WriteString("# TYPE pg_pool_idle gauge\n")
	fmt.Fprintf(&sb, "pg_pool_idle %d\n", poolIdle)
	sb.WriteString("# HELP pg_pool_waiting PostgreSQL 连接池等待连接数\n")
	sb.WriteString("# TYPE pg_pool_waiting gauge\n")
	fmt.Fprintf(&sb, "pg_pool_waiting %d\n", poolWaiting)

	sb.WriteString("# HELP backend_info 后端版本信息\n")
	sb.WriteString("# TYPE backend_info gauge\n")
	fmt.Fprintf(&sb, "backend_info{version=%q} 1\n", r.version)

	sb.WriteString("# HELP http_requests_total 处理的 HTTP 请求总数（按方法/路由/状态码）\n")
	sb.WriteString("# TYPE http_requests_total counter\n")
	countKeys := make([]string, 0, len(r.counters))
	for key := range r.counters {
		countKeys = append(countKeys, key)
	}
	sort.Strings(countKeys)
	for _, key := range countKeys {
		parts := strings.SplitN(key, " ", 3)
		method, route, status := parts[0], parts[1], parts[2]
		fmt.Fprintf(&sb, "http_requests_total{method=%q,route=%q,status=%q} %d\n",
			escapeLabelValue(method), escapeLabelValue(route), status, r.counters[key])
	}

	sb.WriteString("# HELP http_request_duration_seconds HTTP 请求耗时分布（秒）\n")
	sb.WriteString("# TYPE http_request_duration_seconds histogram\n")
	histKeys := make([]string, 0, len(r.durationBuckets))
	for key := range r.durationBuckets {
		histKeys = append(histKeys, key)
	}
	sort.Strings(histKeys)
	for _, key := range histKeys {
		parts := strings.SplitN(key, " ", 2)
		method, route := parts[0], parts[1]
		labelPrefix := fmt.Sprintf("method=%q,route=%q", escapeLabelValue(method), escapeLabelValue(route))
		for i, count := range r.durationBuckets[key] {
			fmt.Fprintf(&sb, "http_request_duration_seconds_bucket{%s,le=%q} %d\n",
				labelPrefix, fmt.Sprint(HTTPDurationBuckets[i]), count)
		}
		fmt.Fprintf(&sb, "http_request_duration_seconds_bucket{%s,le=%q} %d\n",
			labelPrefix, "+Inf", r.durationCounts[key])
	}
	fmt.Fprintf(&sb, "http_request_duration_seconds_sum %.6f\n", r.durationSumMS/1000)
	fmt.Fprintf(&sb, "http_request_duration_seconds_count %d\n", r.durationTotal)

	return sb.String()
}
