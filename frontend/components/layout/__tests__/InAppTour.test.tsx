import { fireEvent, render, screen } from "@testing-library/react";

import { FeatureFlagProvider } from "../../../lib/featureFlagContext";
import { resolveFeatureFlags } from "../../../lib/featureFlags";
import InAppTour, { TOUR_STORAGE_KEY } from "../InAppTour";

const ON = resolveFeatureFlags({ FEATURE_IN_APP_TOUR: "true" });
const OFF = resolveFeatureFlags({ FEATURE_IN_APP_TOUR: "false" });

function renderTour(flags: typeof ON) {
  return render(
    <FeatureFlagProvider value={flags}>
      <InAppTour />
    </FeatureFlagProvider>,
  );
}

describe("InAppTour (flag on/off behaviour)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the training note when the flag is on", async () => {
    renderTour(ON);
    expect(await screen.findByTestId("in-app-tour")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeVisible();
    expect(screen.getByText(/command palette/i)).toBeVisible();
  });

  it("renders nothing when the flag is off", () => {
    renderTour(OFF);
    expect(screen.queryByTestId("in-app-tour")).toBeNull();
  });

  it("dismisses the tour and persists the choice", async () => {
    const { unmount } = renderTour(ON);
    fireEvent.click(await screen.findByTestId("dismiss-tour"));
    expect(screen.queryByTestId("in-app-tour")).toBeNull();
    expect(window.localStorage.getItem(TOUR_STORAGE_KEY)).toBe("1");

    unmount();
    renderTour(ON);
    expect(screen.queryByTestId("in-app-tour")).toBeNull();
  });
});
