import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { NaturalEntryScreen } from "../NaturalEntryScreen";

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock("../../../services/api", () => ({
  api: {
    searchFoods: jest.fn(),
    createMeal: jest.fn(),
  },
}));

describe("NaturalEntryScreen", () => {
  it("explains that only explicit gram and ounce weights can be parsed", async () => {
    const view = await renderWithQueryClient(<NaturalEntryScreen />);

    expect(view.getByText("Describe it, then confirm the records.")).toBeTruthy();
    expect(view.getByLabelText("Meal description with explicit weights")).toBeTruthy();
    expect(view.getByText("Find food records")).toBeTruthy();
    expect(view.getByText(/Cups, pieces, and vague portions need a weight first/)).toBeTruthy();
  });
});

function renderWithQueryClient(element: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>
    </SafeAreaProvider>
  );
}
