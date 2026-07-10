import { z } from "zod";

export const nutrientPer100gSchema = z.object({
  caloriesKcal: z.number().nonnegative(),
  proteinGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  fiberGrams: z.number().nonnegative().optional(),
  sugarGrams: z.number().nonnegative().optional(),
  sodiumMilligrams: z.number().nonnegative().optional(),
});

export const confidenceSchema = z.object({
  identity: z.enum(["verified", "high", "medium", "low"]),
  portion: z.enum(["verified", "high", "medium", "low"]),
  nutritionRecord: z.enum(["verified", "high", "medium", "low"]),
  explanation: z.string(),
});

export const foodSearchResultSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  provider: z.enum(["usda", "open_food_facts", "commercial", "user"]),
  externalId: z.string(),
  dataType: z.string(),
  brandOwner: z.string().nullable(),
  publicationDate: z.string().nullable().optional(),
  servingSize: z.number().nullable().optional(),
  servingSizeUnit: z.string().nullable().optional(),
  householdServingText: z.string().nullable().optional(),
  nutrientsPer100g: nutrientPer100gSchema,
  originalNutrientIds: z.record(z.string(), z.string()).optional(),
  qualityFlags: z.array(z.string()).optional(),
  recordConfidence: z.enum(["verified", "high", "medium", "low"]),
  sourceReference: z.string(),
  retrievedAt: z.string().optional(),
});

export const foodSearchResponseSchema = z.object({
  items: z.array(foodSearchResultSchema),
});

export const foodServingOptionSchema = z.object({
  label: z.string(),
  quantity: z.number(),
  unit: z.string(),
  grams: z.number().nullable().optional(),
  milliliters: z.number().nullable().optional(),
});

export const foodDetailSchema = foodSearchResultSchema.extend({
  servingOptions: z.array(foodServingOptionSchema),
  provenanceSummary: z.string(),
});

export const mealAnalysisItemSchema = z.object({
  id: z.string(),
  detectedName: z.string(),
  candidateLabels: z.array(z.string()).default([]),
  displayName: z.string(),
  provider: z.enum(["usda", "open_food_facts", "commercial", "user"]),
  externalId: z.string(),
  dataType: z.string(),
  sourceReference: z.string(),
  servingGrams: z.number().nonnegative(),
  servingLabel: z.string(),
  nutrients: nutrientPer100gSchema,
  confidence: confidenceSchema,
  needsReview: z.boolean(),
  notes: z.string(),
});

export const mealAnalysisResultSchema = z.object({
  id: z.string(),
  status: z.enum(["ready", "needs_review"]),
  mealName: z.string(),
  summary: z.string(),
  notes: z.string(),
  totalNutrients: nutrientPer100gSchema,
  items: z.array(mealAnalysisItemSchema),
  confidence: confidenceSchema,
  createdAt: z.string(),
});

export const mealItemCreateSchema = z.object({
  foodId: z.string(),
  displayName: z.string(),
  consumedGrams: z.number().positive(),
  servingQuantity: z.number().nonnegative().nullable().optional(),
  servingUnit: z.string().nullable().optional(),
  calories: z.number().nonnegative(),
  proteinGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  fiberGrams: z.number().nonnegative().nullable().optional(),
  sugarGrams: z.number().nonnegative().nullable().optional(),
  sodiumMilligrams: z.number().nonnegative().nullable().optional(),
  sourceProvider: z.string(),
  sourceExternalId: z.string(),
  sourceVersion: z.string().nullable().optional(),
  sourceReference: z.string().nullable().optional(),
  nutrientSnapshotJson: z.record(z.string(), z.unknown()),
  confidence: confidenceSchema,
  userConfirmed: z.boolean(),
  preparationMethod: z.string().nullable().optional(),
  addedOilGrams: z.number().nonnegative().default(0),
  notes: z.string().nullable().optional(),
});

export const mealCreateSchema = z.object({
  name: z.string().min(1),
  loggedAt: z.string().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(mealItemCreateSchema).min(1),
});

export const mealUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  items: z.array(mealItemCreateSchema).min(1).optional(),
});

