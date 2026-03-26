import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { translateText } from "@/lib/i18n";
import { getCurrentUiLanguage } from "@/lib/ui-language";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<Breadcrumb[]>([]);

  const setBreadcrumbs = useCallback((crumbs: Breadcrumb[]) => {
    setBreadcrumbsState(crumbs);
  }, []);

  useEffect(() => {
    const locale = getCurrentUiLanguage();
    if (breadcrumbs.length === 0) {
      document.title = "Paperclip";
      return;
    }
    const parts = [...breadcrumbs].reverse().map((breadcrumb) => translateText(breadcrumb.label, locale));
    document.title = `${parts.join(" · ")} · Paperclip`;
  }, [breadcrumbs]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used within BreadcrumbProvider");
  }
  return ctx;
}
