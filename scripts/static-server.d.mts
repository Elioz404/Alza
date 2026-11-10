// Types for static-server.mjs, so the tests can import it from the browser-typed project
// without pulling Node's ambient types into the app.

export interface RequestLike {
  url?: string;
}

export interface ResponseLike {
  statusCode: number;
  readonly headersSent: boolean;
  setHeader(name: string, value: string): unknown;
  end(body?: unknown): unknown;
}

export declare const CONTENT_TYPES: Readonly<Record<string, string>>;

export declare function resolveRequestFile(
  root: string,
  rawUrl: string,
): { status: 200; file: string; path: string } | { status: 400 | 403; reason: string; path: string };

export declare function createStaticHandler(options: {
  root: string;
  headersFor: (path: string) => Record<string, string>;
}): (req: RequestLike, res: ResponseLike) => Promise<void>;
