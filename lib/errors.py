from flask import jsonify
from werkzeug.exceptions import HTTPException


class AppError(Exception):
    def __init__(self, error: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.error = error
        self.message = message
        self.status_code = status_code


def error_response(error: Exception):
    if isinstance(error, AppError):
        return jsonify({"ok": False, "error": error.error, "message": error.message}), error.status_code

    if isinstance(error, HTTPException):
        return jsonify({"ok": False, "error": error.name, "message": error.description}), error.code or 500

    return jsonify({"ok": False, "error": "internal_error", "message": "Internal server error"}), 500
