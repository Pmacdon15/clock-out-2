import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocationSettingsData, SiteData } from "@/lib/types";
import { renderWithClient } from "../utils";

const mocks = vi.hoisted(() => ({
  updateLocationSettingsAction: vi.fn(),
  createSiteAction: vi.fn(),
  updateSiteAction: vi.fn(),
  deleteSiteAction: vi.fn(),
  searchAddressAction: vi.fn(),
  reverseGeocodeAction: vi.fn(),
  captureCurrentPosition: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/actions", () => ({
  updateLocationSettingsAction: mocks.updateLocationSettingsAction,
  createSiteAction: mocks.createSiteAction,
  updateSiteAction: mocks.updateSiteAction,
  deleteSiteAction: mocks.deleteSiteAction,
  searchAddressAction: mocks.searchAddressAction,
  reverseGeocodeAction: mocks.reverseGeocodeAction,
}));
vi.mock("@/lib/geolocation", () => ({
  captureCurrentPosition: mocks.captureCurrentPosition,
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import LocationSettings from "@/components/LocationSettings";

const saved: LocationSettingsData = {
  org_id: "org_1",
  capture_mode: "optional",
  restrict_clock_in: false,
};

const depot: SiteData = {
  id: 4,
  org_id: "org_1",
  name: "Depot",
  latitude: 45.4215,
  longitude: -75.6972,
  radius_meters: 150,
};

function renderPanel({
  initialData = null,
  sites = [],
  hasGeofencing = true,
}: {
  initialData?: LocationSettingsData | null;
  sites?: SiteData[];
  hasGeofencing?: boolean;
} = {}) {
  const onUpdateOptimistic = vi.fn();
  renderWithClient(
    <LocationSettings
      hasGeofencing={hasGeofencing}
      initialData={initialData}
      onUpdateOptimistic={onUpdateOptimistic}
      sites={sites}
    />,
  );
  return onUpdateOptimistic;
}

const option = (label: RegExp) => screen.getByRole("button", { name: label });
const saveSettings = () =>
  screen.getByRole("button", { name: "Save Location Settings" });

afterEach(() => {
  vi.clearAllMocks();
});

describe("LocationSettings without the paid feature", () => {
  it("shows the upsell instead of the controls", () => {
    renderPanel({ hasGeofencing: false, initialData: saved, sites: [depot] });
    expect(screen.getByText("Premium Feature")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View Plans" })).toHaveAttribute(
      "href",
      "/plans",
    );
    expect(
      screen.queryByRole("button", { name: "Save Location Settings" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Depot")).not.toBeInTheDocument();
  });
});

describe("LocationSettings capture mode", () => {
  it("defaults to capture off and lets an admin save straight away", () => {
    renderPanel();
    expect(option(/Do Not Capture Location/).className).toContain(
      "border-zinc-900",
    );
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(saveSettings()).toBeEnabled();
  });

  it("marks the stored mode and disables saving until something changes", () => {
    renderPanel({ initialData: saved });
    expect(option(/Capture Location When Available/)).toHaveTextContent(
      "Current",
    );
    expect(saveSettings()).toBeDisabled();
  });

  it("saves a new mode optimistically and reports success", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderPanel({ initialData: saved });

    fireEvent.click(option(/Require Location/));
    expect(saveSettings()).toBeEnabled();
    fireEvent.click(saveSettings());

    await waitFor(() =>
      expect(mocks.updateLocationSettingsAction).toHaveBeenCalledWith(
        "required",
        false,
      ),
    );
    expect(onUpdateOptimistic).toHaveBeenCalledWith({
      ...saved,
      capture_mode: "required",
      restrict_clock_in: false,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "Location settings updated",
    );
  });

  it("saves the restriction toggle", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({ success: true });
    renderPanel({ initialData: saved });

    fireEvent.click(
      screen.getByLabelText(/Restrict clock-in to my work sites/),
    );
    fireEvent.click(saveSettings());

    await waitFor(() =>
      expect(mocks.updateLocationSettingsAction).toHaveBeenCalledWith(
        "optional",
        true,
      ),
    );
  });

  it("skips the optimistic update when nothing is stored yet", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({ success: true });
    const onUpdateOptimistic = renderPanel();

    fireEvent.click(saveSettings());
    await waitFor(() =>
      expect(mocks.updateLocationSettingsAction).toHaveBeenCalled(),
    );
    expect(onUpdateOptimistic).not.toHaveBeenCalled();
  });

  it("surfaces the server's error", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({
      success: false,
      error: "Unauthorized",
    });
    renderPanel();

    fireEvent.click(saveSettings());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Unauthorized"),
    );
  });

  it("falls back to a generic message when the server gives no reason", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({
      success: false,
      error: "",
    });
    renderPanel();

    fireEvent.click(saveSettings());
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Update failed"),
    );
  });
});

