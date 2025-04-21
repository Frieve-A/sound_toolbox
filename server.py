from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    server_address = ('', 8000)
    httpd = ThreadingHTTPServer(server_address, NoCacheHTTPRequestHandler)
    print('Serving HTTP on port 8000 (Press CTRL+C to quit)...')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('Server stopped.')
