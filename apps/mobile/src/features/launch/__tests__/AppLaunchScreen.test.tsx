import { render } from "@testing-library/react-native";

import { AppLaunchScreen } from "../AppLaunchScreen";
import { ThemeProvider } from "../../../shared/theme/ThemeProvider";

describe("AppLaunchScreen", () => {
  it("uses a branded structural loading state instead of fake progress", async () => {
    const view = await render(
      <ThemeProvider initialPreference="light">
        <AppLaunchScreen />
      </ThemeProvider>
    );

    expect(view.getByText("LIVING NUTRITION")).toBeTruthy();
    expect(view.getByText("Your diary is getting ready.")).toBeTruthy();
    expect(view.getByLabelText("Preparing Living Nutrition")).toBeTruthy();
    expect(view.queryByText(/%/)).toBeNull();
  });
});
