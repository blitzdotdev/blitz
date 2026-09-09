function errorPage(status: number, title: string, message: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const notFoundPage = () => errorPage(404, "Game not found", "No published game exists at this path.");
export const expiredPage = () => errorPage(410, "Game expired", "This anonymous Blitz game has expired.");
export const provisioningPage = () => errorPage(503, "Game is not ready", "The game is still being created.");
