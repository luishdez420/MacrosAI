import http from "k6/http";

export function apiBaseUrl() {
  return (__ENV.LIVING_NUTRITION_LOAD_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
}

export function apiUrl(path) {
  return `${apiBaseUrl()}${path}`;
}

export function requiredEnvironment(name) {
  const value = __ENV[name];
  if (!value) {
    throw new Error(`${name} is required for this load scenario.`);
  }
  return value;
}

export function bearerHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function get(path, params = {}) {
  return http.get(apiUrl(path), params);
}

export function postJson(path, payload, params = {}) {
  return http.post(apiUrl(path), JSON.stringify(payload), {
    ...params,
    headers: {
      "Content-Type": "application/json",
      ...(params.headers || {}),
    },
  });
}

export function requestId(response) {
  return response.headers["X-Request-Id"] || response.headers["x-request-id"] || "";
}

export function safeErrorCode(response) {
  try {
    return response.json("error.code") || "";
  } catch (_) {
    return "";
  }
}

export function expectedStatuses(...statuses) {
  return http.expectedStatuses(...statuses);
}

export function isoDay(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export function fixtureMealPayload(name) {
  return {
    name,
    mealType: "snack",
    loggedAt: new Date().toISOString(),
    notes: "Disposable k6 load-test meal.",
    items: [
      {
        foodId: __ENV.LIVING_NUTRITION_LOAD_FOOD_ID || "usda:e2e-banana-raw",
        displayName: "Banana, raw",
        consumedGrams: 118,
        servingQuantity: 1,
        servingUnit: "medium banana",
        calories: 105.02,
        proteinGrams: 1.2862,
        carbohydrateGrams: 26.9512,
        fatGrams: 0.3894,
        fiberGrams: 3.068,
        sugarGrams: 14.4314,
        sodiumMilligrams: 1.18,
        sourceProvider: "usda",
        sourceExternalId: "e2e-banana-raw",
        sourceVersion: null,
        sourceReference: "https://fdc.nal.usda.gov/",
        nutrientSnapshotJson: {
          fixture: true,
          nutrientsPer100g: {
            caloriesKcal: 89,
            proteinGrams: 1.09,
            carbohydrateGrams: 22.84,
            fatGrams: 0.33,
          },
        },
        confidence: {
          identity: "verified",
          portion: "verified",
          nutritionRecord: "verified",
          explanation: "Deterministic load-test fixture.",
        },
        userConfirmed: true,
        preparationMethod: null,
        addedOilGrams: 0,
        notes: null,
      },
    ],
  };
}
