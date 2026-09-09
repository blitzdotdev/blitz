self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // only intercept our virtual FS prefix
    if (!url.pathname.startsWith("/fs/")) return;

    const relPath = url.pathname.slice("/fs/".length);

    event.respondWith(
        new Promise((resolve) => {
            const channel = new MessageChannel();

            channel.port1.onmessage = (msgEvent) => {
                const { ok, body, init, error } = msgEvent.data || {};
                if (ok && body) {
                    resolve(new Response(body, init));
                } else {
                    resolve(new Response("/* " + (error || "Not found") + " */", {
                        status: 404,
                        headers: { "Content-Type": "text/plain" },
                    }));
                }
            };

            // todo incase of multiple projects we need to find the right client
            // ask the page to resolve the file
            self.clients.matchAll({ type: "window", includeUncontrolled: true })
                .then((clients) => {
                    if (clients.length === 0) {
                        resolve(new Response("/* no client */", { status: 500 }));
                    } else {
                        clients[0].postMessage(
                            { type: "RESOLVE_FILE", path: relPath, port: channel.port2 },
                            [channel.port2]
                        );
                    }
                });
        })
    );
});
