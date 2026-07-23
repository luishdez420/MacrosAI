import type {
  AiUsageSummary,
  AuthSessionList,
  ClerkProfileProvision,
  CustomFoodCreate,
  DiaryDay,
  FoodCorrectionReport,
  FoodCorrectionReportCreate,
  FoodCorrectionReportList,
  FoodDetail,
  FoodSearchResponse,
  FoodSearchResult,
  FavoriteFoodTagsUpdate,
  HydrationEntry,
  HydrationEntryUpdate,
  LocalAuthRequest,
  LocalAccountMigration,
  PasswordChange,
  MealAnalysisResult,
  MealAnalysisJob,
  MealCreate,
  MealImageAccess,
  MealRead,
  MealUpdate,
  MonthlyInsights,
  RangeInsights,
  NutritionLabelAnalysis,
  NutritionGoal,
  NutritionGoalUpdate,
  RecipeCreate,
  RecipeFolderCreate,
  RecipeFolderRead,
  RecipeFolderUpdate,
  RecipeLogResult,
  RecipeRead,
  RecipeTagsUpdate,
  RecipeUpdate,
  SecurityActivityList,
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
  getClientLabel?: () => string | undefined;
  onUnexpectedServerError?: (error: ApiClientError) => void;
};

type HealthResponse = {
  ok: boolean;
};

type ApiErrorDetails = {
  message?: string;
  code?: string;
  requestId?: string;
};

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    options: { status: number; code?: string; requestId?: string }
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

