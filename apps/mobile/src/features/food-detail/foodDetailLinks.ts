export function foodDetailHref(
  foodId: string,
  params: Record<string, string | number | null | undefined> = {}
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return `/food/${encodeURIComponent(foodId)}${query ? `?${query}` : ""}`;
}
