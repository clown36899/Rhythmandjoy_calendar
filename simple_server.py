#!/usr/bin/env python3
import os
import sys
import json
import subprocess
from http.server import HTTPServer, SimpleHTTPRequestHandler

class UnifiedHandler(SimpleHTTPRequestHandler):
    
    # ETag 완전 비활성화 (캐싱 방지)
    def send_header(self, keyword, value):
        # ETag와 Last-Modified 헤더 차단
        if keyword.lower() not in ('etag', 'last-modified'):
            SimpleHTTPRequestHandler.send_header(self, keyword, value)
    
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
                # 요청 body에서 선택된 연습실 확인
                content_length = int(self.headers.get('Content-Length', 0))
                selected_rooms = None
                
                if content_length > 0:
                    body = self.rfile.read(content_length)
                    try:
                        data = json.loads(body.decode('utf-8'))
                        selected_rooms = data.get('rooms')
                    except:
                        pass
                
                # Python 스크립트 실행
                cmd = [sys.executable, self.sync_script]
                if selected_rooms:
                    cmd.extend(selected_rooms)
                
                result = subprocess.run(
                    cmd,
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
            
        elif self.path == '/api/setup-watches':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            try:
                # Watch 채널 재설정 스크립트 실행
                result = subprocess.run(
                    [sys.executable, self.watch_script],
                    capture_output=True,
                    text=True,
                    timeout=60
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
    
    def end_headers(self):
        # 이미지 및 폰트 파일: 긴 캐시 (1년)
        if self.path.endswith(('.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.eot')):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        # CSS, JS, HTML 파일: 캐시 방지 (개발 중)
        elif self.path.endswith(('.css', '.js', '.html')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        SimpleHTTPRequestHandler.end_headers(self)
    
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
    # 스크립트 절대 경로 저장
    import pathlib
    base_path = pathlib.Path(__file__).parent
    
    # UnifiedHandler에서 사용할 수 있도록 클래스 변수로 설정
    UnifiedHandler.sync_script = str(base_path / 'sync_calendar.py')
    UnifiedHandler.watch_script = str(base_path / 'reset_watches.py')
    
    os.chdir('www')
    server = HTTPServer(('0.0.0.0', 5000), UnifiedHandler)
    print('Server started on port 5000')
    print('API endpoints:')
    print('  POST /api/sync - 동기화 실행')
    print('  POST /api/setup-watches - Watch 채널 재설정')
    print('  GET /api/health - 헬스 체크')
    server.serve_forever()
