// @vitest-environment node

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "../context/ThemeContext";
import { ApprovalPayloadRenderer, approvalLabel } from "./ApprovalPayload";

describe("ApprovalPayload", () => {
  it("builds a contextual label for content publication approvals", () => {
    expect(
      approvalLabel("publish_content", {
        channel: "telegram",
        destinationLabel: "@paperclip_ai",
      }),
    ).toBe("Content Publication: telegram -> @paperclip_ai");
  });

  it("renders publish content payload fields explicitly", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <ApprovalPayloadRenderer
          type="publish_content"
          payload={{
            channel: "telegram",
            destinationLabel: "@paperclip_ai",
            authorVoice: "sharp, concise",
            publishAt: "2026-03-23T18:00:00Z",
            sourceSummary: "OpenAI shipped a new capability with a limited rollout.",
            draftExcerpt: "Short post body",
            riskFlags: ["needs source link"],
            safetyChecks: ["claims_checked", "style_checked"],
          }}
        />
      </ThemeProvider>,
    );

    expect(html).toContain("telegram");
    expect(html).toContain("@paperclip_ai");
    expect(html).toContain("sharp, concise");
    expect(html).toContain("needs source link");
    expect(html).toContain("claims_checked");
    expect(html).toContain("Short post body");
  });
});
