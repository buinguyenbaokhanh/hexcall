"""
Read-only API serving the published stats artifacts.

This server does NOT talk to Riot. It only serves files that publish.py wrote.
That separation is the whole point: crawling is slow and rate-limited, serving
is fast and unlimited, and your API key never leaves the crawler process.

Endpoints
---------
  GET /api/manifest            available slices, sample sizes, freshness
  GET /api/stats/<slice_id>    a full stats artifact
  GET /api/item-meta           item tooltip content (shared, not per-slice)
  GET /api/champion-meta       champion roster: cost/role/traits/stats/ability
  GET /api/augment-meta        augment pool: rarity + description
  GET /api/comp/<slice>/<slug> per-comp build detail
  GET /api/health              liveness + staleness check

Caching
-------
Artifacts are immutable per build, so responses carry a strong ETag and a
long-ish max-age. Clients that send If-None-Match get a 304 and transfer
nothing. With ~20 KB gzipped payloads and a 6-hour refresh cycle, this scales
to a lot of users on very little infrastructure.

Production notes
----------------
* Run behind gunicorn/uvicorn, not the dev server.
* Better still, skip this server entirely: publish.py's output directory is
  static files. Push `public/current/` to S3+CloudFront, Cloudflare R2, or
  Netlify and serve it from the CDN edge for free. Use this server when you
  want request-time filtering or usage metrics.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

from flask import Flask, jsonify, request, Response

PUBLIC_DIR = Path("public")
CURRENT = PUBLIC_DIR / "current"

# How old a build can get before /api/health reports degraded.
STALE_AFTER_SECONDS = 24 * 3600

app = Flask(__name__)


@app.after_request
def cors(resp: Response) -> Response:
    # The overlay and web app are different origins from the API.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "If-None-Match, Content-Type"
    resp.headers["Access-Control-Expose-Headers"] = "ETag"
    return resp


def _load(name: str) -> dict | None:
    path = CURRENT / f"{name}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _served(payload: dict, max_age: int = 900) -> Response:
    """Serve with a strong ETag so repeat fetches cost nothing.

    The ETag hashes the body rather than keying off generated_at + length.
    The reference catalogues (item-meta, champion-meta, augment-meta) carry no
    generated_at, so the old scheme collapsed to "0-<length>" for all of them
    -- republishing with new fields of a similar size produced an unchanged
    ETag, and clients kept serving a stale copy from cache for the full hour.
    """
    body = json.dumps(payload, separators=(",", ":"))
    etag = f'"{hashlib.sha256(body.encode()).hexdigest()[:16]}"'
    if request.headers.get("If-None-Match") == etag:
        r = Response(status=304)
        r.headers["ETag"] = etag
        return r
    r = Response(body, mimetype="application/json")
    r.headers["ETag"] = etag
    r.headers["Cache-Control"] = f"public, max-age={max_age}, stale-while-revalidate=86400"
    return r


@app.get("/api/manifest")
def manifest():
    m = _load("manifest")
    if not m:
        return jsonify({"error": "no build published yet"}), 503
    return _served(m, max_age=300)


@app.get("/api/stats/<slice_id>")
def stats(slice_id: str):
    if not slice_id.replace("-", "").isalnum():
        return jsonify({"error": "bad slice id"}), 400
    data = _load(slice_id)
    if not data:
        m = _load("manifest") or {}
        return jsonify({
            "error": f"unknown slice '{slice_id}'",
            "available": [s["id"] for s in m.get("slices", [])],
        }), 404
    return _served(data)


@app.get("/api/trends/<slice_id>")
def trends(slice_id: str):
    """Day-bucketed history for one slice. Separate from the stats payload
    because it's an order of magnitude larger and only the Trends tab reads
    it -- the place-change deltas the tier lists need ship inside the slice."""
    if not slice_id.replace("-", "").isalnum():
        return jsonify({"error": "bad slice id"}), 400
    data = _load(f"trends-{slice_id}")
    if not data:
        return jsonify({"error": f"no trends published for '{slice_id}'"}), 404
    return _served(data)


@app.get("/api/item-meta")
def item_meta():
    """Item tooltip content -- description, stats, crafting recipe. Set
    reference data, so it's one shared file rather than per-slice."""
    data = _load("item-meta")
    if not data:
        return jsonify({"error": "no item metadata published yet"}), 404
    return _served(data, max_age=3600)


@app.get("/api/champion-meta")
def champion_meta():
    """Champion filter/tooltip content -- cost, role, traits, portrait. Set
    reference data, so it's one shared file rather than per-slice."""
    data = _load("champion-meta")
    if not data:
        return jsonify({"error": "no champion metadata published yet"}), 404
    return _served(data, max_age=3600)


@app.get("/api/augment-meta")
def augment_meta():
    """The live set's full augment pool -- name, icon, rarity, description.
    Set reference data, so it's one shared file rather than per-slice."""
    data = _load("augment-meta")
    if not data:
        return jsonify({"error": "no augment metadata published yet"}), 404
    return _served(data, max_age=3600)


@app.get("/api/trait-meta")
def trait_meta():
    """Trait icons and breakpoints for the live set, keyed by both apiName and
    display name. Set reference data, so it's one shared file."""
    data = _load("trait-meta")
    if not data:
        return jsonify({"error": "no trait metadata published yet"}), 404
    return _served(data, max_age=3600)


