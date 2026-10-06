# Local preview server for the glaze site: python3 serve.py
# Same as `python3 -m http.server`, but tells the browser not to cache,
# so a normal reload always picks up the latest HTML, CSS and JS together.
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"Serving on http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("", PORT), NoCacheHandler).serve_forever()
