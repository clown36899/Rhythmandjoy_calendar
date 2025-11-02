#!/usr/bin/env python3
import os
import sys
import json
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

class UnifiedHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        if self.path == '/api/sync':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            try:
                result = subprocess.run(
                    [sys.executable, 'sync_calendar.py'],
                    capture_output=True,
                    text=True,
                    timeout=300
                )
                
                response = {
                    'success': result.returncode == 0,
                    'output': result.stdout,
                    'error': result.stderr
                }
                
            except Exception as e:
                response = {
                    'success': False,
                    'error': str(e)
                }
            
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_error(404)
    
    def do_GET(self):
        if self.path == '/api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode())
        else:
            return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    os.chdir('www')
    server = HTTPServer(('0.0.0.0', 5000), UnifiedHandler)
    print('Server started on port 5000')
    server.serve_forever()
