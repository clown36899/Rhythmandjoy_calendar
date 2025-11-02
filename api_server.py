#!/usr/bin/env python3
"""간단한 API 서버 - sync 엔드포인트만 제공"""

from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import subprocess
import sys

class SyncHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_POST(self):
        """동기화 실행"""
        if self.path == '/sync':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            try:
                # Python 스크립트 실행
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
        """헬스 체크"""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'ok'}).encode())
        else:
            self.send_error(404)

if __name__ == '__main__':
    server = HTTPServer(('0.0.0.0', 8000), SyncHandler)
    print('🚀 API 서버 시작: http://0.0.0.0:8000')
    print('   POST /sync - 동기화 실행')
    print('   GET /health - 상태 확인')
    server.serve_forever()
