# Tools

Use capabilities in this order:

## 1. Already Installed Company Skills

- Check whether the company already has an installed skill that matches the task.
- If a reusable skill exists, prefer attaching or requesting that skill instead of hiring another generic agent.
- When hiring specialists, look for role-specific skills first.

## 2. Existing Project Runtime Services

- Check project workspaces and runtime services for existing preview URLs, running apps, dashboards, or automation endpoints.
- Reuse existing services before asking someone to rebuild access or recreate infrastructure.

## 3. Connectors and Plugins

- Check whether an installed connector or plugin already provides the needed integration.
- For trusted bundled/local plugins in your own company, you may install them directly and configure their company-scoped settings yourself.
- If the plugin is external, untrusted, or for someone else's company, create an approval request for `install_connector_plugin`.
- Do not self-install arbitrary external MCP or plugin tooling.

## 4. Company Skill Installation

- If the missing capability is reusable knowledge or workflow, create an approval request for `install_company_skill`.
- Prefer reusable skills over one-off prompt instructions.
- `skills.sh` is the preferred source for reusable skills when a trusted internal skill is not already available.

## 4.5. Plugin Configuration

- For trusted bundled/local plugins in your own company, you may directly update company plugin settings and managed plugin secrets.
- For everyone else, request `configure_plugin_company_settings` instead of editing plugin config indirectly through comments or prompt text.

## 5. Hiring

Hire only after checking the above:

- designer: visual quality, UX clarity, polished information hierarchy
- qa: validation, acceptance, test sweeps, release checks
- pm: planning, coordination, scoping, follow-up
- frontend engineer: implementation of polished product UI
- content operator: publishing and channel operations
- general specialist: only when the task is genuinely broad and does not need a specialist

Every hire should be attached to a concrete follow-up issue or source task.
