#!/usr/bin/env python3
"""
간단한 동기화 서버 (Flask)
"""

from flask import Flask, jsonify
from flask_cors import CORS
import subprocess
import sys

app = Flask(__name__)
CORS(app)  # CORS 허용

@app.route('/sync', methods=['POST', 'GET'])
def sync():
    """동기화 실행"""
    try:
        # Python 스크립트 실행
        result = subprocess.run(
            [sys.executable, 'sync_calendar.py'],
            capture_output=True,
            text=True,
            timeout=300  # 5분 타임아웃
        )
        
        return jsonify({
            'success': result.returncode == 0,
            'output': result.stdout,
            'error': result.stderr
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    """헬스 체크"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=True)
