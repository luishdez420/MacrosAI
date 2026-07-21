import { check, sleep } from "k6";

import {
  bearerHeaders,
  expectedStatuses,
  get,
  postJson,
  requiredEnvironment,
  safeErrorCode,
} from "./lib.js";

export const options = {
  scenarios: {
    bounded_invalid_inputs: {
      executor: "constant-vus",
      vus: Number(__ENV.LIVING_NUTRITION_LOAD_VUS || 2),
      duration: __ENV.LIVING_NUTRITION_LOAD_DURATION || "15s",
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
  const headers = bearerHeaders(token, {
    "Idempotency-Key": `k6-invalid-${__VU}-${__ITER}`,
  });
  const invalidImage = "not-valid-base64!";

  const camera = postJson(
    "/api/v1/meal-analysis/jobs",
    { imageBase64: invalidImage },
    { headers, responseCallback: expectedStatuses(400, 422) }
  );
  check(camera, {
    "invalid meal image is rejected before processing": (response) => response.status === 400 || response.status === 422,
    "invalid meal image does not expose its content": (response) => !response.body.includes(invalidImage),
  });

  const label = postJson(
    "/api/v1/foods/label-analysis",
    { imageBase64: invalidImage },
    {
      headers: bearerHeaders(token, { "Idempotency-Key": `k6-label-${__VU}-${__ITER}` }),
      responseCallback: expectedStatuses(400, 422),
    }
  );
  check(label, {
    "invalid label image is rejected before processing": (response) => response.status === 400 || response.status === 422,
    "invalid label image does not expose its content": (response) => !response.body.includes(invalidImage),
  });

  if (__ENV.LIVING_NUTRITION_LOAD_EXPECT_FIXTURE_OUTAGE === "true") {
    const outage = get(
      "/api/v1/foods/search?query=fixture%20provider%20outage&locale=en-US",
      {
        headers: bearerHeaders(token),
        responseCallback: expectedStatuses(503),
      }
    );
    check(outage, {
      "fixture provider outage returns a correlated service error": (response) =>
        response.status === 503 && safeErrorCode(response) === "nutrition_provider_unavailable",
    });
  }

  sleep(1);
}
