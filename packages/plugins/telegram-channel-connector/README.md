# Telegram Channel Connector

Bundled Paperclip plugin for Telegram publishing plus Telegram task-bot workflows.

What it adds:

- company-level Telegram dashboard
- company-scoped Telegram settings with optional one-time legacy import
- Telegram task bot over `getUpdates` polling for private chats
- one-time link codes for chat-to-company binding
- task browsing, task creation, status changes, and reply-to-issue loops from Telegram
- approvals inbox, approval comments, board decisions, and personal approval resubmits from Telegram
- join request review and approval/rejection from Telegram
- budget incident review plus keep-paused / raise-and-resume flows from Telegram
- issue-level Telegram draft, approval, and publish handoff
- settings UI with inline bot-token secret bootstrap
- final Telegram publication tracking through issue work products

Recommended flow:

1. Install the plugin from the bundled plugins catalog.
2. Store the bot token as a company secret in plugin settings.
3. Configure the default Telegram channel or chat id plus task-bot policy.
4. Generate a Telegram link code and run `/start <code>` in a private chat with the bot.
5. Use `/inbox`, `/tasks`, `/blocked`, `/mine`, `/approvals`, `/myapprovals`, `/joins`, `/budgets`, `/task PAP-123`, and `/new` from Telegram when needed.
6. On an issue, save a Telegram draft output.
7. Request `publish_content` approval.
8. After approval, publish the final message from the Telegram issue tab.

The plugin intentionally keeps final publishing board-driven. It does not bypass Paperclip approval gates, and inbound Telegram task plus approval/join/budget control uses minute polling via `getUpdates`, not webhooks.
