import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UiLanguage } from "@paperclipai/shared";
import { authApi } from "@/api/auth";
import { instanceSettingsApi } from "@/api/instanceSettings";
import { queryKeys } from "@/lib/queryKeys";
import { translateKey, translateText } from "@/lib/i18n";
import {
  getOptimisticUiLanguage,
  setCurrentUiLanguage,
} from "@/lib/ui-language";

interface I18nContextValue {
  locale: UiLanguage;
  t: (key: string, params?: Record<string, string | number | null | undefined>) => string;
  translateText: (value: string) => string;
  setLocale: (locale: UiLanguage, options?: { persist?: boolean }) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLanguage>(() => getOptimisticUiLanguage());

  const applyLocale = useCallback((nextLocale: UiLanguage, options: { persist?: boolean } = {}) => {
    setLocaleState(nextLocale);
    setCurrentUiLanguage(nextLocale, options);
  }, []);

  useEffect(() => {
    setCurrentUiLanguage(locale, { persist: false });
  }, [locale]);

  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });

  const generalSettingsQuery = useQuery({
    queryKey: queryKeys.instance.generalSettings,
    queryFn: () => instanceSettingsApi.getGeneral(),
    enabled: Boolean(sessionQuery.data),
    retry: false,
  });

  useEffect(() => {
    const effectiveLocale = generalSettingsQuery.data?.effectiveUiLanguage;
    if (!effectiveLocale || effectiveLocale === locale) return;
    applyLocale(effectiveLocale, {
      persist: generalSettingsQuery.data?.uiLanguage !== null,
    });
  }, [applyLocale, generalSettingsQuery.data?.effectiveUiLanguage, generalSettingsQuery.data?.uiLanguage, locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    t: (key, params) => translateKey(key, params, locale),
    translateText: (value) => translateText(value, locale),
    setLocale: applyLocale,
  }), [applyLocale, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
