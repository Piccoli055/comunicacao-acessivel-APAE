"""Serviço local do MVP. Python, SQLite e Pillow para validar fotografias."""
import argparse
from comunicadores import preparar_comunicadores, listar_comunicadores, salvar_vinculo
from alunos import (preparar_alunos, listar_alunos, salvar_aluno, alterar_cadastro, ler_foto, ErroCadastro)
from contextlib import closing
import hmac
from http.cookies import SimpleCookie, CookieError
from acesso import (preparar_acesso, preparar_demo, autenticar, consultar_sessao, encerrar_sessao, ErroAcesso, DURACAO_SESSAO)
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
        return con.execute("DELETE FROM pedidos WHERE estado='atendido' AND julianday(atualizado) <= julianday(?)", (limite,)).rowcount



def preparar(pasta):
    pasta.mkdir(parents=True, exist_ok=True)
    segredo = pasta / 'acesso.txt'
    if not segredo.exists():
        segredo.write_text(secrets.token_urlsafe(18), encoding='utf-8')
    db = pasta / 'pedidos.sqlite3'
    with closing(sqlite3.connect(db)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS pedidos (id TEXT PRIMARY KEY, frase TEXT NOT NULL, dispositivo TEXT NOT NULL, recebido TEXT NOT NULL, confirmado INTEGER NOT NULL DEFAULT 0)')
        colunas = {row[1] for row in con.execute('PRAGMA table_info(pedidos)')}
        for nome, definicao in [('estado', "TEXT NOT NULL DEFAULT 'novo'"), ('prioridade', "TEXT NOT NULL DEFAULT 'normal'"), ('atualizado', 'TEXT'), ('aluno_id', 'TEXT'), ('aluno_nome', 'TEXT')]:
            if nome not in colunas:
                con.execute(f'ALTER TABLE pedidos ADD COLUMN {nome} {definicao}')
        con.execute("UPDATE pedidos SET estado='recebido' WHERE confirmado=1 AND estado='novo'")
        con.execute('UPDATE pedidos SET atualizado=recebido WHERE atualizado IS NULL')
        con.execute('CREATE INDEX IF NOT EXISTS idx_pedidos_recebido ON pedidos(recebido)')
    limpar_expirados(db)
    preparar_acesso(db)
    preparar_alunos(db)
    preparar_comunicadores(db)
    return db, segredo.read_text(encoding='utf-8').strip()


def criar_servidor(endereco, pasta, modo_demo=False):
    db, segredo = preparar(Path(pasta))
    if modo_demo:
        preparar_demo(db)

    class Servidor(ThreadingHTTPServer):
        daemon_threads = True
        ultima_limpeza = 0

        def service_actions(self):
            if time.monotonic() - self.ultima_limpeza >= 60:
                limpar_expirados(db)
                self.ultima_limpeza = time.monotonic()

    class Handler(BaseHTTPRequestHandler):
        def responder(self, status, valor, cookie=None):
            corpo = json.dumps(valor, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Length', str(len(corpo)))
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(corpo)

        def token_sessao(self):
            try:
                cookies = SimpleCookie(self.headers.get('Cookie', ''))
                return cookies['portal_sessao'].value if 'portal_sessao' in cookies else ''
            except CookieError:
                return ''

        def autorizado(self, aceitar_dispositivo=False):
            if consultar_sessao(db, self.token_sessao()):
                return True
            if aceitar_dispositivo and hmac.compare_digest(self.headers.get('X-Codigo', '').encode('utf-8'), segredo.encode('utf-8')):
                return True
            self.responder(401, {'erro': 'Entre com instituição, usuário e senha para continuar.'})
            return False

        def cookie(self, token='', apagar=False):
            return ('portal_sessao=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' +
                    ('0' if apagar else str(DURACAO_SESSAO)))

        def do_GET(self):
            rota = urlsplit(self.path).path
            if rota in ARQUIVOS:
                nome, tipo = ARQUIVOS[rota]
                corpo = (ROOT / nome).read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', tipo)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
                self.send_header('Content-Length', str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)
            elif rota.startswith('/api/fotos/'):
                if not self.autorizado():
                    return
                try:
                    foto = ler_foto(db, rota.removeprefix('/api/fotos/'))
                except sqlite3.Error:
                    self.responder(503, {'erro':'Não foi possível carregar a foto.'})
                    return
                if foto is None:
                    self.responder(404, {'erro':'Foto não encontrada.'})
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Length', str(len(foto)))
                self.end_headers()
                self.wfile.write(foto)
            elif rota in ('/api/pedidos', '/api/config', '/api/sessao', '/api/alunos', '/api/comunicadores'):
                if not self.autorizado():
                    return
                if rota == '/api/comunicadores':
                    try:
                        self.responder(200, listar_comunicadores(db))
                    except sqlite3.Error:
                        self.responder(503, {'erro':'Não foi possível carregar os comunicadores. Tente novamente.'})
                    return
                if rota == '/api/alunos':
                    try:
                        self.responder(200, listar_alunos(db))
                    except sqlite3.Error:
                        self.responder(503, {'erro': 'Não foi possível carregar os alunos. Tente novamente.'})
                    return
                if rota == '/api/sessao':
                    self.responder(200, consultar_sessao(db, self.token_sessao()))
                    return
                if rota == '/api/config':
                    self.responder(200, {'retencao_horas': RETENCAO_HORAS})
                    return
                limpar_expirados(db)
                with closing(sqlite3.connect(db, timeout=10)) as con:
                    con.row_factory = sqlite3.Row
                    rows = con.execute("""
                        SELECT p.*, CASE WHEN f.token IS NOT NULL
                            THEN '/api/fotos/' || f.token ELSE NULL END AS aluno_foto_url
                        FROM pedidos p LEFT JOIN fotos_alunos f ON f.aluno_id=p.aluno_id
                        ORDER BY p.recebido ASC,p.id ASC
                    """).fetchall()
                self.responder(200, [dict(row) for row in rows])
            else:
                self.responder(404, {'erro': 'Página não encontrada.'})

        def do_POST(self):
            rota = urlsplit(self.path).path
            if rota not in ('/api/login', '/api/logout') and not self.autorizado(aceitar_dispositivo=rota == '/api/pedidos'):
                return
            # Requisições do navegador usam cabeçalho próprio para impedir envio entre origens.
            if rota != '/api/pedidos' and self.headers.get('X-Portal') != 'tutora':
                self.responder(403, {'erro': 'Abra o portal pelo endereço do servidor e tente novamente.'})
                return
            self.connection.settimeout(10)
            try:
                tamanho = int(self.headers.get('Content-Length', '0'))
                limite = 7 * 1024 * 1024 if rota in ('/api/alunos', '/api/alunos/editar') else 4096
                if tamanho < 1 or tamanho > limite:
                    raise ValueError()
                dados = json.loads(self.rfile.read(tamanho))
                if not isinstance(dados, dict):
                    raise ValueError()
                if rota == '/api/login':
                    token, perfil = autenticar(db, dados.get('instituicao'), dados.get('usuario'), dados.get('senha'), self.client_address[0])
                    encerrar_sessao(db, self.token_sessao())
                    self.responder(200, perfil, cookie=self.cookie(token))
                    return
                if rota == '/api/logout':
                    encerrar_sessao(db, self.token_sessao())
                    self.responder(200, {'ok': True}, cookie=self.cookie(apagar=True))
                    return
                if rota == '/api/comunicadores/vincular':
                    self.responder(200, salvar_vinculo(db, dados))
                    return
                if rota in ('/api/alunos', '/api/alunos/editar'):
                    perfil = consultar_sessao(db, self.token_sessao())
                    if not perfil:
                        self.responder(401, {'erro':'Entre novamente para salvar o aluno.'})
                        return
                    aluno = salvar_aluno(db, dados, perfil['usuario'], editar=rota.endswith('/editar'))
                    self.responder(200, aluno)
                    return
                if rota in ('/api/alunos/situacao', '/api/alunos/excluir'):
                    self.responder(200, alterar_cadastro(db, dados, excluir=rota.endswith('/excluir')))
                    return
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
                        # O vínculo é resolvido pelo servidor; o aparelho não escolhe outro aluno.
                        # A mesma transação impede troca do vínculo entre a leitura e o registro.
                        con.execute('BEGIN IMMEDIATE')
                        dispositivo = dados['dispositivo'].strip()
                        aluno = con.execute('SELECT a.id,a.nome FROM comunicadores c JOIN alunos a ON a.id=c.aluno_id WHERE c.dispositivo=? AND a.ativo=1', (dispositivo,)).fetchone()
                        aluno_id, aluno_nome = aluno if aluno else (None, None)
                        con.execute('INSERT OR IGNORE INTO pedidos (id, frase, dispositivo, recebido, prioridade, atualizado, aluno_id, aluno_nome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                                    (dados['id'], dados['frase'].strip(), dispositivo, instante, prioridade, instante, aluno_id, aluno_nome))
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
            except (ErroAcesso, ErroCadastro) as erro:
                self.responder(erro.status, {'erro': str(erro)})
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
    parser.add_argument('--demo', action='store_true', help='Cria ou atualiza o acesso padrão de testes; preserva contas personalizadas.')
    args = parser.parse_args()
    servidor, segredo = criar_servidor(('0.0.0.0', args.porta), args.dados, modo_demo=args.demo)
    print(f'Painel neste computador: http://localhost:{args.porta}', flush=True)
    print(f'Credencial dos comunicadores: {segredo}', flush=True)
    if args.demo:
        print('Modo de demonstração: ADM Desenvolvedor. Instituição 164275, usuário testedev.', flush=True)
    else:
        print('Acesso ao portal: instituição, usuário e senha configurados localmente.', flush=True)
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
