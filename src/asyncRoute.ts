// Express 4 does not forward a rejected promise from an async handler to the
// error middleware — it crashes the whole process (taking down every other
// teacher's connection), unlike FastAPI/uvicorn where one request's error stays
// isolated to that request. This wraps every handler registered on a router (or
// the app itself) so a thrown/rejected error is instead forwarded to `next()`.
import type { NextFunction, Request, RequestHandler, Response } from "express";

interface RouteRegistrar {
  get(path: string, ...handlers: RequestHandler[]): unknown;
  post(path: string, ...handlers: RequestHandler[]): unknown;
  put(path: string, ...handlers: RequestHandler[]): unknown;
  delete(path: string, ...handlers: RequestHandler[]): unknown;
  patch(path: string, ...handlers: RequestHandler[]): unknown;
}

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

function wrapHandler(handler: RequestHandler): RequestHandler {
  // Error-handling middleware (arity 4) must stay untouched.
  if (handler.length >= 4) return handler;
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = handler(req, res, next) as unknown;
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

/** Mutates `target` in place (also returns it) so every route registered afterwards is auto-caught. */
export function autoCatch<T extends RouteRegistrar>(target: T): T {
  for (const method of METHODS) {
    const original = target[method].bind(target);
    (target as unknown as Record<string, unknown>)[method] = (path: string, ...handlers: RequestHandler[]) =>
      original(path, ...handlers.map(wrapHandler));
  }
  return target;
}