export function createApiClient({
  baseUrl,
  getAuthToken,
  refreshAuthToken,
  getClientLabel,
  onUnexpectedServerError,
}: ApiClientOptions) {
  async function request<T>(
    path: string,
    init?: RequestInit,
    canRefresh = true
  ): Promise<T> {
    const token = await getAuthToken?.();
    const clientLabel = getClientLabel?.();
    let response: Response;

    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(clientLabel ? { "X-Living-Nutrition-Client": clientLabel } : {}),
          ...init?.headers,
        },
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      throw new ApiClientError(
        "Cannot reach the nutrition API. Make sure the API server is running and your phone is on the same Wi-Fi as this Mac.",
        { status: 0, code: "network_unavailable" }
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
      const details = parseApiError(body);
      const error = new ApiClientError(details.message || `Request failed with HTTP ${response.status}`, {
        status: response.status,
        code: details.code,
        requestId: details.requestId,
      });
      if (response.status >= 500) {
        // Reporting receives only normalized error metadata, never the path,
        // query, request body, auth token, or response payload.
        try {
          onUnexpectedServerError?.(error);
        } catch {
          // Observability must never alter the caller's error/retry behavior.
        }
      }
      throw error;
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
    changePassword(input: PasswordChange) {
      return request<UserSession>("/auth/password", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getSession() {
      return request<UserSession>("/auth/session");
    },
    getAiUsageSummary() {
      return request<AiUsageSummary>("/account/ai-usage");
    },
    provisionClerkProfile(input: ClerkProfileProvision) {
      return request<UserSession>("/auth/provision", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    migrateLocalAccount(input: LocalAccountMigration) {
      return request<UserSession>("/auth/migrate-local-account", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    listAuthSessions() {
      return request<AuthSessionList>("/auth/sessions");
    },
    listSecurityActivity() {
      return request<SecurityActivityList>("/auth/activity");
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
    listGoalHistory() {
      return request<NutritionGoal[]>("/goals/history");
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
    saveWeightEntry(input: WeightEntryCreate, options?: { idempotencyKey?: string }) {
      return request<WeightEntry>("/weight", {
        method: "POST",
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
        body: JSON.stringify(input),
      });
    },
    deleteWeightEntry(loggedOn: string) {
      return request<void>(`/weight/${encodeURIComponent(loggedOn)}`, {
        method: "DELETE",
      });
    },
    getHydrationEntry(loggedOn: string) {
      return request<HydrationEntry | null>(`/hydration/${encodeURIComponent(loggedOn)}`);
    },
    saveHydrationEntry(loggedOn: string, input: HydrationEntryUpdate) {
      return request<HydrationEntry>(`/hydration/${encodeURIComponent(loggedOn)}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteHydrationEntry(loggedOn: string) {
      return request<void>(`/hydration/${encodeURIComponent(loggedOn)}`, {
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
    updateFavoriteFoodTags(foodId: string, input: FavoriteFoodTagsUpdate) {
      return request<FoodSearchResult>(`/foods/favorites/${encodeURIComponent(foodId)}/tags`, {
        method: "PUT",
        body: JSON.stringify(input),
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
    createCustomFood(input: CustomFoodCreate, options?: { idempotencyKey?: string }) {
      return request<FoodDetail>("/foods/custom", {
        method: "POST",
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
        body: JSON.stringify(input),
      });
    },
    updateCustomFood(foodId: string, input: CustomFoodCreate) {
      return request<FoodDetail>(`/foods/custom/${encodeURIComponent(foodId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    deleteCustomFood(foodId: string) {
      return request<void>(`/foods/custom/${encodeURIComponent(foodId)}`, {
        method: "DELETE",
      });
    },
    analyzeNutritionLabel(
      input: { imageBase64: string; barcode?: string },
      options?: { idempotencyKey?: string }
    ) {
      return request<NutritionLabelAnalysis>("/foods/label-analysis", {
        method: "POST",
        headers: options?.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : undefined,
        body: JSON.stringify(input),
      });
    },
    createMeal(input: MealCreate, options?: { idempotencyKey?: string }) {
      return request<MealRead>("/meals", {
        method: "POST",
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
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
    getMealImageAccess(mealId: string, imageId: string) {
      return request<MealImageAccess>(
        `/meals/${encodeURIComponent(mealId)}/images/${encodeURIComponent(imageId)}/access`
      );
    },
    deleteMealImage(mealId: string, imageId: string) {
      return request<void>(`/meals/${encodeURIComponent(mealId)}/images/${encodeURIComponent(imageId)}`, {
        method: "DELETE",
      });
    },
    updateMeal(mealId: string, input: MealUpdate, options: { revision: number }) {
      return request<MealRead>(`/meals/${encodeURIComponent(mealId)}`, {
        method: "PATCH",
        headers: { "If-Match": `"${options.revision}"` },
        body: JSON.stringify(input),
      });
    },
    deleteMeal(mealId: string) {
      return request<void>(`/meals/${encodeURIComponent(mealId)}`, {
        method: "DELETE",
      });
    },
    listRecipes() {
      return request<RecipeRead[]>("/recipes");
    },
    listRecipeFolders() {
      return request<RecipeFolderRead[]>("/recipes/folders");
    },
    createRecipeFolder(input: RecipeFolderCreate) {
      return request<RecipeFolderRead>("/recipes/folders", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    updateRecipeFolder(folderId: string, input: RecipeFolderUpdate) {
      return request<RecipeFolderRead>(`/recipes/folders/${encodeURIComponent(folderId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    deleteRecipeFolder(folderId: string) {
      return request<void>(`/recipes/folders/${encodeURIComponent(folderId)}`, {
        method: "DELETE",
      });
    },
    getRecipe(recipeId: string) {
      return request<RecipeRead>(`/recipes/${encodeURIComponent(recipeId)}`);
    },
    createRecipe(input: RecipeCreate, options?: { idempotencyKey?: string }) {
      return request<RecipeRead>("/recipes", {
        method: "POST",
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
        body: JSON.stringify(input),
      });
    },
    updateRecipe(recipeId: string, input: RecipeUpdate) {
      return request<RecipeRead>(`/recipes/${encodeURIComponent(recipeId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    updateRecipeTags(recipeId: string, input: RecipeTagsUpdate) {
      return request<RecipeRead>(`/recipes/${encodeURIComponent(recipeId)}/tags`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    deleteRecipe(recipeId: string) {
      return request<void>(`/recipes/${encodeURIComponent(recipeId)}`, {
        method: "DELETE",
      });
    },
    logRecipe(recipeId: string, options?: { idempotencyKey?: string }) {
      return request<RecipeLogResult>(`/recipes/${encodeURIComponent(recipeId)}/log`, {
        method: "POST",
        headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
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
    getRangeInsights(startDate: string, endDate: string) {
      const query = new URLSearchParams({ startDate, endDate });
      return request<RangeInsights>(`/insights/range?${query.toString()}`);
    },
    analyzeMealPhoto(input: {
      imageBase64?: string;
      imagesBase64?: string[];
      referencePlateDiameterMm?: number;
      idempotencyKey?: string;
    }, signal?: AbortSignal) {
      const { idempotencyKey, ...payload } = input;
      return request<MealAnalysisResult>("/meal-analysis", {
        method: "POST",
        signal,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        body: JSON.stringify(payload),
      });
    },
    createMealAnalysisJob(input: {
      imageBase64?: string;
      imagesBase64?: string[];
      referencePlateDiameterMm?: number;
      idempotencyKey?: string;
    }, signal?: AbortSignal) {
      const { idempotencyKey, ...payload } = input;
      return request<MealAnalysisJob>("/meal-analysis/jobs", {
        method: "POST",
        signal,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        body: JSON.stringify(payload),
      });
    },
    getMealAnalysisJob(jobId: string, signal?: AbortSignal) {
      return request<MealAnalysisJob>(`/meal-analysis/${encodeURIComponent(jobId)}`, { signal });
    },
    cancelMealAnalysisJob(jobId: string) {
      return request<MealAnalysisJob>(`/meal-analysis/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
      });
    },
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function parseApiError(body: unknown): ApiErrorDetails {
  if (!body || typeof body !== "object") {
    return {};
  }

  const errorBody = body as { detail?: unknown; error?: unknown; message?: unknown };
  const envelope = errorBody.error;
  const typedEnvelope =
    envelope && typeof envelope === "object"
      ? (envelope as { code?: unknown; message?: unknown; requestId?: unknown })
      : undefined;
  const value = typedEnvelope?.message || errorBody.message || errorBody.error || errorBody.detail;
  const code = typeof typedEnvelope?.code === "string" ? typedEnvelope.code : undefined;
  const requestId = typeof typedEnvelope?.requestId === "string" ? typedEnvelope.requestId : undefined;

  if (typeof value === "string") {
    return { message: value, code, requestId };
  }

  if (Array.isArray(value)) {
    const message = value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object" && "msg" in item) {
          return String((item as { msg: unknown }).msg);
        }

        return JSON.stringify(item);
      })
      .join(" ");
    return { message, code, requestId };
  }

  return value ? { message: JSON.stringify(value), code, requestId } : { code, requestId };
}
