"""Serviço local do MVP. Somente biblioteca padrão do Python."""
import argparse
from contextlib import closing
import hmac
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
import time
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
RETENCAO_HORAS = 48
ARQUIVOS = {'/': ('tutora.html', 'text/html; charset=utf-8'),
            '/portal.css': ('portal.css', 'text/css; charset=utf-8'),
            '/portal.js': ('portal.js', 'text/javascript; charset=utf-8'),
            '/icone.svg': ('icone.svg', 'image/svg+xml')}


def limpar_expirados(db, instante=None):
    limite = ((instante or datetime.now(timezone.utc)) - timedelta(hours=RETENCAO_HORAS)).isoformat()
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        return con.execute('DELETE FROM pedidos WHERE julianday(recebido) <= julianday(?)', (limite,)).rowcount



def preparar(pasta):
    pasta.mkdir(parents=True, exist_ok=True)
    segredo = pasta / 'acesso.txt'
    if not segredo.exists():
        segredo.write_text(secrets.token_urlsafe(18), encoding='utf-8')
    db = pasta / 'pedidos.sqlite3'
    with closing(sqlite3.connect(db)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS pedidos (id TEXT PRIMARY KEY, frase TEXT NOT NULL, dispositivo TEXT NOT NULL, recebido TEXT NOT NULL, confirmado INTEGER NOT NULL DEFAULT 0)')
        colunas = {row[1] for row in con.execute('PRAGMA table_info(pedidos)')}
        for nome, definicao in [('estado', "TEXT NOT NULL DEFAULT 'novo'"), ('prioridade', "TEXT NOT NULL DEFAULT 'normal'"), ('atualizado', 'TEXT')]:
            if nome not in colunas:
                con.execute(f'ALTER TABLE pedidos ADD COLUMN {nome} {definicao}')
        con.execute("UPDATE pedidos SET estado='recebido' WHERE confirmado=1 AND estado='novo'")
        con.execute('UPDATE pedidos SET atualizado=recebido WHERE atualizado IS NULL')
        con.execute('CREATE INDEX IF NOT EXISTS idx_pedidos_recebido ON pedidos(recebido)')
    limpar_expirados(db)
    return db, segredo.read_text(encoding='utf-8').strip()


def criar_servidor(endereco, pasta):
    db, segredo = preparar(Path(pasta))

    class Servidor(ThreadingHTTPServer):
        daemon_threads = True
        ultima_limpeza = 0

        def service_actions(self):
            if time.monotonic() - self.ultima_limpeza >= 60:
                limpar_expirados(db)
                self.ultima_limpeza = time.monotonic()

    class Handler(BaseHTTPRequestHandler):
        def responder(self, status, valor):
            corpo = json.dumps(valor, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Length', str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)

        def autorizado(self):
            if hmac.compare_digest(self.headers.get('X-Codigo', '').encode('utf-8'), segredo.encode('utf-8')):
                return True
            self.responder(401, {'erro': 'Código de acesso incorreto.'})
            return False

        def do_GET(self):
            rota = urlsplit(self.path).path
            if rota in ARQUIVOS:
                nome, tipo = ARQUIVOS[rota]
                corpo = (ROOT / nome).read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', tipo)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
                self.send_header('Content-Length', str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)
            elif rota in ('/api/pedidos', '/api/config'):
                if not self.autorizado():
                    return
                if rota == '/api/config':
                    self.responder(200, {'retencao_horas': RETENCAO_HORAS})
                    return
                limpar_expirados(db)
                with closing(sqlite3.connect(db, timeout=10)) as con:
                    con.row_factory = sqlite3.Row
                    rows = con.execute('SELECT * FROM pedidos ORDER BY recebido ASC, id ASC').fetchall()
                self.responder(200, [dict(row) for row in rows])
            else:
                self.responder(404, {'erro': 'Página não encontrada.'})

        def do_POST(self):
            if not self.autorizado():
                return
            try:
                tamanho = int(self.headers.get('Content-Length', '0'))
                if tamanho < 1 or tamanho > 4096:
                    raise ValueError()
                dados = json.loads(self.rfile.read(tamanho))
                if not isinstance(dados, dict):
                    raise ValueError()
                rota = urlsplit(self.path).path
                limpar_expirados(db)
                with closing(sqlite3.connect(db, timeout=10)) as con, con:
                    if rota == '/api/pedidos':
                        for chave, limite in [('id', 80), ('frase', 200), ('dispositivo', 80)]:
                            if not isinstance(dados.get(chave), str) or not 0 < len(dados[chave].strip()) <= limite:
                                raise ValueError()
                        prioridade = dados.get('prioridade', 'ajuda' if 'ajuda' in dados['frase'].casefold() else 'normal')
                        if prioridade not in ('normal', 'ajuda'):
                            raise ValueError()
                        instante = datetime.now(timezone.utc).isoformat()
                        con.execute('INSERT OR IGNORE INTO pedidos (id, frase, dispositivo, recebido, prioridade, atualizado) VALUES (?, ?, ?, ?, ?, ?)',
                                    (dados['id'], dados['frase'].strip(), dados['dispositivo'].strip(), instante, prioridade, instante))
                    elif rota in ('/api/confirmar', '/api/atender'):
                        if not isinstance(dados.get('id'), str) or not dados['id']:
                            raise ValueError()
                        row = con.execute('SELECT estado FROM pedidos WHERE id=?', (dados['id'],)).fetchone()
                        if not row:
                            self.responder(404, {'erro': 'Este pedido expirou ou não existe mais.'})
                            return
                        estado = row[0]
                        if rota == '/api/atender' and estado == 'novo':
                            self.responder(409, {'erro': 'Confirme o recebimento antes de marcar como atendido.'})
                            return
                        proximo = 'atendido' if rota == '/api/atender' else 'recebido'
                        if estado not in ('atendido', proximo):
                            con.execute('UPDATE pedidos SET estado=?, confirmado=1, atualizado=? WHERE id=?',
                                        (proximo, datetime.now(timezone.utc).isoformat(), dados['id']))
                    else:
                        self.responder(404, {'erro': 'Rota não encontrada.'})
                        return
                self.responder(200, {'ok': True})
            except (ValueError, UnicodeError):
                self.responder(400, {'erro': 'Pedido inválido.'})

            except sqlite3.Error:
                self.responder(503, {'erro': 'Não foi possível salvar agora. Tente novamente.'})

        def log_message(self, *_):
            pass

    return Servidor(endereco, Handler), segredo


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--porta', type=int, default=8765)
    parser.add_argument('--dados', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    servidor, segredo = criar_servidor(('0.0.0.0', args.porta), args.dados)
    print(f'Painel neste computador: http://localhost:{args.porta}', flush=True)
    print(f'Código de acesso: {segredo}', flush=True)
    try:
        for ip in sorted({x[4][0] for x in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}):
            if not ip.startswith('127.'):
                print(f'Possível endereço para o celular: http://{ip}:{args.porta}', flush=True)
    except OSError:
        pass
    print('No celular, use o IP do Raspberry na mesma rede. Ctrl+C encerra.', flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
