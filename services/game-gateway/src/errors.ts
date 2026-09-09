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

export function publishingPage(): Response {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Publishing your game</title>
<style>
html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#0b0b0f;color:#fff;font:16px system-ui,sans-serif}
main{text-align:center}.spinner{width:38px;height:38px;margin:0 auto 18px;border:4px solid #ffffff33;border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><main><div class="spinner" aria-hidden="true"></div><p>Publishing your game</p></main>
<script>setInterval(async()=>{try{const response=await fetch(location.href,{cache:'no-store'});if(!response.headers.has('X-Blitz-State'))location.reload()}catch{}},2000)</script>
</body></html>`;
  return new Response(html, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "2",
      "Cache-Control": "no-store",
      "X-Blitz-State": "publishing",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
