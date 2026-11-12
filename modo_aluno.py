"""Seleção de alunos em navegadores autorizados pela tutora."""
from contextlib import closing
import hashlib
import secrets
import sqlite3
import time

from acesso import DURACAO_SESSAO, ErroAcesso
from alunos import ErroCadastro


def preparar_modo_aluno(db):
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('CREATE TABLE IF NOT EXISTS sessoes_comunicador (token_hash TEXT PRIMARY KEY, dispositivo TEXT NOT NULL, expira REAL NOT NULL)')
        colunas = {r[1] for r in con.execute('PRAGMA table_info(sessoes_comunicador)')}
        for nome, definicao in [('aluno_id','TEXT'), ('manual','INTEGER NOT NULL DEFAULT 0')]:
            if nome not in colunas:
                con.execute(f'ALTER TABLE sessoes_comunicador ADD COLUMN {nome} {definicao}')
        con.execute('CREATE TABLE IF NOT EXISTS sessoes_entrada (token_hash TEXT PRIMARY KEY, expira REAL NOT NULL)')
        con.execute('DELETE FROM sessoes_entrada WHERE expira<=?', (time.time(),))
        con.execute('DELETE FROM sessoes_comunicador WHERE expira <= ?', (time.time(),))


def resumo_token(token):
    if not isinstance(token,str) or not 20 <= len(token) <= 100:
        return None
    return hashlib.sha256(token.encode()).hexdigest()


def encerrar_modo_aluno(db, token):
    resumo = resumo_token(token)
    if resumo:
        with closing(sqlite3.connect(db, timeout=10)) as con, con:
            con.execute('DELETE FROM sessoes_comunicador WHERE token_hash=?', (resumo,))


def configurar_navegador(db, dispositivo, token_anterior=''):
    if not isinstance(dispositivo,str) or not 1 <= len(dispositivo.strip()) <= 80:
        raise ErroCadastro('Informe a identificação do comunicador com até 80 caracteres.')
    dispositivo = dispositivo.strip()
    token = secrets.token_urlsafe(32)
    instante = time.time()
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('BEGIN IMMEDIATE')
        existe = con.execute('SELECT 1 FROM comunicadores WHERE dispositivo=? UNION SELECT 1 FROM pedidos WHERE dispositivo=? LIMIT 1', (dispositivo,dispositivo)).fetchone()
        if not existe:
            raise ErroCadastro('Comunicador não encontrado. Cadastre ou vincule esse aparelho no portal da tutora primeiro.',404)
        anterior = resumo_token(token_anterior)
        if anterior:
            con.execute('DELETE FROM sessoes_comunicador WHERE token_hash=?', (anterior,))
        con.execute('DELETE FROM sessoes_comunicador WHERE expira <= ?', (instante,))
        con.execute('INSERT INTO sessoes_comunicador (token_hash,dispositivo,expira) VALUES (?,?,?)', (resumo_token(token),dispositivo,instante+DURACAO_SESSAO))
    return token


def consultar_contexto(db, token, incluir_foto=False):
    resumo = resumo_token(token)
    with closing(sqlite3.connect(db, timeout=10)) as con:
        # Uma única consulta mantém sessão, vínculo e aluno no mesmo retrato do banco.
        row = con.execute("""
            SELECT s.dispositivo,c.dispositivo,a.id,a.nome,a.ativo,a.perfil_acessibilidade,
                   f.token,f.conteudo,s.manual
            FROM sessoes_comunicador s
            LEFT JOIN comunicadores c ON c.dispositivo=s.dispositivo
            LEFT JOIN alunos a ON a.id=CASE WHEN s.manual=1 THEN s.aluno_id ELSE c.aluno_id END
            LEFT JOIN fotos_alunos f ON f.aluno_id=a.id
            WHERE s.token_hash=? AND s.expira>?
        """ if incluir_foto else """
            SELECT s.dispositivo,c.dispositivo,a.id,a.nome,a.ativo,a.perfil_acessibilidade,
                   f.token,NULL,s.manual
            FROM sessoes_comunicador s
            LEFT JOIN comunicadores c ON c.dispositivo=s.dispositivo
            LEFT JOIN alunos a ON a.id=CASE WHEN s.manual=1 THEN s.aluno_id ELSE c.aluno_id END
            LEFT JOIN fotos_alunos f ON f.aluno_id=a.id
            WHERE s.token_hash=? AND s.expira>?
        """, (resumo,time.time())).fetchone()
    if row is None:
        raise ErroAcesso('Este navegador precisa ser configurado pela tutora. O acesso pode ter expirado.',401)
    dispositivo, registrado, aluno_id, nome, ativo, perfil, foto_token, foto, manual = row
    if registrado is None and not manual:
        situacao = 'indisponivel'
    elif aluno_id is None:
        situacao = 'sem_aluno'
    elif not ativo:
        situacao = 'aluno_inativo'
    else:
        situacao = 'vinculado'
    if incluir_foto:
        return foto if situacao == 'vinculado' else None
    aluno = {'id':aluno_id,'nome':nome,'perfil_acessibilidade':perfil,
             'foto_url':'/api/aluno/foto?v='+foto_token if foto_token else None} if situacao == 'vinculado' else None
    return {'dispositivo':dispositivo,'situacao':situacao,'aluno':aluno}


