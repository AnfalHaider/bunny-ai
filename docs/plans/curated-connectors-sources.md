# Curated connectors: what was checked (AGENT-FLOW F4)

The list is `src/server/curatedPlugins.js`. Researcher read each entry in the vendor's own documentation on 2026-11-20. Security reviews the list before a release; an entry is added, changed or dropped only with a release.

| Entry | URL | Sign-in | Official source |
|---|---|---|---|
| Notion | https://mcp.notion.com/mcp | OAuth | https://developers.notion.com/guides/mcp/get-started-with-mcp |
| Linear | https://mcp.linear.app/mcp | OAuth 2.1 (an API key also works) | https://linear.app/docs/mcp |
| Sentry | https://mcp.sentry.dev/mcp | OAuth | https://docs.sentry.io/product/sentry-mcp/ |
| Atlassian (Jira and Confluence) | https://mcp.atlassian.com/v2/mcp | OAuth 2.1 | https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/ and the upgrade page https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-mcp-v1-to-atlassian-mcp-v2/ (v2 replaced v1, `/v1/sse`) |
| Stripe | https://mcp.stripe.com | OAuth (or an agent API key as a bearer) | https://docs.stripe.com/mcp |
| Context7 | https://mcp.context7.com/mcp | none needed; an API key is optional, for higher limits | https://github.com/upstash/context7 |
| DeepWiki | https://mcp.deepwiki.com/mcp | none; public repositories only | https://docs.devin.ai/work-with-devin/deepwiki-mcp |
| Microsoft Learn | https://learn.microsoft.com/api/mcp | none | https://learn.microsoft.com/en-us/training/support/mcp |

**Dropped:** Hugging Face (`https://huggingface.co/mcp`): its sign-in kind is not stated in https://huggingface.co/docs/hub/agents-mcp, so it is not listed.

Every address is `https` on the vendor's own domain; none runs a program on the person's computer. Adding one still goes through `add_connector`: it arrives switched OFF and the person is asked.
