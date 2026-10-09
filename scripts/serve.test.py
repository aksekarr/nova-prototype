import importlib.util
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("seni_server", Path(__file__).with_name("serve.py"))
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)


class ConfigTests(unittest.TestCase):
    def test_unconfigured_and_environment(self):
        self.assertIsNone(serve.load_agent_id(environ={}))
        self.assertEqual(serve.load_agent_id(environ={"SENI_AGENT_ID": "agent_synthetic_only"}), "agent_synthetic_only")
        self.assertEqual(serve.load_agent_id(environ={"SENI_AGENT_ID": " Synthetic-legacy_123 "}), "Synthetic-legacy_123")

    def test_external_file_and_environment_precedence(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            repo = directory / "repo"
            repo.mkdir()
            config = directory / "config.json"
            config.write_text(json.dumps({"agentId": "agent_synthetic_file"}))
            self.assertEqual(serve.load_agent_id(repo, config, {}), "agent_synthetic_file")
            self.assertEqual(serve.load_agent_id(repo, config, {"SENI_AGENT_ID": "agent_synthetic_environment"}),
                             "agent_synthetic_environment")

    def test_paths_inside_repo_and_symlink_targets_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            repo = directory / "repo"
            repo.mkdir()
            inside = repo / "config.json"
            outside = directory / "config.json"
            for config in (inside, outside):
                config.write_text(json.dumps({"agentId": "agent_synthetic_only"}))
            inward_link = directory / "inward.json"
            inward_link.symlink_to(inside)
            outward_link = repo / "outward.json"
            outward_link.symlink_to(outside)
            for candidate in (inside, inward_link, outward_link):
                with self.subTest(candidate=candidate), self.assertRaisesRegex(serve.ConfigError, "outside the repository"):
                    serve.load_agent_id(repo, candidate, {})

    def test_invalid_config_is_rejected_without_echoing_contents(self):
        for value in ("", None, 42, "bad private value", "../private", "a" * 129):
            with self.subTest(value=value), self.assertRaisesRegex(serve.ConfigError, "valid public agent identifier"):
                serve.validate_agent_id(value)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            repo = directory / "repo"
            repo.mkdir()
            config = directory / "config.json"
            for body in ("private malformed JSON", "{}", "[]", '{"agentId":"agent_synthetic_only","extra":"private"}', "x" * 4097):
                config.write_text(body)
                with self.subTest(body=body[:20]), self.assertRaises(serve.ConfigError) as caught:
                    serve.load_agent_id(repo, config, {})
                self.assertNotIn("private", str(caught.exception))

    def request(self, agent_id, method="GET", path="/api/agent-config"):
        handler = object.__new__(serve.create_handler(serve.REPO_ROOT, agent_id))
        handler.path = path
        handler.wfile = BytesIO()
        handler.headers_sent = {}
        handler.status = None
        handler.send_response = lambda status: setattr(handler, "status", status)
        handler.send_header = lambda name, value: handler.headers_sent.update({name: value})
        handler.end_headers = lambda: None
        getattr(handler, "do_" + method)()
        return handler

    def test_runtime_endpoint_is_json_without_cache_and_head_has_no_body(self):
        for agent_id in (None, "agent_synthetic_only"):
            handler = self.request(agent_id)
            self.assertEqual(handler.status, 200)
            self.assertEqual(json.loads(handler.wfile.getvalue()), {"agentId": agent_id})
            self.assertEqual(handler.headers_sent["Cache-Control"], "no-store")
            self.assertIn("application/json", handler.headers_sent["Content-Type"])
            self.assertEqual(handler.headers_sent["Content-Length"], str(len(handler.wfile.getvalue())))
            head = self.request(agent_id, method="HEAD")
            self.assertEqual(head.wfile.getvalue(), b"")
            self.assertEqual(head.headers_sent, handler.headers_sent)

    def test_other_routes_keep_static_file_handling(self):
        with patch.object(serve.SimpleHTTPRequestHandler, "do_GET") as static:
            self.request(None, path="/lotus.html")
            static.assert_called_once()


if __name__ == "__main__":
    unittest.main()
