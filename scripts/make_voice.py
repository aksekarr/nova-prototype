#!/usr/bin/env python3
"""Prepare Nova voice assets; preview by default, paid generation only with --go."""

import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import urllib.error
import urllib.request


VOICE_ID = "KoVIHoyLDrQyd4pGalbs"
MODEL_ID = "eleven_v4"
ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech/{}/with-timestamps".format(VOICE_ID)
VOICE_DIR = Path(__file__).resolve().parent.parent / "voice"


class VoiceError(Exception):
    """An error with a safe, single-line message for the user."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirect is a non-200 response; never forward the API key elsewhere.
        return None


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_lines():
    try:
        lines = json.loads((VOICE_DIR / "lines.json").read_text(encoding="utf-8"))
        if not isinstance(lines, list):
            raise ValueError
        seen = set()
        for line in lines:
            line_id = line["id"]
            if (not isinstance(line_id, str) or not line_id
                    or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for c in line_id)
                    or line_id in seen or not isinstance(line["text"], str)):
                raise ValueError
            seen.add(line_id)
        return lines
    except (OSError, ValueError, KeyError, TypeError):
        raise VoiceError("Could not read valid voice/lines.json.") from None


def is_current(line):
    try:
        metadata = json.loads((VOICE_DIR / (line["id"] + ".json")).read_text(encoding="utf-8"))
        return isinstance(metadata, dict) and metadata.get("text_sha256") == text_hash(line["text"])
    except (OSError, ValueError):
        return False


def read_key():
    try:
        key = (Path.home() / ".nova-key").read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        raise VoiceError("API key file ~/.nova-key is missing.") from None
    except (OSError, ValueError):
        raise VoiceError("Could not read API key file ~/.nova-key.") from None
    if not key:
        raise VoiceError("API key file ~/.nova-key is empty.")
    return key


def api_error(body, key):
    try:
        detail = json.loads(body).get("detail")
        message = detail.get("message") if isinstance(detail, dict) else detail
        if not isinstance(message, str) or not message.strip():
            raise ValueError
        # API error text is untrusted and could echo the credential.
        message = message.replace(key, "[redacted]") if key else message
        return " ".join(message.split())
    except (ValueError, AttributeError, TypeError):
        return "ElevenLabs returned an error without a detail message."


def fetch_response(text, key):
    request = urllib.request.Request(
        ENDPOINT,
        data=json.dumps({"text": text, "model_id": MODEL_ID}).encode("utf-8"),
        headers={"Content-Type": "application/json", "xi-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            body = response.read()
            if response.status != 200:
                raise VoiceError(api_error(body, key))
    except urllib.error.HTTPError as error:
        try:
            body = error.read()
        except Exception:
            raise VoiceError("Could not read the API error response.") from None
        finally:
            error.close()
        raise VoiceError(api_error(body, key)) from None
    except (urllib.error.URLError, OSError):
        raise VoiceError("Network error contacting ElevenLabs.") from None
    try:
        result = json.loads(body)
    except ValueError:
        raise VoiceError("ElevenLabs returned invalid JSON.") from None
    # Do not persist a response that unexpectedly echoes the API key.
    if key and key in json.dumps(result, ensure_ascii=False):
        raise VoiceError("ElevenLabs returned a response containing sensitive data.")
    return result


def write_response(line, response):
    if not isinstance(response, dict):
        raise VoiceError("Response must be a JSON object.")
    try:
        audio = base64.b64decode(response["audio_base64"], validate=True)
        if not audio:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        raise VoiceError("Response has missing or invalid audio_base64.") from None
    metadata = {key: value for key, value in response.items() if key != "audio_base64"}
    metadata.update(
        id=line["id"],
        text=line["text"],
        voice_id=VOICE_ID,
        model_id=MODEL_ID,
        text_sha256=text_hash(line["text"]),
        generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        alignment=response.get("alignment"),
        normalized_alignment=response.get("normalized_alignment"),
    )
    encoded = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    targets = [VOICE_DIR / (line["id"] + suffix) for suffix in (".mp3", ".json")]
    # Stage both files before replacing either, and restore previous assets if a
    # replacement fails. Invalid responses never touch existing output files.
    previous = [path.read_bytes() if path.exists() else None for path in targets]
    with tempfile.TemporaryDirectory(prefix=".nova-", dir=str(VOICE_DIR)) as temporary:
        staged = [Path(temporary) / path.name for path in targets]
        for path, data in zip(staged, (audio, encoded)):
            path.write_bytes(data)
        replaced = []
        try:
            for source, target, old in zip(staged, targets, previous):
                source.replace(target)
                replaced.append((target, old))
        except OSError:
            for target, old in reversed(replaced):
                if old is None:
                    target.unlink()
                else:
                    target.write_bytes(old)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--go", action="store_true", help="make paid ElevenLabs requests")
    modes.add_argument("--from-response", nargs=2, metavar=("PATH", "ID"),
                       help="import a saved response for an ID in voice/lines.json without network access")
    parser.add_argument("--force", action="store_true", help="regenerate even when the text hash matches")
    parser.add_argument("--only", metavar="ID", help="process only this line")
    args = parser.parse_args()
    if args.from_response and args.only:
        raise VoiceError("Use the ID after --from-response instead of --only.")

    lines = read_lines()
    selected_id = args.from_response[1] if args.from_response else args.only
    if selected_id is not None:
        lines = [line for line in lines if line["id"] == selected_id]
        if not lines:
            raise VoiceError("Requested ID is not in voice/lines.json.")
    pending = []
    for line in lines:
        if not args.force and is_current(line):
            print("{}: skipped (matching text_sha256)".format(line["id"]))
        else:
            pending.append(line)

    if args.from_response:
        if pending:
            try:
                response = json.loads(Path(args.from_response[0]).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise VoiceError("Could not read a valid saved response JSON file.") from None
            write_response(pending[0], response)
            print("{}: wrote MP3 and timing JSON".format(pending[0]["id"]))
        return
    if not args.go:
        for line in pending:
            print("{}: {} characters".format(line["id"], len(line["text"])))
        print("Total: {} lines, {} characters (dry run; no network calls).".format(
            len(pending), sum(len(line["text"]) for line in pending)))
        return

    if pending:
        key = read_key()
        for line in pending:
            write_response(line, fetch_response(line["text"], key))
            print("{}: wrote MP3 and timing JSON".format(line["id"]))


if __name__ == "__main__":
    try:
        main()
    except VoiceError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        # Never expose exception details or tracebacks, which may hold a key.
        print("Voice generation stopped; could not complete the operation.", file=sys.stderr)
        sys.exit(1)
