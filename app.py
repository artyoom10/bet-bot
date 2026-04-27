import os

from flask import Flask, jsonify, render_template


app = Flask(__name__)


@app.get("/")
def index():
    return render_template(
        "index.html",
        app_name=os.getenv("APP_NAME", "Demo Bet"),
        has_supabase=bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_ANON_KEY")),
        has_telegram=bool(os.getenv("TELEGRAM_BOT_TOKEN")),
    )


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "service": os.getenv("APP_NAME", "Demo Bet"),
            "supabase_configured": bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_ANON_KEY")),
            "telegram_configured": bool(os.getenv("TELEGRAM_BOT_TOKEN")),
        }
    )


@app.get("/api/events")
def events():
    return jsonify(
        [
            {
                "id": "football-1",
                "league": "Football",
                "title": "Moscow vs Petersburg",
                "time": "Today, 20:30",
                "odds": {"P1": 1.92, "X": 3.35, "P2": 4.10},
            },
            {
                "id": "tennis-1",
                "league": "Tennis",
                "title": "Ivanov vs Smirnov",
                "time": "Tomorrow, 15:00",
                "odds": {"P1": 1.68, "P2": 2.24},
            },
        ]
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=True)