describe("LocationSettings quiet failures and pending states", () => {
  it("stays quiet when a settings save fails with no error field", async () => {
    mocks.updateLocationSettingsAction.mockResolvedValue({ success: false });
    renderPanel();

    fireEvent.click(saveSettings());
    await waitFor(() =>
      expect(mocks.updateLocationSettingsAction).toHaveBeenCalled(),
    );
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it("stays quiet when a removal fails with no error field", async () => {
    mocks.deleteSiteAction.mockResolvedValue({ success: false });
    renderPanel({ sites: [depot] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Depot" }));
    await waitFor(() => expect(mocks.deleteSiteAction).toHaveBeenCalled());
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it("disables the settings button while the save is in flight", async () => {
    mocks.updateLocationSettingsAction.mockReturnValue(new Promise(() => {}));
    renderPanel();

    fireEvent.click(saveSettings());
    await waitFor(() => expect(saveSettings()).toBeDisabled());
  });

  it("disables the site button while the save is in flight", async () => {
    mocks.createSiteAction.mockReturnValue(new Promise(() => {}));
    renderPanel();
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-75" },
    });
    const button = screen.getByRole("button", { name: /Add Site/ });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
  });
});

describe("LocationSettings work sites", () => {
  it("says so when there are no sites", () => {
    renderPanel();
    expect(screen.getByText(/No sites yet/)).toBeInTheDocument();
  });

  it("lists each site with its point and radius", () => {
    renderPanel({ sites: [depot] });
    expect(screen.getByText("Depot")).toBeInTheDocument();
    expect(
      screen.getByText(/45\.42150, -75\.69720 · 150 m/),
    ).toBeInTheDocument();
  });

  it("adds a site", async () => {
    mocks.createSiteAction.mockResolvedValue({ success: true });
    renderPanel();

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45.5" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-75.5" },
    });
    fireEvent.change(screen.getByLabelText("Radius (metres)"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));

    await waitFor(() =>
      expect(mocks.createSiteAction).toHaveBeenCalledWith(
        "Yard",
        45.5,
        -75.5,
        200,
      ),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Site saved");
  });

  it("falls back to the default radius when the field is emptied", async () => {
    mocks.createSiteAction.mockResolvedValue({ success: true });
    renderPanel();

    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45.5" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-75.5" },
    });
    fireEvent.change(screen.getByLabelText("Radius (metres)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));

    await waitFor(() =>
      expect(mocks.createSiteAction).toHaveBeenCalledWith(
        "Yard",
        45.5,
        -75.5,
        150,
      ),
    );
  });

  it("refuses to save a site with no name", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));
    expect(mocks.toast.error).toHaveBeenCalledWith("Give the site a name");
    expect(mocks.createSiteAction).not.toHaveBeenCalled();
  });

  it("refuses to save a site with no coordinates", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Enter a latitude and longitude for the site",
    );
    expect(mocks.createSiteAction).not.toHaveBeenCalled();
  });

  it("refuses to save a site with a latitude but no longitude", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));
    expect(mocks.toast.error).toHaveBeenCalledWith(
      "Enter a latitude and longitude for the site",
    );
    expect(mocks.createSiteAction).not.toHaveBeenCalled();
  });

  it("surfaces a failed save", async () => {
    mocks.createSiteAction.mockResolvedValue({
      success: false,
      error: "Invalid site radius",
    });
    renderPanel();
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-75" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Invalid site radius"),
    );
  });

  it("falls back to a generic message when a save fails with no reason", async () => {
    mocks.createSiteAction.mockResolvedValue({ success: false, error: "" });
    renderPanel();
    fireEvent.change(screen.getByLabelText("Site name"), {
      target: { value: "Yard" },
    });
    fireEvent.change(screen.getByLabelText("Latitude"), {
      target: { value: "45" },
    });
    fireEvent.change(screen.getByLabelText("Longitude"), {
      target: { value: "-75" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add Site/ }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to save site"),
    );
  });

  it("edits an existing site, then cancels back to the add form", async () => {
    mocks.updateSiteAction.mockResolvedValue({ success: true });
    renderPanel({ sites: [depot] });

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Edit site")).toBeInTheDocument();
    expect(screen.getByLabelText("Site name")).toHaveValue("Depot");

    fireEvent.change(screen.getByLabelText("Radius (metres)"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save Site/ }));

    await waitFor(() =>
      expect(mocks.updateSiteAction).toHaveBeenCalledWith(
        4,
        "Depot",
        45.4215,
        -75.6972,
        300,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.getByText("Add a site")).toBeInTheDocument();
    expect(screen.getByLabelText("Site name")).toHaveValue("");
  });

  it("removes a site", async () => {
    mocks.deleteSiteAction.mockResolvedValue({ success: true });
    renderPanel({ sites: [depot] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Depot" }));
    await waitFor(() => expect(mocks.deleteSiteAction).toHaveBeenCalledWith(4));
    expect(mocks.toast.success).toHaveBeenCalledWith("Site removed");
  });

  it("surfaces a failed removal", async () => {
    mocks.deleteSiteAction.mockResolvedValue({
      success: false,
      error: "Site not found",
    });
    renderPanel({ sites: [depot] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Depot" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Site not found"),
    );
  });

  it("falls back to a generic message when a removal fails with no reason", async () => {
    mocks.deleteSiteAction.mockResolvedValue({ success: false, error: "" });
    renderPanel({ sites: [depot] });

    fireEvent.click(screen.getByRole("button", { name: "Remove Depot" }));
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("Failed to remove site"),
    );
  });
});

