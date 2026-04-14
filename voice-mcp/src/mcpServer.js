import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod/v4';

import { addResolvedItems, getShoppingContext, resolveItems } from './service.js';

/** Exported for /health — keep in sync with McpServer serverInfo.version */
export const MCP_SERVER_VERSION = '0.2.2';

/** Exported for /health — must match registerTool names below */
export const MCP_TOOL_NAMES = [
  'get_shopping_context',
  'resolve_items',
  'add_resolved_items'
];

const categorySummarySchema = z.record(z.string(), z.object({
  currentList: z.array(z.string()),
  examples: z.array(z.string())
}));

const itemListSchema = z.array(
  z.string()
    .trim()
    .min(1)
    .max(80)
).min(1).max(25);

const resolvedItemSchema = z.object({
  spoken: z.string(),
  name: z.string(),
  category: z.string(),
  source: z.string().optional(),
  matchType: z.string(),
  confidence: z.number()
});

const skippedItemSchema = z.object({
  spoken: z.string(),
  reason: z.string()
});

const unresolvedItemSchema = z.object({
  spoken: z.string(),
  reason: z.string(),
  candidateCategories: z.array(z.string()).optional()
});

const categoryDecisionSchema = z.object({
  spoken: z.string(),
  category: z.string(),
  confidence: z.number().min(0).max(1)
});

const createTextContent = (payload) => [
  {
    type: 'text',
    text: JSON.stringify(payload, null, 2)
  }
];

export const createMcpServer = (env) => {
  const server = new McpServer(
    {
      name: 'shopping-list-voice-mcp',
      version: MCP_SERVER_VERSION
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerTool(
    'get_shopping_context',
    {
      description: 'Get the fixed shopping categories, compact examples of existing items by category, and the current list.',
      outputSchema: {
        categories: z.array(z.string()),
        categorySummary: categorySummarySchema
      }
    },
    async () => {
      const structuredContent = await getShoppingContext(env);
      return {
        content: createTextContent(structuredContent),
        structuredContent
      };
    }
  );

  server.registerTool(
    'resolve_items',
    {
      description: 'Resolve candidate shopping items against existing known items and categories. Skips items already on the list.',
      inputSchema: {
        items: itemListSchema.describe('Candidate item names already extracted from the user utterance.')
      },
      outputSchema: {
        resolved: z.array(resolvedItemSchema),
        skipped: z.array(skippedItemSchema),
        unresolved: z.array(unresolvedItemSchema),
        categoryContext: z.object({
          categories: z.array(z.string()),
          categorySummary: categorySummarySchema
        })
      }
    },
    async ({ items }) => {
      const structuredContent = await resolveItems(env, items);
      return {
        content: createTextContent(structuredContent),
        structuredContent
      };
    }
  );

  server.registerTool(
    'add_resolved_items',
    {
      description: 'Persist resolved shopping items. Optionally includes category decisions for novel unmatched items.',
      inputSchema: {
        items: itemListSchema.describe('Candidate item names already extracted from the user utterance.'),
        categoryDecisions: z.array(categoryDecisionSchema).max(25).optional().describe('Claude-selected categories for unresolved novel items.'),
        minimumCategoryConfidence: z.number().min(0).max(1).optional().describe('Minimum confidence required to auto-add novel items.'),
        addedByUid: z.string().max(50).optional().describe('Firebase UID of the user requesting the add. Attached to items for attribution.')
      },
      outputSchema: {
        added: z.array(resolvedItemSchema),
        skipped: z.array(skippedItemSchema),
        unresolved: z.array(unresolvedItemSchema),
        summary: z.string()
      }
    },
    async ({ items, categoryDecisions, minimumCategoryConfidence, addedByUid }) => {
      const structuredContent = await addResolvedItems(env, {
        items,
        categoryDecisions,
        minimumCategoryConfidence,
        addedByUid
      });

      return {
        content: createTextContent(structuredContent),
        structuredContent
      };
    }
  );

  return server;
};
