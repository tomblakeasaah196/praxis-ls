/**
 * THE PUBLIC LEGAL PAGES — `/privacy` and `/terms`.
 *
 * Google's OAuth verification for the Gmail connection reads the privacy policy
 * for specific commitments. These pin the ones a well-meaning edit could drop
 * without anything else failing:
 *
 *   1. The Limited Use sentence, which Google expects close to verbatim, and
 *      its link to the Google API Services User Data Policy.
 *   2. The scopes the app actually requests are named, and the no-AI-training
 *      commitment is stated.
 *   3. Both documents name the registered company and a reachable contact.
 */
import type * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { axe } from "jest-axe";
import { PrivacyPage, TermsPage } from "./legal-page";

const renderAt = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

describe("Privacy policy", () => {
  it("carries Google's Limited Use statement with a link to the policy", () => {
    renderAt(<PrivacyPage />);
    // The sentence is split by its own link, so match the whole paragraph.
    const limitedUse = screen.getByText((_, el) =>
      el?.tagName === "P" &&
      /will adhere to the Google API Services User Data Policy \(https:\S+\), including the Limited Use requirements/.test(
        el.textContent || "",
      ),
    );
    expect(limitedUse).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://developers.google.com/terms/api-services-user-data-policy" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("names the Gmail permission the app requests and rules out AI training", () => {
    renderAt(<PrivacyPage />);
    expect(screen.getByText(/gmail\.modify/)).toBeInTheDocument();
    expect(screen.getByText(/never used to develop, improve or train generalised AI/)).toBeInTheDocument();
  });

  it("names the company and makes the contact address a mailto link", () => {
    renderAt(<PrivacyPage />);
    expect(screen.getAllByText(/JBS PRAXIS LIMITED/).length).toBeGreaterThan(0);
    const mail = screen.getAllByRole("link", { name: "support@praxisls.com" })[0];
    expect(mail).toHaveAttribute("href", "mailto:support@praxisls.com");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderAt(<PrivacyPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Terms of service", () => {
  it("states the governing law and links back to the privacy policy", () => {
    renderAt(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByText(/laws of the Federal Republic of Nigeria/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  });

  it("has no accessibility violations", async () => {
    const { container } = renderAt(<TermsPage />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
