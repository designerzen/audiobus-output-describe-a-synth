from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
os.chdir(os.path.dirname(__file__))
class Handler(SimpleHTTPRequestHandler):
 extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'}
 def end_headers(self):
  self.send_header('Cross-Origin-Opener-Policy','same-origin')
  self.send_header('Cross-Origin-Embedder-Policy','require-corp')
  super().end_headers()
 def do_PUT(self):
  if self.path!='/result.wav':self.send_error(400);return
  Path('result.wav').write_bytes(self.rfile.read(int(self.headers['Content-Length'])))
  self.send_response(200);self.end_headers()
 def log_message(self,*args):pass
ThreadingHTTPServer(('127.0.0.1',8793),Handler).serve_forever()
