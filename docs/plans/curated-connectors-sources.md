# Curated connectors: what was checked (AGENT-FLOW F4)

The list is `src/server/curatedPlugins.js`. Researcher checked each entry against the vendor's own documentation on 2026-11-20. Security reviews the list before a release; an entry is added, changed or dropped only with a release.

| Entry | URL | Sign-in | Official source |
|---|---|---|---|
| Notion | https://mcp.notion.com/mcp | the vendor's own sign-in | vendor documentation (Researcher's check; link to be added from the report) |
| Linear | https://mcp.linear.app/mcp | the vendor's own sign-in | vendor documentation (Researcher's check; link to be added from the report) |
| Sentry | https://mcp.sentry.dev/mcp | the vendor's own sign-in | vendor documentation (Researcher's check; link to be added from the report) |
| Atlassian (Jira and Confluence) | https://mcp.atlassian.com/v2/mcp | the vendor's own sign-in | support.atlassian.com, the upgrade page: v2 replaced v1 (`/v1/sse`), so the address is `/v2/mcp` |
| Stripe | https://mcp.stripe.com | the vendor's own sign-in | vendor documentation (Researcher's check; link to be added from the report) |
| Context7 | https://mcp.context7.com/mcp | none needed; an API key is optional, for higher limits | vendor documentation (Researcher's check; link to be added from the report) |
| DeepWiki | https://mcp.deepwiki.com/mcp | none | vendor documentation (Researcher's check; link to be added from the report) |
| Microsoft Learn | https://learn.microsoft.com/api/mcp | none | vendor documentation (Researcher's check; link to be added from the report) |

**Dropped:** Hugging Face (`https://huggingface.co/mcp`): its sign-in kind is not stated in the vendor's documentation, so it is not listed.

Every address is `https` on the vendor's own domain; none runs a program on the person's computer. Adding one still goes through `add_connector`: it arrives switched OFF and the person is asked.
