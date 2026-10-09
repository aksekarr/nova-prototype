#!/usr/bin/env python3
"""Serve Seni and a runtime-only public agent identifier using the standard library."""
import argparse
import json
import os
from pathlib import Path
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENT_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")


class ConfigError(ValueError):
    pass


def validate_agent_id(value):
    if not isinstance(value, str) or not AGENT_ID.fullmatch(value.strip()):
        raise ConfigError("Agent configuration must contain a valid public agent identifier.")
    return value.strip()


def outside_repo_path(path, repo_root):
    # Reject both a path in the checkout and an outside symlink into the checkout.
    candidate = Path(os.path.abspath(Path(path).expanduser()))
    resolved = candidate.resolve()
    root = Path(repo_root).resolve()
    if resolved == root or root in resolved.parents or any(parent.resolve() == root for parent in candidate.parents):
        raise ConfigError("The agent configuration file must be outside the repository.")
    return resolved


def load_agent_id(repo_root=REPO_ROOT, config_path=None, environ=None):
    environment = os.environ if environ is None else environ
    path = outside_repo_path(config_path, repo_root) if config_path else None
    value = environment.get("SENI_AGENT_ID", "")
    if value:
        return validate_agent_id(value)
    if path is None:
        return None
    try:
        # Only a tiny configuration object is expected; never surface its contents.
        with path.open("rb") as source:
            raw = source.read(4097)
        if len(raw) > 4096:
            raise ValueError()
        config = json.loads(raw)
    except (OSError, ValueError, UnicodeError):
        raise ConfigError("Could not read the external agent configuration.") from None
    if not isinstance(config, dict) or set(config) != {"agentId"}:
        raise ConfigError("Agent configuration must contain only an agentId field.")
    return validate_agent_id(config["agentId"])


def create_handler(repo_root, agent_id):
    directory = str(Path(repo_root).resolve())
    payload = json.dumps({"agentId": agent_id}, separators=(",", ":")).encode("utf-8")

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)

        def send_agent_config(self, head_only=False):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if not head_only:
                self.wfile.write(payload)

        def do_GET(self):
            if urlsplit(self.path).path == "/api/agent-config":
                self.send_agent_config()
            else:
                super().do_GET()

        def do_HEAD(self):
            if urlsplit(self.path).path == "/api/agent-config":
                self.send_agent_config(head_only=True)
            else:
                super().do_HEAD()

    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4173)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--agent-config", help="JSON file outside the repository, containing only agentId")
    args = parser.parse_args(argv)
    try:
        agent_id = load_agent_id(config_path=args.agent_config)
    except ConfigError as error:
        parser.error(str(error))
    with ThreadingHTTPServer((args.bind, args.port), create_handler(REPO_ROOT, agent_id)) as server:
        print(f"Seni preview: http://{args.bind}:{server.server_port}/", flush=True)
        print("Live agent configured." if agent_id else "Cached introduction only; no live agent configured.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
