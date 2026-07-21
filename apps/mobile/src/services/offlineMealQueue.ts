import * as SQLite from "expo-sqlite";

import type { MealCreate } from "@living-nutrition/shared-types";

type QueuedMealRow = {
  id: string;
  meal_json: string;
  idempotency_key: string;
};

export type OfflineMealSyncResult = {
  synced: number;
  remaining: number;
};

let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

async function database() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync("living-nutrition-offline.db").then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS queued_meals (
          id TEXT PRIMARY KEY NOT NULL,
          owner_id TEXT NOT NULL,
          meal_json TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(owner_id, idempotency_key)
        );
        CREATE INDEX IF NOT EXISTS ix_queued_meals_owner_created
          ON queued_meals(owner_id, created_at);
      `);
      return db;
    });
  }

  return databasePromise;
}

export async function queueConfirmedMeal(
  ownerId: string,
  meal: MealCreate,
  idempotencyKey: string
) {
  const db = await database();
  await db.runAsync(
    `INSERT OR IGNORE INTO queued_meals (id, owner_id, meal_json, idempotency_key, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    createQueueId(),
    ownerId,
    JSON.stringify(meal),
    idempotencyKey,
    Date.now()
  );
}

export async function queuedMealCount(ownerId: string) {
  const db = await database();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM queued_meals WHERE owner_id = ?",
    ownerId
  );
  return Number(row?.count ?? 0);
}

export async function clearQueuedMeals(ownerId: string) {
  const db = await database();
  await db.runAsync("DELETE FROM queued_meals WHERE owner_id = ?", ownerId);
}

/** Replays confirmed, source-backed snapshots with their original idempotency key. */
export async function syncQueuedMeals(
  ownerId: string,
  createMeal: (meal: MealCreate, options: { idempotencyKey: string }) => Promise<unknown>
): Promise<OfflineMealSyncResult> {
  const db = await database();
  const rows = await db.getAllAsync<QueuedMealRow>(
    "SELECT id, meal_json, idempotency_key FROM queued_meals WHERE owner_id = ? ORDER BY created_at ASC",
    ownerId
  );
  let synced = 0;

  for (const row of rows) {
    let meal: MealCreate;
    try {
      meal = JSON.parse(row.meal_json) as MealCreate;
    } catch {
      // A locally corrupted payload cannot be safely reconstructed or uploaded.
      continue;
    }

    try {
      await createMeal(meal, { idempotencyKey: row.idempotency_key });
      await db.runAsync("DELETE FROM queued_meals WHERE id = ?", row.id);
      synced += 1;
    } catch {
      // Preserve the snapshot and stop to retain the user's original logging order.
      break;
    }
  }

  return { synced, remaining: await queuedMealCount(ownerId) };
}

function createQueueId() {
  return `queued-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
