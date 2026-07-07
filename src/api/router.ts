import type { ApiContext } from "./context.js";

export type RouteParams = Record<string, string>;

export type RouteHandler = (ctx: ApiContext, params: RouteParams) => Promise<void>;

export type RouteDefinition = {
  method: string;
  pattern: string;
  handler: RouteHandler;
};

function splitPath(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function matchPattern(pattern: string, pathname: string): RouteParams | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: RouteParams = {};

  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];

    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
      continue;
    }

    if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}

export class Router {
  private readonly routes: RouteDefinition[] = [];

  add(route: RouteDefinition): this {
    this.routes.push(route);
    return this;
  }

  addAll(routes: RouteDefinition[]): this {
    for (const route of routes) {
      this.add(route);
    }
    return this;
  }

  async dispatch(ctx: ApiContext): Promise<boolean> {
    const method = ctx.request.method ?? "GET";
    const pathname = ctx.url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const params = matchPattern(route.pattern, pathname);
      if (params === null) {
        continue;
      }

      await route.handler(ctx, params);
      return true;
    }

    return false;
  }
}
