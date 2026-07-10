import type {
  AuthSessionList,
  CustomFoodCreate,
  DiaryDay,
  FoodCorrectionReport,
  FoodCorrectionReportCreate,
  FoodCorrectionReportList,
  FoodDetail,
  FoodSearchResponse,
  FoodSearchResult,
  LocalAuthRequest,
  MealAnalysisResult,
  MealCreate,
  MealRead,
  MealUpdate,
  MonthlyInsights,
  NutritionLabelAnalysis,
  NutritionGoal,
  NutritionGoalUpdate,
  UserPreference,
  UserPreferenceUpdate,
  UserDataExport,
  UserSession,
  WeightEntry,
  WeightEntryCreate,
  WeeklyInsights,
} from "@living-nutrition/shared-types";

type ApiClientOptions = {
  baseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  refreshAuthToken?: () => Promise<string | undefined>;
};

type HealthResponse = {
  ok: boolean;
};

export function createApiClient({ baseUrl, getAuthToken, refreshAuthToken }: ApiClientOptions) {
  async function request<T>(
    path: string,
    init?: RequestInit,
    canRefresh = true
  ): Promise<T> {
    const token = await getAuthToken?.();
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      throw new Error(
        `Cannot reach the nutrition API at ${baseUrl}. Make sure the API server is running and your phone is on the same Wi-Fi as this Mac.`
      );
    }

    if (
      response.status === 401 &&
      canRefresh &&
      refreshAuthToken &&
      !path.startsWith("/auth/")
    ) {
      const refreshedToken = await refreshAuthToken();
      if (refreshedToken) {
        return request<T>(path, init, false);
      }
    }

    if (!response.ok) {
      const body = await response.json().catch(() => undefined);
      throw new Error(formatApiError(body) || `Request failed with HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  return {
    healthCheck() {
      return request<HealthResponse>("/health");
    },
    register(input: LocalAuthRequest) {
      return request<UserSession>("/auth/register", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    login(input: LocalAuthRequest) {
      return request<UserSession>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getSession() {
      return request<UserSession>("/auth/session");
    },
    listAuthSessions() {
      return request<AuthSessionList>("/auth/sessions");
    },
    revokeAuthSession(sessionId: string) {
      return request<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    },
    refreshSession(refreshToken: string) {
      return request<UserSession>("/auth/refresh", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    },
    logout(refreshToken: string) {
      return request<void>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    },
    exportUserData() {
      return request<UserDataExport>("/export");
    },
    deleteAccount() {
      return request<void>("/account", {
        method: "DELETE",
      });
    },
    getGoal() {
      return request<NutritionGoal | null>("/goals");
    },
    updateGoal(input: NutritionGoalUpdate) {
      return request<NutritionGoal>("/goals", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    getPreferences() {
      return request<UserPreference>("/preferences");
    },
    updatePreferences(input: UserPreferenceUpdate) {
      return request<UserPreference>("/preferences", {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    listWeightEntries(limit = 30) {
      const search = new URLSearchParams({ limit: String(limit) });
      return request<WeightEntry[]>(`/weight?${search.toString()}`);
    },
    saveWeightEntry(input: WeightEntryCreate) {
      return request<WeightEntry>("/weight", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    deleteWeightEntry(loggedOn: string) {
      return request<void>(`/weight/${encodeURIComponent(loggedOn)}`, {
        method: "DELETE",
      });
    },
    searchFoods(query: string, locale = "en-US") {
      const search = new URLSearchParams({ query, locale });
      return request<FoodSearchResponse>(`/foods/search?${search.toString()}`);
    },
    getRecentFoods(limit = 8) {
      const search = new URLSearchParams({ limit: String(limit) });
      return request<FoodSearchResponse>(`/foods/recent?${search.toString()}`);
    },
    removeRecentFood(foodId: string) {
      return request<void>(`/foods/recent/${encodeURIComponent(foodId)}`, {
        method: "DELETE",
      });
    },
    getFavoriteFoods(limit = 20) {
      const search = new URLSearchParams({ limit: String(limit) });
      return request<FoodSearchResponse>(`/foods/favorites?${search.toString()}`);
    },
    addFavoriteFood(foodId: string) {
      return request<FoodSearchResult>(`/foods/favorites/${encodeURIComponent(foodId)}`, {
        method: "PUT",
      });
    },
    removeFavoriteFood(foodId: string) {
      return request<void>(`/foods/favorites/${encodeURIComponent(foodId)}`, {
        method: "DELETE",
      });
    },
    getFood(foodId: string) {
      return request<FoodDetail>(`/foods/${encodeURIComponent(foodId)}`);
    },
    createFoodCorrectionReport(foodId: string, input: FoodCorrectionReportCreate) {
      return request<FoodCorrectionReport>(
        `/foods/${encodeURIComponent(foodId)}/correction-reports`,
        {
          method: "POST",
          body: JSON.stringify(input),
        }
      );
    },
    getCorrectionReports(limit = 10) {
      const search = new URLSearchParams({ limit: String(limit) });
      return request<FoodCorrectionReportList>(`/correction-reports?${search.toString()}`);
    },
    getFoodByBarcode(barcode: string) {
      return request<FoodSearchResponse>(`/foods/barcode/${encodeURIComponent(barcode)}`);
    },
    getCustomFoods(limit = 50) {
      const search = new URLSearchParams({ limit: String(limit) });
      return request<FoodSearchResponse>(`/foods/custom?${search.toString()}`);
    },
    createCustomFood(input: CustomFoodCreate) {
      return request<FoodDetail>("/foods/custom", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateCustomFood(foodId: string, input: CustomFoodCreate) {
      return request<FoodDetail>(`/foods/custom/${encodeURIComponent(foodId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    analyzeNutritionLabel(input: { imageBase64: string; barcode?: string }) {
      return request<NutritionLabelAnalysis>("/foods/label-analysis", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    createMeal(input: MealCreate) {
      return request<MealRead>("/meals", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    listMeals(date?: string) {
      const query = date ? `?${new URLSearchParams({ date }).toString()}` : "";
      return request<MealRead[]>(`/meals${query}`);
    },
    getMeal(mealId: string) {
      return request<MealRead>(`/meals/${encodeURIComponent(mealId)}`);
    },
    updateMeal(mealId: string, input: MealUpdate) {
      return request<MealRead>(`/meals/${encodeURIComponent(mealId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    deleteMeal(mealId: string) {
      return request<void>(`/meals/${encodeURIComponent(mealId)}`, {
        method: "DELETE",
      });
    },
    getDiary(date: string) {
      return request<DiaryDay>(`/diary/${encodeURIComponent(date)}`);
    },
    getWeeklyInsights(startDate?: string) {
      const query = startDate ? `?${new URLSearchParams({ startDate }).toString()}` : "";
      return request<WeeklyInsights>(`/insights/weekly${query}`);
    },
    getMonthlyInsights(month?: string) {
      const query = month ? `?${new URLSearchParams({ month }).toString()}` : "";
      return request<MonthlyInsights>(`/insights/monthly${query}`);
    },
    analyzeMealPhoto(input: { imageBase64: string; idempotencyKey?: string }) {
      return request<MealAnalysisResult>("/meal-analysis", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}

function formatApiError(body: unknown) {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const errorBody = body as { detail?: unknown; error?: unknown; message?: unknown };
  const envelope = errorBody.error;
  const typedEnvelope =
    envelope && typeof envelope === "object"
      ? (envelope as { code?: unknown; message?: unknown; requestId?: unknown })
      : undefined;
  const value = typedEnvelope?.message || errorBody.message || errorBody.error || errorBody.detail;
  const suffix =
    typedEnvelope?.code || typedEnvelope?.requestId
      ? ` (${[typedEnvelope.code, typedEnvelope.requestId].filter(Boolean).join(" · ")})`
      : "";

  if (typeof value === "string") {
    return `${value}${suffix}`;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }

        return JSON.stringify(item);
      })
      .join(" ") + suffix;
  }

  return value ? `${JSON.stringify(value)}${suffix}` : undefined;
}
