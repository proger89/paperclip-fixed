# Telegram Channel Connector

Bundled Paperclip plugin for Telegram channel publishing.

What it adds:

- company-level Telegram dashboard
- issue-level Telegram draft, approval, and publish handoff
- settings UI with inline bot-token secret bootstrap
- final Telegram publication tracking through issue work products

Recommended flow:

1. Install the plugin from the bundled plugins catalog.
2. Store the bot token as a company secret in plugin settings.
3. Configure the default Telegram channel or chat id.
4. On an issue, save a Telegram draft output.
5. Request `publish_content` approval.
6. After approval, publish the final message from the Telegram issue tab.

The plugin intentionally keeps final publishing board-driven. It does not bypass Paperclip approval gates.
