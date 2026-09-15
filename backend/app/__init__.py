"""Flask 앱 팩토리."""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend")


def create_app():
    app = Flask(__name__, static_folder=None)
    CORS(app)

    from .api.routes import bp as api_bp
    app.register_blueprint(api_bp)

    # 개발 편의: Flask가 프론트엔드도 함께 서빙 (별도 서버 불필요)
    @app.get("/")
    def index():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/<path:filename>")
    def static_files(filename):
        return send_from_directory(FRONTEND_DIR, filename)

    return app
