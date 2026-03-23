import { Field, help } from "../components/agent-config-primitives";
import type { AdapterConfigFieldsProps } from "./types";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono";

export function LocalWorkspaceRuntimeFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  const value = isCreate
    ? values?.executionLocation ?? "container"
    : eff("adapterConfig", "executionLocation", String(config.executionLocation ?? "container"));

  return (
    <Field label="Execution location" hint={help.executionLocation}>
      <select
        className={inputClass}
        value={value}
        onChange={(event) => {
          const next = event.target.value === "host" ? "host" : "container";
          if (isCreate) {
            set?.({ executionLocation: next });
            return;
          }
          mark("adapterConfig", "executionLocation", next);
        }}
      >
        <option value="container">Container</option>
        <option value="host">Host bridge</option>
      </select>
    </Field>
  );
}