describe("LocationSettings 'use my location'", () => {
  it("fills the coordinate fields from the browser", async () => {
    mocks.captureCurrentPosition.mockResolvedValue({
      ok: true,
      coordinates: { latitude: 45.4215, longitude: -75.6972, accuracy: 10 },
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Latitude")).toHaveValue(45.4215),
    );
    expect(screen.getByLabelText("Longitude")).toHaveValue(-75.6972);
  });

  it("explains a refusal instead of failing silently", async () => {
    mocks.captureCurrentPosition.mockResolvedValue({
      ok: false,
      failure: { code: "denied", message: "Location access is blocked." },
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(
        "Location access is blocked.",
      ),
    );
    expect(screen.getByLabelText("Latitude")).toHaveValue(null);
  });

  it("fills address and site name when reverse geocoding succeeds on 'use my location'", async () => {
    mocks.captureCurrentPosition.mockResolvedValue({
      ok: true,
      coordinates: { latitude: 45.4215, longitude: -75.6972, accuracy: 10 },
    });
    mocks.reverseGeocodeAction.mockResolvedValue({
      success: true,
      data: "111 Albert St, Ottawa, ON",
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));

    await waitFor(() =>
      expect(screen.getByLabelText("Site name")).toHaveValue(
        "111 Albert St, Ottawa, ON",
      ),
    );
    expect(screen.getByLabelText("Latitude")).toHaveValue(45.4215);
    expect(screen.getByLabelText("Longitude")).toHaveValue(-75.6972);
  });
});

describe("LocationSettings address search", () => {
  it("searches address and selects a suggestion to auto-fill", async () => {
    mocks.searchAddressAction.mockResolvedValue({
      success: true,
      data: [
        {
          formatted: "111 Albert St, Ottawa, ON",
          latitude: 45.4215,
          longitude: -75.6972,
          addressLine1: "111 Albert St",
        },
      ],
    });
    mocks.createSiteAction.mockResolvedValue({ success: true });
    renderPanel();

    const searchInput = screen.getByLabelText("Find address");
    fireEvent.change(searchInput, { target: { value: "111 Albert" } });

    await waitFor(() =>
      expect(screen.getByText("111 Albert St, Ottawa, ON")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText("111 Albert St, Ottawa, ON"));

    expect(screen.getByLabelText("Site name")).toHaveValue("111 Albert St");
    expect(screen.getByLabelText("Latitude")).toHaveValue(45.4215);
    expect(screen.getByLabelText("Longitude")).toHaveValue(-75.6972);

    fireEvent.click(screen.getByRole("button", { name: "Add Site" }));

    await waitFor(() =>
      expect(mocks.createSiteAction).toHaveBeenCalledWith(
        "111 Albert St",
        45.4215,
        -75.6972,
        150,
        "111 Albert St, Ottawa, ON",
      ),
    );
  });

  it("displays site address in the sites list", () => {
    const siteWithAddress = {
      ...depot,
      address: "100 Main St, Ottawa, ON",
    };
    renderPanel({ sites: [siteWithAddress] });
    expect(screen.getByText("100 Main St, Ottawa, ON")).toBeInTheDocument();
  });
});
