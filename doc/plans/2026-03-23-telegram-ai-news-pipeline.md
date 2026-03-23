# Telegram AI News Pipeline Plan

## Context

We need a company-scoped workflow for:

1. ingesting AI news from Telegram channels
2. extracting the source claim and evidence
3. rewriting the draft into the author's house style
4. routing the draft through approval before publication
5. publishing only after explicit governance and safety checks

Paperclip already has the primitives we need:

- `routines` for scheduled or webhook ingestion
- `issues` as the execution and discussion object
- `documents` for source notes, rewrite drafts, and final copy
- `approvals` for board-governed release gates
- `issue_work_products` for outbound publication artifacts and links
- `activity_log` for auditability

The missing piece is a domain-level workflow contract for content publication.

## Decisions

### 1. Model the pipeline on existing control-plane primitives

Do not introduce a Telegram-specific subsystem first.

Map the workflow onto the existing model:

- `routine`
  - owns ingestion cadence or webhook trigger
- `routine_run`
  - represents one inbound news event
- `issue`
  - represents one candidate story through the editorial lifecycle
- `issue document`
  - stores source notes, rewrite drafts, and final copy
- `approval(type=publish_content)`
  - gates external publication
- `issue_work_product`
  - stores the publication URL or outbound channel artifact after publish

This keeps the workflow company-scoped, auditable, and visible in the board UI.

### 2. Keep editorial state in documents, not in approval payloads

Approval payloads should carry review metadata, not the full source of truth.

Use issue documents for:

- `source-notes`
- `style-brief`
- `draft`
- `final-copy`
- `publish-checklist`

Use the approval payload for pointers and decision-critical fields:

- channel
- target account or destination
- scheduled publish time
- author voice or style profile
- source summary
- safety notes or risk flags
- linked document ids or issue ids

### 3. Publication must be explicit and replay-safe

No automatic publish directly from ingestion.

Required sequence:

1. routine ingests Telegram post and creates or updates issue
2. rewrite agent prepares `draft` and `final-copy`
3. agent creates `publish_content` approval linked to the issue
4. board approves, rejects, or requests revision
5. only after approval may the publishing agent execute outbound publish
6. publish result is written back as a work product and activity event

### 4. Safety review is first-class

Each publish approval should carry enough structure for a human to answer:

- what is being claimed
- where it came from
- what was changed during rewrite
- where it will be published
- what risks remain

Minimum checklist before publish:

- source attribution captured
- claims and numbers checked
- style rewrite completed
- banned topics / unsafe language checked
- destination confirmed
- publish window confirmed

## Proposed Payload Contract for `publish_content`

Suggested payload shape:

```json
{
  "channel": "telegram",
  "destinationLabel": "@author_channel",
  "publishAt": "2026-03-23T18:00:00Z",
  "authorVoice": "sharp, concise, skeptical",
  "sourceSummary": "OpenAI released ...",
  "draftExcerpt": "Short excerpt for board review",
  "finalDocumentId": "uuid",
  "draftDocumentId": "uuid",
  "sourceDocumentId": "uuid",
  "riskFlags": ["unverified metric", "needs source link"],
  "safetyChecks": ["claims_checked", "style_checked", "links_checked"]
}
```

The server does not need to hard-enforce this entire shape in the first iteration, but the UI should render it clearly.

## Short Iteration Plan

### Iteration 1

- add `publish_content` approval type to shared contracts
- render publish approvals explicitly in the board UI
- document the editorial workflow and payload contract

### Iteration 2

- add issue document conventions to prompts and operating docs
- create a routine template for Telegram webhook ingestion
- create a publish checklist document template

### Iteration 3

- persist outbound publish results as `issue_work_products`
- add safe publisher agent behavior that refuses to publish without an approved linked approval
- add regression tests for approval-gated publishing

## Tasks

### Now

- [ ] Add `publish_content` approval contract
- [ ] Add approval UI rendering for content publication review
- [ ] Document the payload contract and workflow

### Next

- [ ] Define canonical issue document keys for editorial work
- [ ] Add Telegram webhook routine template
- [ ] Add publisher guardrail: approved approval required before outbound publish

### Later

- [ ] Add duplicate-story detection across routine runs
- [ ] Add source trust scoring and escalation rules
- [ ] Add scheduled publish queue with cancellation and audit trail

## Known Blockers

### Product blocker

We do not yet have a canonical Paperclip-wide schema for outbound publication approvals. This iteration introduces `publish_content` as the first formal contract.

### Integration blocker

Telegram ingestion and Telegram publication adapters are not implemented in this repo yet. For now, this plan assumes they will enter Paperclip through routine webhooks and agent-controlled outbound actions.

### Safety blocker

There is no server-side enforcement yet that blocks an agent from publishing unless a linked approval is approved. That should be addressed in a follow-up iteration before enabling unattended publication.
