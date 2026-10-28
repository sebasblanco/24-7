import threading
import time

from flask import Flask, jsonify, send_from_directory

import fetch

app = Flask(__name__, static_folder="static", static_url_path="")

CACHE_TTL = 15 * 60  # seconds
_cache = {"data": None, "fetched_at": 0}
_lock = threading.Lock()


def get_snapshot():
    now = time.time()
    with _lock:
        stale = _cache["data"] is None or (now - _cache["fetched_at"]) > CACHE_TTL
        if not stale:
            return _cache["data"]
    # Fetch outside the lock (network I/O) — a slightly racy double-fetch
    # under concurrent cold-start requests is fine for a personal dashboard.
    data = fetch.build_snapshot()
    with _lock:
        _cache["data"] = data
        _cache["fetched_at"] = now
    return data


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/snapshot")
def snapshot():
    return jsonify(get_snapshot())


if __name__ == "__main__":
    app.run(debug=True, port=5000)
