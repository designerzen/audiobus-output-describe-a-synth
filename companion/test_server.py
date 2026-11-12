import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from server import make_handler, validate_request


class FakeGenerator:
    def generate(self, data):
        return {"model": "test-local", "candidates": [{"seed": seed, "pcm": [0.1] * 1600, "sampleRate": 16000} for seed in data["seeds"]]}


class CompanionTests(unittest.TestCase):
    def test_validation(self):
        self.assertEqual(validate_request({"prompt": "bark", "seeds": [1, 2]}), ("bark", [1, 2]))
        for seeds in [[], [True], [-1], [2**32], [1] * 5]:
            with self.assertRaises(ValueError):
                validate_request({"prompt": "bark", "seeds": seeds})

    def test_http_origin_and_generation_contract(self):
        server = HTTPServer(("127.0.0.1", 0), make_handler(FakeGenerator(), "http://127.0.0.1:5173"))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/generate"
            body = json.dumps({"prompt": "bark", "seeds": [12, 13]}).encode()
            good = urllib.request.Request(url, body, {"Content-Type": "application/json", "Origin": "http://127.0.0.1:5173"})
            with urllib.request.urlopen(good) as response:
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:5173")
                self.assertEqual(len(json.load(response)["candidates"]), 2)
            bad = urllib.request.Request(url, body, {"Content-Type": "application/json", "Origin": "https://unrelated.test"})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(bad)
            self.assertEqual(caught.exception.code, 403)
        finally:
            server.shutdown()
            worker.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
