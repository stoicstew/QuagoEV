#!/usr/bin/env python3
"""Local-only fixture for native sync/offline UI acceptance. Never calls Tesla."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json

snapshot = json.loads((Path(__file__).resolve().parent.parent / 'QuagoEV/Resources/demo-snapshot.json').read_text())
snapshot['serverId'] = 'ios-integration-fixture'
snapshot['vehicles'][0]['name'] = 'Native fixture vehicle'
mode = 'online'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def respond(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
    def do_GET(self):
        if self.path == '/healthz': return self.respond(200, {'status': 'ok'})
        if self.path != '/api/v2/snapshot': return self.respond(404, {})
        if self.headers.get('Authorization') != 'Bearer native-test-access-key': return self.respond(401, {})
        if mode == 'offline': return self.respond(503, {'error': 'Fixture server unavailable'})
        self.respond(200, snapshot)
    def do_POST(self):
        global mode
        if self.path in ['/__mode/online', '/__mode/offline']:
            mode = self.path.split('/')[-1]
            return self.respond(200, {'mode': mode})
        self.respond(404, {})

print('Native fixture listening on 127.0.0.1:38417', flush=True)
ThreadingHTTPServer(('127.0.0.1', 38417), Handler).serve_forever()
