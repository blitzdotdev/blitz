export const DEFAULT_EDITOR_ORIGINS = [
  "https://blitz-editor.blitzapp.workers.dev",
  "http://localhost:5173",
];

export function allowedEditorOrigin(origin: string | null, configured?: string): string | null {
  if (!origin) return null;
  const origins = configured
    ? configured.split(",").map((value) => value.trim()).filter(Boolean)
    : DEFAULT_EDITOR_ORIGINS;
  return origins.includes(origin) ? origin : null;
}

export function addEditorCors(response: Response, origin: string): Response {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Expose-Headers", "ETag, X-Blitz-State");
  appendVary(response.headers, "Origin");
  return response;
}

export function editorPreflight(request: Request, origin: string): Response {
  const method = request.headers.get("Access-Control-Request-Method")?.toUpperCase();
  const allowed = method === "GET" || method === "HEAD";
  const response = new Response(allowed ? null : "Method Not Allowed", {
    status: allowed ? 204 : 405,
    headers: {
      "Access-Control-Allow-Methods": "GET, HEAD",
      "Allow": "GET, HEAD",
    },
  });
  return addEditorCors(response, origin);
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get("Vary");
  const values = existing?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  headers.set("Vary", values.join(", "));
}
