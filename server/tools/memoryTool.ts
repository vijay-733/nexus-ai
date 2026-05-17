import { toolRegistry }  from './registry.js';
import { remember, recall, forget } from '../memory/memoryManager.js';
import { logger }        from '../utils/logger.js';

// Memory tool: allows agents to read/write/delete from the persistent memory store.
// Tool input format: "<operation> <namespace> <key> [value_json]"
//   operation: read | write | delete | list

toolRegistry.register({
  name:        'memory-read',
  description: 'Read a value from persistent agent memory. Input: "namespace key"',
  cost:        1,
  handler: async (params) => {
    const parts     = params.prompt.trim().split(/\s+/);
    const namespace = parts[0] ?? 'default';
    const key       = parts.slice(1).join(' ') || 'default';

    logger.info('memory-tool', `READ ns=${namespace} key=${key}`);

    const value = await recall(namespace, key);
    const content = value !== null
      ? `Memory [${namespace}/${key}]: ${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}`
      : `No memory found for [${namespace}/${key}]`;

    return { type: 'text', content, provider: 'memory', model: 'memory-engine' };
  },
});

toolRegistry.register({
  name:        'memory-write',
  description: 'Write a value to persistent agent memory. Input: "namespace key value_as_text"',
  cost:        1,
  handler: async (params, ..._rest) => {
    // Format: "namespace key value..."
    const parts     = params.prompt.trim().split(/\s+/);
    const namespace = parts[0] ?? 'default';
    const key       = parts[1] ?? 'default';
    const rawValue  = parts.slice(2).join(' ');

    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue; // store as plain string
    }

    logger.info('memory-tool', `WRITE ns=${namespace} key=${key}`);

    await remember(namespace, key, value, {
      tags: ['agent-written'],
      userId: (params as Record<string, unknown>)['userId'] as string | undefined,
    });

    return {
      type:     'text',
      content:  `Stored to memory [${namespace}/${key}]: ${String(rawValue).slice(0, 200)}`,
      provider: 'memory',
      model:    'memory-engine',
    };
  },
});

toolRegistry.register({
  name:        'memory-delete',
  description: 'Delete a value from persistent agent memory. Input: "namespace key"',
  cost:        1,
  handler: async (params) => {
    const parts     = params.prompt.trim().split(/\s+/);
    const namespace = parts[0] ?? 'default';
    const key       = parts.slice(1).join(' ') || 'default';

    logger.info('memory-tool', `DELETE ns=${namespace} key=${key}`);

    const deleted = await forget(namespace, key);
    return {
      type:     'text',
      content:  deleted
        ? `Deleted memory [${namespace}/${key}]`
        : `No memory found for [${namespace}/${key}]`,
      provider: 'memory',
      model:    'memory-engine',
    };
  },
});