export const mealItemReadSchema = mealItemCreateSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mealReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  loggedAt: z.string(),
  notes: z.string().nullable(),
  items: z.array(mealItemReadSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const diaryTotalsSchema = z.object({
  calories: z.number().nonnegative(),
  proteinGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  fiberGrams: z.number().nonnegative(),
  sugarGrams: z.number().nonnegative(),
  sodiumMilligrams: z.number().nonnegative(),
});

export const diaryDaySchema = z.object({
  date: z.string(),
  totals: diaryTotalsSchema,
  meals: z.array(mealReadSchema),
});

export const weeklyInsightDaySchema = z.object({
  date: z.string(),
  totals: diaryTotalsSchema,
  mealCount: z.number().int().nonnegative(),
  goalMet: z.boolean(),
});

export const weeklyInsightsSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  calorieTarget: z.number().nonnegative(),
  goalDays: z.number().int().nonnegative(),
  averageCalories: z.number().nonnegative(),
  days: z.array(weeklyInsightDaySchema),
});

export const monthlyInsightsSchema = z.object({
  month: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  calorieTarget: z.number().nonnegative(),
  loggedDays: z.number().int().nonnegative(),
  goalDays: z.number().int().nonnegative(),
  averageCalories: z.number().nonnegative(),
  days: z.array(weeklyInsightDaySchema),
});

export const customFoodCreateSchema = z.object({
  displayName: z.string().min(1),
  barcode: z.string().nullable().optional(),
  brandOwner: z.string().nullable().optional(),
  servingSize: z.number().nonnegative().nullable().optional(),
  servingSizeUnit: z.string().nullable().optional(),
  householdServingText: z.string().nullable().optional(),
  nutrientsPer100g: nutrientPer100gSchema,
  notes: z.string().nullable().optional(),
});

export const labelNutrientsSchema = z.object({
  caloriesKcal: z.number().nonnegative().nullable(),
  proteinGrams: z.number().nonnegative().nullable(),
  carbohydrateGrams: z.number().nonnegative().nullable(),
  fatGrams: z.number().nonnegative().nullable(),
  fiberGrams: z.number().nonnegative().nullable(),
  sugarGrams: z.number().nonnegative().nullable(),
  sodiumMilligrams: z.number().nonnegative().nullable(),
});

export const nutritionLabelAnalysisSchema = z.object({
  displayName: z.string().nullable(),
  brandOwner: z.string().nullable(),
  barcode: z.string().nullable(),
  servingSizeText: z.string().nullable(),
  servingSizeGrams: z.number().positive().nullable(),
  nutritionBasis: z.enum(["per_serving", "per_100g", "unknown"]),
  labelNutrients: labelNutrientsSchema,
  nutrientsPer100g: nutrientPer100gSchema.nullable(),
  confidence: z.enum(["verified", "high", "medium", "low"]),
  qualityFlags: z.array(z.string()),
  warnings: z.array(z.string()),
  requiresConfirmation: z.boolean(),
});

export const foodCorrectionReportCreateSchema = z.object({
  reportType: z.string().min(1).max(64),
  message: z.string().min(8).max(2000),
});

export const foodCorrectionReportSchema = z.object({
  id: z.string(),
  foodSourceRecordId: z.string().nullable(),
  reportType: z.string(),
  message: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

export const foodCorrectionReportSummarySchema = foodCorrectionReportSchema.extend({
  sourceDisplayName: z.string().nullable().optional(),
  sourceProvider: z
    .enum(["usda", "open_food_facts", "commercial", "user"])
    .nullable()
    .optional(),
  sourceExternalId: z.string().nullable().optional(),
  sourceReference: z.string().nullable().optional(),
});

export const foodCorrectionReportListSchema = z.object({
  items: z.array(foodCorrectionReportSummarySchema),
});

export const localAuthRequestSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(8),
  displayName: z.string().nullable().optional(),
});

export const userSessionSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  token: z.string().nullable().optional(),
  accessToken: z.string().nullable().optional(),
  refreshToken: z.string().nullable().optional(),
  accessTokenExpiresAt: z.string().nullable().optional(),
  authScheme: z.string(),
});

export const authSessionSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string(),
  isCurrent: z.boolean(),
});

export const authSessionListSchema = z.object({
  items: z.array(authSessionSummarySchema),
});

