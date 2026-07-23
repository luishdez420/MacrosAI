import { check, sleep } from "k6";

import { apiUrl, bearerHeaders, get, isoDay, requiredEnvironment } from "./lib.js";

export const options = {
  scenarios: {
    catalog_and_diary_reads: {
      executor: "constant-vus",
      vus: Number(__ENV.LIVING_NUTRITION_LOAD_VUS || 5),
      duration: __ENV.LIVING_NUTRITION_LOAD_DURATION || "30s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  return { token: requiredEnvironment("LIVING_NUTRITION_LOAD_BEARER_TOKEN") };
}

export default function ({ token }) {
  const health = get("/health");
  check(health, {
    "health endpoint is available": (response) => response.status === 200,
  });

  const search = get("/api/v1/foods/search?query=banana&locale=en-US", {
    headers: bearerHeaders(token),
  });
  check(search, {
    "catalog search succeeds": (response) => response.status === 200,
    "catalog search returns a food list": (response) => Array.isArray(response.json("items")),
  });

  const foodId = encodeURIComponent(
    __ENV.LIVING_NUTRITION_LOAD_FOOD_ID || "usda:e2e-banana-raw"
  );
  const detail = get(`/api/v1/foods/${foodId}`, {
    headers: bearerHeaders(token),
  });
  check(detail, {
    "food detail succeeds": (response) => response.status === 200,
    "food detail includes per-100g nutrients": (response) =>
      Number.isFinite(response.json("nutrientsPer100g.caloriesKcal")),
  });

  const diary = get(`/api/v1/diary/${isoDay()}`, {
    headers: bearerHeaders(token),
  });
  check(diary, {
    "diary read succeeds": (response) => response.status === 200,
    "diary returns the requested day": (response) => response.json("date") === isoDay(),
  });

  sleep(1);
}
