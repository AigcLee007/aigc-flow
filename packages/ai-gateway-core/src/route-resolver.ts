import { AiGatewayError } from "./errors.js";
import type { ResolvedRoute } from "./types.js";

export class RouteResolver {
  resolveTextRoute(options: {
    routeKey?: string | null;
    routes: ResolvedRoute[];
  }): ResolvedRoute {
    const candidates = options.routes.filter(
      (route) => route.status === "active",
    );

    const deduped = this.dedupeSystemRoutes(candidates);
    const filtered = options.routeKey?.trim()
      ? deduped.filter((route) => route.routeKey === options.routeKey?.trim())
      : deduped;

    const selected = [...filtered].sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }

      if (left.tenantId && !right.tenantId) {
        return -1;
      }

      if (!left.tenantId && right.tenantId) {
        return 1;
      }

      return left.routeId.localeCompare(right.routeId);
    })[0];

    if (!selected) {
      throw new AiGatewayError({
        code: "ROUTE_NOT_FOUND",
        message: "No active text route matched the request",
        statusCode: 404,
      });
    }

    return selected;
  }

  private dedupeSystemRoutes(routes: ResolvedRoute[]): ResolvedRoute[] {
    const byRouteKey = new Map<string, ResolvedRoute>();
    const withoutRouteKey: ResolvedRoute[] = [];

    for (const route of routes) {
      if (!route.routeKey) {
        withoutRouteKey.push(route);
        continue;
      }

      const existing = byRouteKey.get(route.routeKey);
      if (!existing) {
        byRouteKey.set(route.routeKey, route);
        continue;
      }

      if (route.tenantId && !existing.tenantId) {
        byRouteKey.set(route.routeKey, route);
      }
    }

    return [...byRouteKey.values(), ...withoutRouteKey];
  }
}
