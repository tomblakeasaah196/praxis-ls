import { render, screen } from "@testing-library/react";
import { QuoteRoutingFacts } from "./quote-routing-facts";

/**
 * The desk reads why a website request landed on its service type (14640):
 * the website service, the direction, how the term was reached, the sentence
 * the visitor saw and the scope of the work, or that it waits for the desk.
 */
describe("QuoteRoutingFacts", () => {
  it("shows nothing for a request that did not come through the engine", () => {
    const { container } = render(<QuoteRoutingFacts request={{ quote_routing: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("explains a resolved request with its scope", () => {
    render(
      <QuoteRoutingFacts
        request={{
          trade_direction: "IMPORT",
          incoterm_source: "DERIVED",
          service_scope: {
            origin_pickup: true,
            export_clearance: true,
            main_carriage: true,
            import_clearance: true,
            duties_taxes: false,
            final_delivery: true,
          },
          quote_routing: {
            website_service_name: "Sea Freight",
            outcome: "RESOLVED",
            explanation: { en: "This is EXW: your supplier makes the goods ready at their premises, and we collect them there.", fr: "x" },
            answers: { party: "BUYER", start: "SUPPLIER_PREMISES", end: "PREMISES" },
          },
        }}
      />,
    );
    expect(screen.getByText("Sea Freight")).toBeInTheDocument();
    expect(screen.getByText("Worked Out From Their Answers")).toBeInTheDocument();
    expect(screen.getByText(/^This is EXW:/)).toBeInTheDocument();
    expect(screen.getByText("Collection at Origin")).toBeInTheDocument();
    expect(screen.queryByText("Duties and Taxes")).not.toBeInTheDocument();
    expect(screen.queryByText("Desk Review")).not.toBeInTheDocument();
  });

  it("says a desk-review request waits for the desk, and why", () => {
    render(
      <QuoteRoutingFacts
        request={{
          incoterm_source: "NOT_SURE",
          quote_routing: JSON.stringify({ website_service_name: "Sea Freight", outcome: "DESK", reason: "NOT_SURE" }),
        }}
      />,
    );
    expect(screen.getByText("Desk Review")).toBeInTheDocument();
    expect(screen.getByText("The visitor was not sure of an answer the service depends on.")).toBeInTheDocument();
  });
});
