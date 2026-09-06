import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../test/utils";
import { ExportScreen } from "./ExportScreen";

describe("ExportScreen", () => {
  it("downloads JSON for the selected range", () => {
    renderApp(<ExportScreen />);
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "json" } });
    expect(screen.getByRole("link", { name: "Download JSON" })).toHaveAttribute("href", expect.stringContaining("format=json"));
  });
});
