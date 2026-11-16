"""Autenticação da tutora: senha derivada, sessão e limite de tentativas."""
from contextlib import contextmanager
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
import unicodedata

CODIGO_DEMO = '164275'
USUARIO_DEMO = 'testedev'
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
        con.execute('CREATE TABLE IF NOT EXISTS tutores (id TEXT PRIMARY KEY,cnpj TEXT NOT NULL,nome TEXT NOT NULL,usuario TEXT NOT NULL,usuario_chave TEXT NOT NULL,sal TEXT NOT NULL,senha_hash TEXT NOT NULL,iteracoes INTEGER NOT NULL,ativo INTEGER NOT NULL DEFAULT 1,versao INTEGER NOT NULL DEFAULT 1,UNIQUE(cnpj,usuario_chave))')
        con.execute('CREATE TABLE IF NOT EXISTS sessoes_tutores (token_hash TEXT PRIMARY KEY,tutor_id TEXT NOT NULL,expira REAL NOT NULL)')
        con.execute('DELETE FROM sessoes_tutores WHERE expira<=?', (time.time(),))
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
    if perfil not in ('tutora', 'admdev'):
        raise ValueError('Perfil de acesso inválido.')
    minimo = 6 if perfil == 'admdev' else 10
    if not isinstance(senha, str) or not minimo <= len(senha) <= 128:
        raise ValueError('Escolha uma senha com 10 a 128 caracteres.')
    preparar_acesso(db)
    sal = secrets.token_bytes(16)
    resumo = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), sal, ITERACOES).hex()
    with conectar(db) as con:
        if con.execute('SELECT 1 FROM tutores WHERE cnpj=? AND usuario_chave=?',(cnpj,normalizar_usuario(usuario))).fetchone():
            raise ValueError('Este usuário já pertence a um tutor cadastrado.')
        con.execute('INSERT OR REPLACE INTO conta_tutora (id,cnpj,usuario,sal,senha_hash,iteracoes,perfil) VALUES (1,?,?,?,?,?,?)',
                    (cnpj, usuario.strip(), sal.hex(), resumo, ITERACOES, perfil))
        con.execute('DELETE FROM sessoes')
        con.execute('DELETE FROM sessoes_tutores')
        con.execute('DELETE FROM tentativas_acesso')


