import { describe, expect, it } from "vitest";
import { deriveAuthTrustedOrigins } from "../auth/better-auth.js";
import { loadConfig } from "../config.js";

describe("deriveAuthTrustedOrigins", () => {
  it("accepts loopback alias origins for explicit public URLs", () => {
    const origins = deriveAuthTrustedOrigins({
      ...loadConfig(),
      deploymentMode: "authenticated",
      authBaseUrlMode: "explicit",
      authPublicBaseUrl: "http://127.0.0.1:3100",
      allowedHostnames: ["127.0.0.1"],
      port: 3100,
    });

    expect(origins).toContain("http://127.0.0.1:3100");
    expect(origins).toContain("http://localhost:3100");
    expect(origins).toContain("http://[::1]:3100");
  });

  it("keeps allowed-hostname origins port-aware when no explicit public URL is set", () => {
    const origins = deriveAuthTrustedOrigins({
      ...loadConfig(),
      deploymentMode: "authenticated",
      authBaseUrlMode: "auto",
      authPublicBaseUrl: undefined,
      allowedHostnames: ["localhost"],
      port: 3100,
    });

    expect(origins).toContain("http://localhost:3100");
    expect(origins).toContain("https://localhost:3100");
  });
});
