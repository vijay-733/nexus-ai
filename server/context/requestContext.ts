import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  geminiKey?: string;
  openaiKey?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext {
  return requestContext.getStore() ?? {};
}
