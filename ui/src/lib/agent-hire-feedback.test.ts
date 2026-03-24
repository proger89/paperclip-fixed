// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildAgentHireToastPlan } from "./agent-hire-feedback";

describe("buildAgentHireToastPlan", () => {
  it("returns a success toast when the hire has no pending follow-up approvals", () => {
    expect(
      buildAgentHireToastPlan({
        hasHireApproval: false,
        skillApprovalCount: 0,
        connectorApprovalCount: 0,
      }),
    ).toEqual({
      title: "Agent created",
      body: "The new hire is ready for work.",
      tone: "success",
    });
  });

  it("returns a warn toast when the hire itself is pending approval", () => {
    expect(
      buildAgentHireToastPlan({
        hasHireApproval: true,
        skillApprovalCount: 0,
        connectorApprovalCount: 0,
      }),
    ).toEqual({
      title: "Agent created with pending approvals",
      body: "1 hire approval was queued. Review them before the hire can proceed.",
      tone: "warn",
      action: {
        label: "Open approvals",
        href: "/approvals",
      },
    });
  });

  it("summarizes skill and connector follow-up approvals", () => {
    expect(
      buildAgentHireToastPlan({
        hasHireApproval: false,
        skillApprovalCount: 2,
        connectorApprovalCount: 1,
      }),
    ).toEqual({
      title: "Agent created with follow-up approvals",
      body:
        "2 skill approvals and 1 connector approval were queued so the role bundle can install missing capabilities.",
      tone: "warn",
      action: {
        label: "Open approvals",
        href: "/approvals",
      },
    });
  });

  it("joins mixed approval types with commas", () => {
    expect(
      buildAgentHireToastPlan({
        hasHireApproval: true,
        skillApprovalCount: 2,
        connectorApprovalCount: 3,
      }).body,
    ).toBe(
      "1 hire approval, 2 skill approvals, and 3 connector approvals were queued. Review them before the hire can proceed.",
    );
  });
});
