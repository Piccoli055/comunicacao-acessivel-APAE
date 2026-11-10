"""Configuração dos vínculos entre aparelhos e alunos."""
from contextlib import closing
from datetime import datetime, timezone
import sqlite3

from alunos import ErroCadastro


def preparar_comunicadores(db):
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute("""CREATE TABLE IF NOT EXISTS comunicadores (
            dispositivo TEXT PRIMARY KEY NOT NULL CHECK(length(trim(dispositivo)) BETWEEN 1 AND 80),
            aluno_id TEXT,
            atualizado TEXT NOT NULL,
            versao INTEGER NOT NULL DEFAULT 1
        )""")


def listar_comunicadores(db):
    with closing(sqlite3.connect(db, timeout=10)) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute("""
            WITH aparelhos AS (
                SELECT dispositivo FROM comunicadores
                UNION SELECT dispositivo FROM pedidos
            )
            SELECT d.dispositivo, a.id AS aluno_id, a.nome AS aluno_nome, a.ativo AS aluno_ativo,
                   c.atualizado, COALESCE(c.versao,0) AS versao
            FROM aparelhos d
            LEFT JOIN comunicadores c ON c.dispositivo=d.dispositivo
            LEFT JOIN alunos a ON a.id=c.aluno_id
            ORDER BY d.dispositivo COLLATE NOCASE,d.dispositivo
        """).fetchall()
        return [dict(row) for row in rows]


def salvar_vinculo(db, dados):
    dispositivo = dados.get('dispositivo')
    aluno_id = dados.get('aluno_id')
    versao = dados.get('versao')
    if not isinstance(dispositivo, str) or not 1 <= len(dispositivo.strip()) <= 80:
        raise ErroCadastro('Informe a identificação do comunicador com 1 a 80 caracteres.')
    dispositivo = dispositivo.strip()
    if 'aluno_id' not in dados or (aluno_id is not None and (not isinstance(aluno_id,str) or not 1 <= len(aluno_id.strip()) <= 80)):
        raise ErroCadastro('Selecione um aluno ativo ou a opção Sem aluno vinculado.')
    if type(versao) is not int or versao < 0:
        raise ErroCadastro('Atualize os comunicadores antes de salvar o vínculo.')
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('BEGIN IMMEDIATE')
        atual = con.execute('SELECT versao FROM comunicadores WHERE dispositivo=?', (dispositivo,)).fetchone()
        if versao != (atual[0] if atual else 0):
            raise ErroCadastro('Este vínculo foi alterado em outra sessão. Atualize os comunicadores e selecione o aparelho novamente.',409)
        if aluno_id is not None:
            aluno = con.execute('SELECT ativo FROM alunos WHERE id=?',(aluno_id,)).fetchone()
            if aluno is None:
                raise ErroCadastro('Aluno não encontrado. Atualize a lista.',404)
            if not aluno[0]:
                raise ErroCadastro('Este aluno está inativo. Selecione um aluno ativo.',409)
        instante = datetime.now(timezone.utc).isoformat()
        if atual:
            con.execute('UPDATE comunicadores SET aluno_id=?,atualizado=?,versao=versao+1 WHERE dispositivo=?',(aluno_id,instante,dispositivo))
        else:
            con.execute('INSERT INTO comunicadores (dispositivo,aluno_id,atualizado) VALUES (?,?,?)',(dispositivo,aluno_id,instante))
        return {'ok':True}
