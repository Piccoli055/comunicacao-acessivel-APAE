"""Autenticação da tutora: senha derivada, sessão e limite de tentativas."""
from contextlib import contextmanager
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
import unicodedata

CODIGO_DEMO = '51995537839'
USUARIO_DEMO = 'admdev'
SENHA_DEMO = '123456'
ITERACOES = 600_000
DURACAO_SESSAO = 8 * 60 * 60
MAX_TENTATIVAS = 5
BLOQUEIO_SEGUNDOS = 5 * 60


class ErroAcesso(Exception):
    def __init__(self, mensagem, status=401):
        super().__init__(mensagem)
        self.status = status


@contextmanager
def conectar(db):
    con = sqlite3.connect(db, timeout=10)
    try:
        with con:
            yield con
    finally:
        con.close()


def preparar_acesso(db):
    with conectar(db) as con:
        con.execute('CREATE TABLE IF NOT EXISTS conta_tutora (id INTEGER PRIMARY KEY CHECK(id=1), cnpj TEXT NOT NULL, usuario TEXT NOT NULL, sal TEXT NOT NULL, senha_hash TEXT NOT NULL, iteracoes INTEGER NOT NULL)')
        if 'perfil' not in {r[1] for r in con.execute('PRAGMA table_info(conta_tutora)')}:
            con.execute("ALTER TABLE conta_tutora ADD COLUMN perfil TEXT NOT NULL DEFAULT 'tutora'")
        con.execute('CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, expira REAL NOT NULL)')
        con.execute('CREATE TABLE IF NOT EXISTS tentativas_acesso (origem TEXT PRIMARY KEY, falhas INTEGER NOT NULL, primeira REAL NOT NULL, bloqueado_ate REAL NOT NULL DEFAULT 0)')
        con.execute('DELETE FROM sessoes WHERE expira <= ?', (time.time(),))


def normalizar_cnpj(cnpj):
    if cnpj == CODIGO_DEMO:
        return cnpj
    if not isinstance(cnpj, str) or not re.fullmatch(r'[0-9./\-\s]{14,25}', cnpj):
        raise ValueError('Informe o CNPJ com 14 números, com ou sem pontuação.')
    numeros = re.sub(r'[^0-9]', '', cnpj)
    if len(numeros) != 14:
        raise ValueError('Informe o CNPJ com 14 números, com ou sem pontuação.')
    return numeros


def normalizar_usuario(usuario):
    if not isinstance(usuario, str) or not 1 <= len(usuario.strip()) <= 80:
        raise ValueError('O usuário deve ter de 1 a 80 caracteres.')
    return unicodedata.normalize('NFKC', usuario.strip()).casefold()


def configurar_conta(db, cnpj, usuario, senha, perfil='tutora'):
    cnpj = normalizar_cnpj(cnpj)
    normalizar_usuario(usuario)
    minimo = 6 if perfil == 'admdev' else 10
    if not isinstance(senha, str) or not minimo <= len(senha) <= 128:
        raise ValueError('Escolha uma senha com 10 a 128 caracteres.')
    preparar_acesso(db)
    sal = secrets.token_bytes(16)
    resumo = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal, ITERACOES).hex()
    with conectar(db) as con:
        con.execute('INSERT OR REPLACE INTO conta_tutora (id,cnpj,usuario,sal,senha_hash,iteracoes,perfil) VALUES (1,?,?,?,?,?,?)',
                    (cnpj, usuario.strip(), sal.hex(), resumo, ITERACOES, perfil))
        con.execute('DELETE FROM sessoes')
        con.execute('DELETE FROM tentativas_acesso')


def autenticar(db, cnpj, usuario, senha, origem):
    instante = time.time()
    with conectar(db) as con:
        conta = con.execute('SELECT cnpj, usuario, sal, senha_hash, iteracoes, perfil FROM conta_tutora WHERE id=1').fetchone()
        falha = con.execute('SELECT falhas, primeira, bloqueado_ate FROM tentativas_acesso WHERE origem=?', (origem,)).fetchone()
    if not conta:
        raise ErroAcesso('O acesso inicial ainda não foi configurado. A equipe deve executar configurar_acesso.py no servidor.', 503)
    if falha and falha[2] > instante:
        raise ErroAcesso('Muitas tentativas. Aguarde cinco minutos e tente novamente.', 429)
    try:
        cnpj_valido = normalizar_cnpj(cnpj)
        usuario_valido = normalizar_usuario(usuario)
    except ValueError:
        cnpj_valido, usuario_valido = '', ''
    if not isinstance(senha, str) or len(senha) > 128:
        senha = ''
    calculado = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), bytes.fromhex(conta[2]), conta[4]).hex()
    correto = (hmac.compare_digest(calculado, conta[3])
               and cnpj_valido == conta[0]
               and usuario_valido == normalizar_usuario(conta[1]))
    if not correto:
        quantidade = falha[0] + 1 if falha and instante - falha[1] < BLOQUEIO_SEGUNDOS else 1
        primeira = falha[1] if falha and instante - falha[1] < BLOQUEIO_SEGUNDOS else instante
        bloqueio = instante + BLOQUEIO_SEGUNDOS if quantidade >= MAX_TENTATIVAS else 0
        with conectar(db) as con:
            con.execute('INSERT OR REPLACE INTO tentativas_acesso VALUES (?,?,?,?)', (origem, quantidade, primeira, bloqueio))
        raise ErroAcesso('CNPJ, usuário ou senha incorretos.', 429 if bloqueio else 401)
    token = secrets.token_urlsafe(32)
    with conectar(db) as con:
        con.execute('DELETE FROM tentativas_acesso WHERE origem=?', (origem,))
        con.execute('DELETE FROM sessoes WHERE expira <= ?', (instante,))
        con.execute('INSERT INTO sessoes VALUES (?,?)', (hashlib.sha256(token.encode()).hexdigest(), instante + DURACAO_SESSAO))
    return token, {'usuario': conta[1], 'cnpj': conta[0], 'perfil': conta[5]}


def consultar_sessao(db, token):
    if not isinstance(token, str) or not 20 <= len(token) <= 100:
        return None
    resumo = hashlib.sha256(token.encode()).hexdigest()
    with conectar(db) as con:
        row = con.execute('SELECT expira FROM sessoes WHERE token_hash=?', (resumo,)).fetchone()
        conta = con.execute('SELECT usuario, cnpj, perfil FROM conta_tutora WHERE id=1').fetchone()
    if not row or row[0] <= time.time() or not conta:
        return None
    return {'usuario': conta[0], 'cnpj': conta[1], 'perfil': conta[2]}


def encerrar_sessao(db, token):
    if isinstance(token, str):
        with conectar(db) as con:
            con.execute('DELETE FROM sessoes WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))

def preparar_demo(db):
    """Cria somente a conta de demonstração quando ainda não existe uma conta."""
    preparar_acesso(db)
    with conectar(db) as con:
        existe = con.execute('SELECT 1 FROM conta_tutora WHERE id=1').fetchone()
    if not existe:
        configurar_conta(db, CODIGO_DEMO, USUARIO_DEMO, SENHA_DEMO, perfil='admdev')
