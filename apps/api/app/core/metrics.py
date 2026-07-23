"""Small, dependency-free Prometheus metrics for the API process.

Metrics intentionally contain only low-cardinality operational labels. They
must never include user identifiers, client addresses, bearer tokens, food
queries, image data, or exception messages.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from threading import Lock
from time import monotonic, time
from typing import Mapping

HTTP_DURATION_BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
LabelSet = tuple[tuple[str, str], ...]
METRIC_HELP = {
    "living_nutrition_http_requests_total": "Completed API requests by normalized route and status.",
    "living_nutrition_rate_limit_decisions_total": "Rate-limit decisions by policy and outcome.",
    "living_nutrition_dependency_healthy": "Dependency health from the latest readiness probe.",
    "living_nutrition_http_request_duration_seconds": "Completed API request duration.",
    "living_nutrition_nutrition_provider_requests_total": "Completed nutrition-provider operations.",
    "living_nutrition_nutrition_provider_request_duration_seconds": "Nutrition-provider operation duration.",
    "living_nutrition_nutrition_provider_circuit_state": "Nutrition-provider circuit state: closed=0, half_open=1, open=2.",
    "living_nutrition_food_cache_events_total": "Food-cache lookup, refresh, and fallback events.",
    "living_nutrition_audit_retention_events_total": "Audit-retention sweep outcomes without audit content.",
    "living_nutrition_audit_delivery_events_total": "Privacy-minimized audit delivery outcomes without audit content.",
    "living_nutrition_idempotency_retention_events_total": "Idempotency replay-record retention sweep outcomes without request content.",
    "living_nutrition_ai_quota_reconciliation_events_total": "AI quota reservation reconciliation outcomes without user or request content.",
    "living_nutrition_background_worker_healthy": "Required background-worker liveness from the latest readiness probe.",
}


def _labels(values: Mapping[str, object]) -> LabelSet:
    return tuple(sorted((name, str(value)) for name, value in values.items()))


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _render_labels(labels: LabelSet) -> str:
    if not labels:
        return ""
    return "{" + ",".join(f'{name}="{_escape_label(value)}"' for name, value in labels) + "}"


@dataclass
class _Histogram:
    buckets: dict[float, int]
    count: int = 0
    total: float = 0.0


class MetricsRegistry:
    """Process-local scrape registry.

    Prometheus is expected to scrape every replica. Aggregation belongs to the
    deployment's Prometheus-compatible collector, not application memory.
    """

    def __init__(self) -> None:
        self._lock = Lock()
        self._started_at = time()
        self._counters: defaultdict[tuple[str, LabelSet], int] = defaultdict(int)
        self._gauges: dict[tuple[str, LabelSet], float] = {}
        self._histograms: dict[tuple[str, LabelSet], _Histogram] = {}

    def increment(self, name: str, labels: Mapping[str, object] | None = None) -> None:
        with self._lock:
            self._counters[(name, _labels(labels or {}))] += 1

    def set_gauge(self, name: str, value: float, labels: Mapping[str, object] | None = None) -> None:
        with self._lock:
            self._gauges[(name, _labels(labels or {}))] = value

    def observe(
        self,
        name: str,
        value: float,
        labels: Mapping[str, object] | None = None,
        *,
        buckets: tuple[float, ...] = HTTP_DURATION_BUCKETS,
    ) -> None:
        label_set = _labels(labels or {})
        key = (name, label_set)
        with self._lock:
            histogram = self._histograms.get(key)
            if histogram is None:
                histogram = _Histogram(buckets={bucket: 0 for bucket in buckets})
                self._histograms[key] = histogram
            histogram.count += 1
            histogram.total += max(0.0, value)
            for bucket in buckets:
                if value <= bucket:
                    histogram.buckets[bucket] += 1

    def record_http_request(self, *, method: str, route: str, status_code: int, duration_seconds: float) -> None:
        labels = {"method": method.upper(), "route": route, "status": str(status_code)}
        self.increment("living_nutrition_http_requests_total", labels)
        self.observe("living_nutrition_http_request_duration_seconds", duration_seconds, labels)

    def record_rate_limit_decision(self, *, policy: str, outcome: str) -> None:
        self.increment(
            "living_nutrition_rate_limit_decisions_total",
            {"policy": policy, "outcome": outcome},
        )

    def record_nutrition_provider_request(
        self,
        *,
        provider: str,
        operation: str,
        outcome: str,
        duration_seconds: float,
    ) -> None:
        """Record a provider result without retaining food or user input."""
        labels = {"provider": provider, "operation": operation, "outcome": outcome}
        self.increment("living_nutrition_nutrition_provider_requests_total", labels)
        self.observe(
            "living_nutrition_nutrition_provider_request_duration_seconds",
            duration_seconds,
            labels,
        )

    def set_nutrition_provider_circuit_state(self, *, provider: str, state: str) -> None:
        state_values = {"closed": 0, "half_open": 1, "open": 2}
        self.set_gauge(
            "living_nutrition_nutrition_provider_circuit_state",
            state_values[state],
            {"provider": provider},
        )

    def record_food_cache_event(self, *, cache: str, operation: str, outcome: str) -> None:
        """Record a bounded cache outcome; never include a food ID, query, or barcode."""
        self.increment(
            "living_nutrition_food_cache_events_total",
            {"cache": cache, "operation": operation, "outcome": outcome},
        )

    def record_audit_retention_event(self, *, outcome: str) -> None:
        self.increment("living_nutrition_audit_retention_events_total", {"outcome": outcome})

    def record_audit_delivery_event(self, *, outcome: str) -> None:
        self.increment("living_nutrition_audit_delivery_events_total", {"outcome": outcome})

    def record_idempotency_retention_event(self, *, outcome: str) -> None:
        self.increment("living_nutrition_idempotency_retention_events_total", {"outcome": outcome})

    def record_ai_quota_reconciliation_event(self, *, outcome: str) -> None:
        self.increment("living_nutrition_ai_quota_reconciliation_events_total", {"outcome": outcome})

    def set_background_worker_health(self, *, worker: str, healthy: bool) -> None:
        self.set_gauge(
            "living_nutrition_background_worker_healthy",
            1 if healthy else 0,
            {"worker": worker},
        )

    def render_prometheus(self) -> str:
        with self._lock:
            counters = list(self._counters.items())
            gauges = list(self._gauges.items())
            histograms = list(self._histograms.items())
            started_at = self._started_at

        lines = [
            "# HELP living_nutrition_process_start_time_seconds Unix time when this API process started.",
            "# TYPE living_nutrition_process_start_time_seconds gauge",
            f"living_nutrition_process_start_time_seconds {started_at:.6f}",
        ]
        for name in sorted({metric_name for (metric_name, _labels), _value in counters}):
            lines.extend([f"# HELP {name} {METRIC_HELP.get(name, 'Living Nutrition counter.')}", f"# TYPE {name} counter"])
            for (counter_name, labels), value in sorted(counters):
                if counter_name == name:
                    lines.append(f"{counter_name}{_render_labels(labels)} {value}")

        if gauges:
            for name in sorted({metric_name for (metric_name, _labels), _value in gauges}):
                lines.extend([f"# HELP {name} {METRIC_HELP.get(name, 'Living Nutrition gauge.')}", f"# TYPE {name} gauge"])
                for (gauge_name, labels), value in sorted(gauges):
                    if gauge_name == name:
                        lines.append(f"{gauge_name}{_render_labels(labels)} {value:g}")

        if histograms:
            for name in sorted({metric_name for (metric_name, _labels), _value in histograms}):
                lines.extend([f"# HELP {name} {METRIC_HELP.get(name, 'Living Nutrition histogram.')}", f"# TYPE {name} histogram"])
                for (histogram_name, labels), histogram in sorted(histograms):
                    if histogram_name != name:
                        continue
                    for bucket, count in sorted(histogram.buckets.items()):
                        lines.append(
                            f'{histogram_name}_bucket{_render_labels(labels + (("le", f"{bucket:g}"),))} {count}'
                        )
                    lines.append(
                        f'{histogram_name}_bucket{_render_labels(labels + (("le", "+Inf"),))} {histogram.count}'
                    )
                    lines.append(f"{histogram_name}_count{_render_labels(labels)} {histogram.count}")
                    lines.append(f"{histogram_name}_sum{_render_labels(labels)} {histogram.total:.6f}")

        return "\n".join(lines) + "\n"

    def reset_for_tests(self) -> None:
        with self._lock:
            self._counters.clear()
            self._gauges.clear()
            self._histograms.clear()
            self._started_at = time()


metrics = MetricsRegistry()


def request_started_at() -> float:
    return monotonic()