@app.get("/api/comp/<slice_id>/<comp_slug>")
def comp_detail(slice_id: str, comp_slug: str):
    """Per-comp build detail. Served from the same published build as the stats,
    so a comp's detail can never be from a different crawl than its ranking."""
    if not slice_id.replace("-", "").isalnum() or not comp_slug.replace("-", "").isalnum():
        return jsonify({"error": "bad id"}), 400
    path = CURRENT / "comps" / slice_id / f"{comp_slug}.json"
    if not path.exists():
        return jsonify({"error": "no detail published for this comp"}), 404
    return _served(json.loads(path.read_text()), max_age=3600)


@app.get("/api/health")
def health():
    m = _load("manifest")
    if not m:
        return jsonify({"status": "no_data"}), 503
    age = int(time.time()) - m.get("generated_at", 0)
    stale = age > STALE_AFTER_SECONDS
    return jsonify({
        "status": "degraded" if stale else "ok",
        "build_age_seconds": age,
        "patch": m.get("patch"),
        "slices": len(m.get("slices", [])),
    }), (200 if not stale else 503)


# --- personal review ------------------------------------------------------
#
# Unlike the stats endpoints, this one DOES call Riot at request time, because
# it's per-user data that can't be precomputed. Two consequences:
#
#   * It burns your shared rate limit. Cache aggressively and rate-limit per
#     user, or this endpoint will starve the crawler.
#   * Riot's policy allows showing a player their OWN match history and stats.
#     Do not extend this to look up arbitrary opponents during a game -- lobby
#     scouting during gameplay is explicitly prohibited.

REVIEW_CACHE: dict[str, tuple[float, dict]] = {}
REVIEW_TTL = 600  # seconds

# Per-client throttle. One review costs several Riot calls (account lookup,
# match id list, then one fetch per match), all against the same key the
# crawler uses -- so without a cap a single user hammering refresh can starve
# the crawl. A fixed window is enough here and needs no dependencies.
REVIEW_RATE_LIMIT = 5          # requests ...
REVIEW_RATE_WINDOW = 300       # ... per this many seconds, per client
_review_hits: dict[str, list[float]] = {}


def _client_id() -> str:
    """Best-effort client identity for throttling.

    X-Forwarded-For is only trustworthy behind a proxy that sets it; take the
    left-most entry when present and fall back to the socket address. This is
    a fair-use throttle, not a security control -- a determined caller can
    rotate addresses, which is what Riot's own key-level rate limiting is for.
    """
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote_addr or "unknown"


def _rate_limited(client: str) -> int:
    """Returns seconds to wait, or 0 when the caller is within budget."""
    now = time.time()
    hits = [t for t in _review_hits.get(client, []) if now - t < REVIEW_RATE_WINDOW]
    if len(hits) >= REVIEW_RATE_LIMIT:
        _review_hits[client] = hits
        return int(REVIEW_RATE_WINDOW - (now - hits[0])) + 1
    hits.append(now)
    _review_hits[client] = hits
    # Opportunistic cleanup so the dict can't grow without bound.
    if len(_review_hits) > 10_000:
        for k in [k for k, v in _review_hits.items()
                  if not any(now - t < REVIEW_RATE_WINDOW for t in v)]:
            del _review_hits[k]
    return 0


@app.get("/api/review")
def review():
    from riot_client import RiotTFTClient, PLATFORM_TO_REGION
    from review import fetch_history, analyse_all, RANKED_QUEUE

    riot_id = request.args.get("riot_id", "")
    platform = request.args.get("platform", "na1")
    slice_id = request.args.get("slice", "global-apex")
    count = min(int(request.args.get("count", 20)), 30)
    # Queue tabs. "all" analyses every queue together; anything else is a queue
    # id. Only the selected queue drives the summary and leaks -- the breakdown
    # in the response covers everything fetched either way.
    q_arg = request.args.get("queue", str(RANKED_QUEUE))
    try:
        queue = None if q_arg == "all" else int(q_arg)
    except ValueError:
        return jsonify({"error": f"bad queue '{q_arg}' -- use a queue id or 'all'"}), 400

    if "#" not in riot_id:
        return jsonify({"error": "riot_id must look like GameName#TAG"}), 400
    if platform not in PLATFORM_TO_REGION:
        return jsonify({"error": f"unknown platform '{platform}'"}), 400

    # Cache first: a repeat of the same lookup costs Riot nothing, so it
    # shouldn't cost the caller any of their budget either.
    key = f"{riot_id}|{platform}|{slice_id}|{count}"
    hit = REVIEW_CACHE.get(key)
    if hit and time.time() - hit[0] < REVIEW_TTL:
        return _served(hit[1], max_age=REVIEW_TTL)

    retry_after = _rate_limited(_client_id())
    if retry_after:
        r = jsonify({
            "error": "Too many review requests. This endpoint calls Riot live and "
                     "shares one rate limit with the crawler.",
            "retry_after_seconds": retry_after,
        })
        r.status_code = 429
        r.headers["Retry-After"] = str(retry_after)
        return r

    stats = _load(slice_id) or _load("global-all")
    if not stats:
        return jsonify({"error": "no published stats to compare against"}), 503

    name, tag = riot_id.rsplit("#", 1)
    try:
        client = RiotTFTClient()
        puuid, matches = fetch_history(client, platform, name, tag, count, queue=queue)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    result = analyse_all(puuid, matches, stats)
    result["generated_at"] = int(time.time())
    REVIEW_CACHE[key] = (time.time(), result)
    return _served(result, max_age=REVIEW_TTL)


if __name__ == "__main__":
    app.run(port=8787, debug=False)
