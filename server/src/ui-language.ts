import type { Db } from "@paperclipai/db";
import type { Request, RequestHandler } from "express";
import type { UiLanguage } from "@paperclipai/shared";
import { instanceSettingsService } from "./services/instance-settings.js";

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export function normalizeUiLanguage(value: unknown): UiLanguage | null {
  return value === "ru" || value === "en" ? value : null;
}

export function detectUiLanguageFromAcceptLanguage(
  header: string | string[] | undefined | null,
): UiLanguage {
  const value = Array.isArray(header) ? header.join(",") : header ?? "";
  return /\bru(?:[-_][a-z]{2})?\b/i.test(value) ? "ru" : DEFAULT_UI_LANGUAGE;
}

export function resolveEffectiveUiLanguage(input: {
  storedUiLanguage?: UiLanguage | null;
  acceptLanguage?: string | string[] | undefined | null;
}): UiLanguage {
  return normalizeUiLanguage(input.storedUiLanguage)
    ?? detectUiLanguageFromAcceptLanguage(input.acceptLanguage);
}

export function getRequestUiLanguage(req: Request): UiLanguage {
  return normalizeUiLanguage(req.uiLanguage)
    ?? resolveEffectiveUiLanguage({
      acceptLanguage: req.header("accept-language"),
    });
}

export function uiLanguageMiddleware(db: Db): RequestHandler {
  const settings = instanceSettingsService(db);

  return async (req, _res, next) => {
    req.uiLanguage = detectUiLanguageFromAcceptLanguage(req.header("accept-language"));

    if (req.actor.type !== "board") {
      next();
      return;
    }

    try {
      const general = await settings.getGeneral();
      req.uiLanguage = resolveEffectiveUiLanguage({
        storedUiLanguage: general.uiLanguage,
        acceptLanguage: req.header("accept-language"),
      });
    } catch {
      // Keep the browser-derived fallback if instance settings are temporarily unavailable.
    }

    next();
  };
}
