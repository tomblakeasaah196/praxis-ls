import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SitePill } from "./attendance-site-pill";

describe("SitePill", () => {
  it("flags Location Not Verified, shouts Off-site, mutes no-worksite", () => {
    // A punch with no location counts (owner's decision, 28 Nov 2026): it is
    // flagged for a look, not marked as a fault.
    const { rerender } = render(<SitePill status="no_gps" />);
    expect(screen.getByText("Location Not Verified")).toBeInTheDocument();
    expect(screen.queryByText("No GPS")).toBeNull();
    rerender(<SitePill status="off_site" />);
    expect(screen.getByText("Off-site")).toBeInTheDocument();
    rerender(<SitePill status="on_site" />);
    expect(screen.getByText("On-site")).toBeInTheDocument();
    rerender(<SitePill status="unfenced" />);
    expect(screen.getByText("No worksite")).toBeInTheDocument();
  });

  it("labels a reading that arrived after the tap, never as an on-site verdict", () => {
    render(<SitePill within status="delayed_gps" />);
    expect(screen.getByText("Delayed GPS")).toBeInTheDocument();
    expect(screen.queryByText("On-site")).toBeNull();
  });
});