PERFIS_ENTRADA = {
    'padrao': {'rotulo':'Padrão','cor':'neutro'},
    'tea': {'rotulo':'TEA','cor':'azul'},
    'motora': {'rotulo':'Acessibilidade motora','cor':'roxo'},
    'baixa_visao': {'rotulo':'Baixa visão','cor':'ambar'},
    'intelectual': {'rotulo':'Acessibilidade cognitiva','cor':'verde'},
}


def liberar_entrada(db, anterior=''):
    """Chamado somente após autenticar a tutora na rota de liberação."""
    token=secrets.token_urlsafe(32)
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('DELETE FROM sessoes_entrada WHERE token_hash=? OR expira<=?',(resumo_token(anterior),time.time()))
        con.execute('INSERT INTO sessoes_entrada VALUES (?,?)',(resumo_token(token),time.time()+DURACAO_SESSAO))
    return token


def exigir_entrada(db, token):
    with closing(sqlite3.connect(db, timeout=10)) as con:
        valido=con.execute('SELECT 1 FROM sessoes_entrada WHERE token_hash=? AND expira>?',(resumo_token(token),time.time())).fetchone()
    if not valido:
        raise ErroAcesso('A tutora precisa liberar a entrada neste navegador.',401)


def listar_entrada(db, token):
    exigir_entrada(db,token)
    with closing(sqlite3.connect(db, timeout=10)) as con:
        rows=con.execute('SELECT a.id,a.nome,a.perfil_acessibilidade,f.token FROM alunos a LEFT JOIN fotos_alunos f ON f.aluno_id=a.id WHERE a.ativo=1 ORDER BY a.nome COLLATE NOCASE,a.id').fetchall()
    return [dict(id=identificador,nome=nome,perfil_acessibilidade=perfil,
                 tag=PERFIS_ENTRADA[perfil],foto_url='/api/aluno/retrato/'+foto if foto else None)
            for identificador,nome,perfil,foto in rows]


def retrato_entrada(db, token, acesso):
    import re
    exigir_entrada(db,acesso)
    if not re.fullmatch(r'[a-f0-9]{32}',token):
        return None
    with closing(sqlite3.connect(db, timeout=10)) as con:
        row=con.execute('SELECT f.conteudo FROM fotos_alunos f JOIN alunos a ON a.id=f.aluno_id WHERE f.token=? AND a.ativo=1',(token,)).fetchone()
    return row[0] if row else None


def selecionar_aluno(db, aluno_id, acesso, token_anterior=''):
    exigir_entrada(db,acesso)
    if not isinstance(aluno_id,str) or not 1 <= len(aluno_id.strip()) <= 80:
        raise ErroCadastro('Escolha um aluno válido.')
    token=secrets.token_urlsafe(32)
    instante=time.time()
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('BEGIN IMMEDIATE')
        aluno=con.execute('SELECT ativo FROM alunos WHERE id=?',(aluno_id,)).fetchone()
        if aluno is None or not aluno[0]:
            raise ErroCadastro('Este aluno não está disponível. Escolha outro bloco.',409)
        resumo=resumo_token(token_anterior)
        anterior=con.execute('SELECT dispositivo FROM sessoes_comunicador WHERE token_hash=? AND expira>?',(resumo,instante)).fetchone()
        dispositivo=anterior[0] if anterior else 'Web-'+secrets.token_hex(6)
        con.execute('DELETE FROM sessoes_comunicador WHERE token_hash=? OR expira<=?',(resumo,instante))
        con.execute('INSERT INTO sessoes_comunicador (token_hash,dispositivo,expira,aluno_id,manual) VALUES (?,?,?,?,1)',(resumo_token(token),dispositivo,instante+DURACAO_SESSAO,aluno_id))
    return token