export const nutritionGoalSchema = z.object({
  id: z.string(),
  startsOn: z.string(),
  caloriesKcal: z.number().positive(),
  proteinGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  fiberGrams: z.number().nonnegative().nullable().optional(),
  sodiumMilligrams: z.number().nonnegative().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const nutritionGoalUpdateSchema = z.object({
  startsOn: z.string().optional(),
  caloriesKcal: z.number().positive(),
  proteinGrams: z.number().nonnegative(),
  carbohydrateGrams: z.number().nonnegative(),
  fatGrams: z.number().nonnegative(),
  fiberGrams: z.number().nonnegative().nullable().optional(),
  sodiumMilligrams: z.number().nonnegative().nullable().optional(),
});

export const userPreferenceSchema = z.object({
  id: z.string(),
  locale: z.string(),
  unitSystem: z.enum(["us", "metric"]),
  dayStartTime: z.string(),
  timezone: z.string(),
  imageRetentionDays: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userPreferenceUpdateSchema = z.object({
  locale: z.string().optional(),
  unitSystem: z.enum(["us", "metric"]).optional(),
  dayStartTime: z.string().optional(),
  timezone: z.string().optional(),
  imageRetentionDays: z.number().int().nonnegative().optional(),
});

export const weightEntryCreateSchema = z.object({
  loggedOn: z.string().nullable().optional(),
  weightGrams: z.number().positive(),
  notes: z.string().nullable().optional(),
});

export const weightEntrySchema = z.object({
  id: z.string(),
  loggedOn: z.string(),
  weightGrams: z.number().positive(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const userDataExportSchema = z.object({
  generatedAt: z.string(),
  user: userSessionSchema,
  preferences: userPreferenceSchema,
  goals: z.array(nutritionGoalSchema),
  weightEntries: z.array(weightEntrySchema),
  meals: z.array(mealReadSchema),
  favoriteFoods: z.array(foodSearchResultSchema),
  recentFoods: z.array(foodSearchResultSchema),
  customFoods: z.array(foodSearchResultSchema),
});

export type NutrientPer100g = z.infer<typeof nutrientPer100gSchema>;
export type Confidence = z.infer<typeof confidenceSchema>;
export type FoodSearchResult = z.infer<typeof foodSearchResultSchema>;
export type FoodSearchResponse = z.infer<typeof foodSearchResponseSchema>;
export type FoodServingOption = z.infer<typeof foodServingOptionSchema>;
export type FoodDetail = z.infer<typeof foodDetailSchema>;
export type MealAnalysisItem = z.infer<typeof mealAnalysisItemSchema>;
export type MealAnalysisResult = z.infer<typeof mealAnalysisResultSchema>;
export type MealItemCreate = z.infer<typeof mealItemCreateSchema>;
export type MealCreate = z.infer<typeof mealCreateSchema>;
export type MealUpdate = z.infer<typeof mealUpdateSchema>;
export type MealItemRead = z.infer<typeof mealItemReadSchema>;
export type MealRead = z.infer<typeof mealReadSchema>;
export type DiaryTotals = z.infer<typeof diaryTotalsSchema>;
export type DiaryDay = z.infer<typeof diaryDaySchema>;
export type WeeklyInsightDay = z.infer<typeof weeklyInsightDaySchema>;
export type WeeklyInsights = z.infer<typeof weeklyInsightsSchema>;
export type MonthlyInsights = z.infer<typeof monthlyInsightsSchema>;
export type CustomFoodCreate = z.infer<typeof customFoodCreateSchema>;
export type LabelNutrients = z.infer<typeof labelNutrientsSchema>;
export type NutritionLabelAnalysis = z.infer<typeof nutritionLabelAnalysisSchema>;
export type FoodCorrectionReportCreate = z.infer<typeof foodCorrectionReportCreateSchema>;
export type FoodCorrectionReport = z.infer<typeof foodCorrectionReportSchema>;
export type FoodCorrectionReportSummary = z.infer<typeof foodCorrectionReportSummarySchema>;
export type FoodCorrectionReportList = z.infer<typeof foodCorrectionReportListSchema>;
export type LocalAuthRequest = z.infer<typeof localAuthRequestSchema>;
export type UserSession = z.infer<typeof userSessionSchema>;
export type AuthSessionSummary = z.infer<typeof authSessionSummarySchema>;
export type AuthSessionList = z.infer<typeof authSessionListSchema>;
export type NutritionGoal = z.infer<typeof nutritionGoalSchema>;
export type NutritionGoalUpdate = z.infer<typeof nutritionGoalUpdateSchema>;
export type UserPreference = z.infer<typeof userPreferenceSchema>;
export type UserPreferenceUpdate = z.infer<typeof userPreferenceUpdateSchema>;
export type WeightEntryCreate = z.infer<typeof weightEntryCreateSchema>;
export type WeightEntry = z.infer<typeof weightEntrySchema>;
export type UserDataExport = z.infer<typeof userDataExportSchema>;
