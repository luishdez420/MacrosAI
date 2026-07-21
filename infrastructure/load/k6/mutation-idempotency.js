import { check, sleep } from "k6";
import http from "k6/http";

import {
  apiUrl,
  bearerHeaders,
  fixtureMealPayload,
  isoDay,
  postJson,
  requiredEnvironment,
} from "./lib.js";

export const options = {
  scenarios: {
    idempotent_meal_writes: {
      executor: "constant-vus",
      vus: Number(__ENV.LIVING_NUTRITION_LOAD_VUS || 3),
      duration: __ENV.LIVING_NUTRITION_LOAD_DURATION || "20s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
  },
};

export function setup() {
  return { token: requiredEnvironment("LIVING_NUTRITION_LOAD_BEARER_TOKEN") };
}

export default function ({ token }) {
  const key = `k6-meal-${__VU}-${__ITER}`;
  const payload = fixtureMealPayload(`K6 idempotency meal ${key}`);
  const headers = bearerHeaders(token, { "Idempotency-Key": key });

  const created = postJson("/api/v1/meals", payload, { headers });
  const replayed = postJson("/api/v1/meals", payload, { headers });

  check(created, {
    "initial meal mutation succeeds": (response) => response.status === 201,
  });
  check(replayed, {
    "same key replay succeeds": (response) => response.status === 201,
    "same key returns the original meal": (response) => response.json("id") === created.json("id"),
  });

  const diary = getDiary(token);
  check(diary, {
    "diary remains readable after retried mutation": (response) => response.status === 200,
  });

  sleep(1);
}

function getDiary(token) {
  return http.get(`${apiUrl(`/api/v1/diary/${isoDay()}`)}`, {
    headers: bearerHeaders(token),
  });
}