def autenticar(db, cnpj, usuario, senha, origem):
    instante = time.time()
    # Reserva a tentativa antes da derivação: chamadas simultâneas não podem
    # ler o mesmo contador e sobrescrever as falhas umas das outras.
    with conectar(db) as con:
        con.execute('BEGIN IMMEDIATE')
        conta = con.execute('SELECT cnpj, usuario, sal, senha_hash, iteracoes, perfil FROM conta_tutora WHERE id=1').fetchone()
        falha = con.execute('SELECT falhas, primeira, bloqueado_ate FROM tentativas_acesso WHERE origem=?', (origem,)).fetchone()
        if not conta:
            raise ErroAcesso('O acesso inicial ainda não foi configurado. A equipe deve executar configurar_acesso.py no servidor.', 503)
        if falha and falha[2] > instante:
            raise ErroAcesso('Muitas tentativas. Aguarde cinco minutos e tente novamente.', 429)
        quantidade = falha[0] + 1 if falha and instante - falha[1] < BLOQUEIO_SEGUNDOS else 1
        primeira = falha[1] if falha and instante - falha[1] < BLOQUEIO_SEGUNDOS else instante
        bloqueio = instante + BLOQUEIO_SEGUNDOS if quantidade >= MAX_TENTATIVAS else 0
        con.execute('INSERT OR REPLACE INTO tentativas_acesso VALUES (?,?,?,?)', (origem, quantidade, primeira, bloqueio))
    try:
        cnpj_valido = normalizar_cnpj(cnpj)
        usuario_valido = normalizar_usuario(usuario)
    except ValueError:
        cnpj_valido, usuario_valido = '', ''
    if not isinstance(senha, str) or len(senha) > 128:
        senha = ''
    tutor = None
    with conectar(db) as con:
        if cnpj_valido == conta[0] and usuario_valido != normalizar_usuario(conta[1]):
            tutor = con.execute('SELECT id,nome,usuario,sal,senha_hash,iteracoes,ativo,versao FROM tutores WHERE cnpj=? AND usuario_chave=?',(cnpj_valido,usuario_valido)).fetchone()
    credencial = (tutor[3],tutor[4],tutor[5]) if tutor else (conta[2],conta[3],conta[4])
    calculado = hashlib.pbkdf2_hmac('sha256', senha.encode('utf-8'), bytes.fromhex(credencial[0]), credencial[2]).hex()
    correto = (hmac.compare_digest(calculado, credencial[1])
               and cnpj_valido == conta[0]
               and ((bool(tutor[6]) if tutor else False) or (not tutor and usuario_valido == normalizar_usuario(conta[1]))))
    if not correto:
        raise ErroAcesso('CNPJ, usuário ou senha incorretos.', 429 if bloqueio else 401)
    token = secrets.token_urlsafe(32)
    with conectar(db) as con:
        con.execute('BEGIN IMMEDIATE')
        atual = con.execute('SELECT cnpj, usuario, sal, senha_hash, iteracoes, perfil FROM conta_tutora WHERE id=1').fetchone()
        if atual != conta:
            raise ErroAcesso('O acesso foi redefinido. Entre novamente com as credenciais atuais.')
        con.execute('DELETE FROM tentativas_acesso WHERE origem=?', (origem,))
        con.execute('DELETE FROM sessoes WHERE expira <= ?', (instante,))
        if tutor:
            tutor_atual = con.execute('SELECT id,nome,usuario,sal,senha_hash,iteracoes,ativo,versao FROM tutores WHERE id=?',(tutor[0],)).fetchone()
            if tutor_atual != tutor:
                raise ErroAcesso('O cadastro do tutor foi alterado. Entre novamente.')
            con.execute('INSERT INTO sessoes_tutores VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),tutor[0],instante+DURACAO_SESSAO))
        else:
            con.execute('INSERT INTO sessoes VALUES (?,?)', (hashlib.sha256(token.encode()).hexdigest(), instante + DURACAO_SESSAO))
    if tutor:
        return token, {'usuario':tutor[2],'cnpj':conta[0],'perfil':'tutora','tutor_id':tutor[0],'nome':tutor[1]}
    return token, {'usuario': conta[1], 'cnpj': conta[0], 'perfil': conta[5]}


def consultar_sessao(db, token):
    if not isinstance(token, str) or not 20 <= len(token) <= 100:
        return None
    resumo = hashlib.sha256(token.encode()).hexdigest()
    with conectar(db) as con:
        conta = con.execute('SELECT c.usuario,c.cnpj,c.perfil FROM sessoes s JOIN conta_tutora c ON c.id=1 WHERE s.token_hash=? AND s.expira>?', (resumo,time.time())).fetchone()
    if conta:
        return {'usuario': conta[0], 'cnpj': conta[1], 'perfil': conta[2]}
    with conectar(db) as con:
        tutor = con.execute('SELECT t.usuario,t.cnpj,t.id,t.nome FROM sessoes_tutores s JOIN tutores t ON t.id=s.tutor_id JOIN conta_tutora c ON c.id=1 AND c.cnpj=t.cnpj WHERE s.token_hash=? AND s.expira>? AND t.ativo=1',(resumo,time.time())).fetchone()
    return {'usuario':tutor[0],'cnpj':tutor[1],'perfil':'tutora','tutor_id':tutor[2],'nome':tutor[3]} if tutor else None


def encerrar_sessao(db, token):
    if isinstance(token, str):
        with conectar(db) as con:
            resumo = hashlib.sha256(token.encode()).hexdigest()
            con.execute('DELETE FROM sessoes WHERE token_hash=?', (resumo,))
            con.execute('DELETE FROM sessoes_tutores WHERE token_hash=?', (resumo,))

def preparar_demo(db):
    """Cria a conta de testes ou atualiza exclusivamente o antigo acesso padrão."""
    preparar_acesso(db)
    with conectar(db) as con:
        conta = con.execute('SELECT cnpj,usuario,perfil FROM conta_tutora WHERE id=1').fetchone()
    legado = conta == ('51995537839', 'admdev', 'admdev')
    if conta is None or legado:
        configurar_conta(db, CODIGO_DEMO, USUARIO_DEMO, SENHA_DEMO, perfil='admdev')
