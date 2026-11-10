"""Estrutura persistente dos alunos do MVP, sem dados de demonstração."""
from contextlib import closing
import sqlite3
import base64
import binascii
from datetime import datetime, timezone
from io import BytesIO
import re
import uuid
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

PERFIS = {'padrao', 'tea', 'motora', 'baixa_visao', 'intelectual'}
LIMITE_FOTO = 5 * 1024 * 1024


class ErroCadastro(Exception):
    def __init__(self, mensagem, status=400):
        super().__init__(mensagem)
        self.status = status



def preparar_alunos(db):
    """Cria a tabela sem alterar registros existentes ao reiniciar o servidor."""
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS alunos (
                id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                nome TEXT NOT NULL CHECK(length(trim(nome)) BETWEEN 1 AND 120),
                foto TEXT,
                perfil_acessibilidade TEXT NOT NULL DEFAULT 'padrao'
                    CHECK(perfil_acessibilidade IN ('padrao', 'tea', 'motora', 'baixa_visao', 'intelectual')),
                ativo INTEGER NOT NULL DEFAULT 1 CHECK(ativo IN (0, 1)),
                criado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                atualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            )
        """)

        colunas = {r[1] for r in con.execute('PRAGMA table_info(alunos)')}
        for nome, definicao in [('autorizado_em', 'TEXT'), ('autorizado_por', 'TEXT'),
                                ('versao', 'INTEGER NOT NULL DEFAULT 1')]:
            if nome not in colunas:
                con.execute(f'ALTER TABLE alunos ADD COLUMN {nome} {definicao}')
        con.execute('CREATE TABLE IF NOT EXISTS fotos_alunos (token TEXT PRIMARY KEY, aluno_id TEXT NOT NULL UNIQUE, conteudo BLOB NOT NULL)')


def registro_aluno(con, identificador):
    row = con.execute('SELECT id,nome,perfil_acessibilidade,ativo,autorizado_em,versao FROM alunos WHERE id=?', (identificador,)).fetchone()
    if row is None:
        raise ErroCadastro('Aluno não encontrado. Atualize a lista.', 404)
    aluno = dict(zip(('id','nome','perfil_acessibilidade','ativo','autorizado_em','versao'), row))
    foto = con.execute('SELECT token FROM fotos_alunos WHERE aluno_id=?', (identificador,)).fetchone()
    aluno['foto_url'] = '/api/fotos/' + foto[0] if foto else None
    return aluno


def listar_alunos(db):
    with closing(sqlite3.connect(db, timeout=10)) as con:
        return [registro_aluno(con, row[0]) for row in con.execute('SELECT id FROM alunos ORDER BY nome COLLATE NOCASE,id').fetchall()]


def normalizar_foto(valor):
    if not isinstance(valor, str) or len(valor) > 4 * ((LIMITE_FOTO + 2) // 3):
        raise ErroCadastro('A foto deve ter até 5 MB.')
    try:
        conteudo = base64.b64decode(valor, validate=True)
        if not conteudo or len(conteudo) > LIMITE_FOTO:
            raise ErroCadastro('A foto deve ter até 5 MB.')
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(conteudo)) as foto:
                if foto.format not in ('JPEG', 'PNG', 'WEBP'):
                    raise ErroCadastro('Use uma foto JPEG, PNG ou WebP.')
                if foto.width * foto.height > 12_000_000 or max(foto.size) > 8192:
                    raise ErroCadastro('A foto deve ter até 12 megapixels e 8192 pixels por lado.')
                if getattr(foto, 'is_animated', False):
                    raise ErroCadastro('Selecione uma foto sem animação.')
                foto.verify()
            with Image.open(BytesIO(conteudo)) as original:
                foto = ImageOps.exif_transpose(original).convert('RGBA')
                foto.thumbnail((512,512))
                fundo = Image.new('RGB', foto.size, 'white')
                fundo.paste(foto, mask=foto.getchannel('A'))
                fundo.info.clear()
                saida = BytesIO()
                fundo.save(saida, format='JPEG', quality=85)
                return saida.getvalue()
    except ErroCadastro:
        raise
    except (binascii.Error, UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError,
            Image.DecompressionBombError, Image.DecompressionBombWarning) as erro:
        raise ErroCadastro('Foto inválida ou danificada. Selecione outra imagem.') from erro


def salvar_aluno(db, dados, usuario, editar=False):
    nome = dados.get('nome')
    perfil = dados.get('perfil_acessibilidade', 'padrao')
    if not isinstance(nome, str) or not 1 <= len(nome.strip()) <= 120:
        raise ErroCadastro('Informe um nome com 1 a 120 caracteres.')
    if not isinstance(perfil, str) or perfil not in PERFIS:
        raise ErroCadastro('Selecione um perfil de acessibilidade válido.')
    if dados.get('autorizado') is not True:
        raise ErroCadastro('Confirme a autorização institucional para este cadastro e o uso da foto.')
    identificador = dados.get('id') if editar else (dados.get('id') or uuid.uuid4().hex)
    valido = isinstance(identificador, str) and (1 <= len(identificador.strip()) <= 80 if editar else bool(re.fullmatch(r'[a-f0-9]{32}', identificador)))
    if not valido:
        raise ErroCadastro('Identificação do aluno inválida.')
    foto = normalizar_foto(dados['foto']) if dados.get('foto') is not None else None
    instante = datetime.now(timezone.utc).isoformat()
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('PRAGMA secure_delete=ON')
        # Serializa a leitura da versão e a escrita, inclusive em dois navegadores.
        con.execute('BEGIN IMMEDIATE')
        if editar:
            atual = registro_aluno(con, identificador)
            if type(dados.get('versao')) is not int or dados['versao'] != atual['versao']:
                raise ErroCadastro('Este cadastro foi alterado em outra sessão. Atualize a lista antes de editar.', 409)
            con.execute('UPDATE alunos SET nome=?,perfil_acessibilidade=?,atualizado=?,versao=versao+1,autorizado_em=COALESCE(autorizado_em,?),autorizado_por=COALESCE(autorizado_por,?) WHERE id=?',
                        (nome.strip(),perfil,instante,instante,usuario,identificador))
        else:
            if con.execute('SELECT 1 FROM alunos WHERE id=?', (identificador,)).fetchone():
                return registro_aluno(con, identificador)  # Reenvio após falha de conexão.
            con.execute('INSERT INTO alunos (id,nome,perfil_acessibilidade,autorizado_em,autorizado_por,criado,atualizado) VALUES (?,?,?,?,?,?,?)',
                        (identificador,nome.strip(),perfil,instante,usuario,instante,instante))
        if 'foto' in dados:
            con.execute('DELETE FROM fotos_alunos WHERE aluno_id=?', (identificador,))
            token = uuid.uuid4().hex if foto is not None else None
            if token:
                con.execute('INSERT INTO fotos_alunos VALUES (?,?,?)', (token,identificador,foto))
            con.execute('UPDATE alunos SET foto=? WHERE id=?', (token,identificador))
        return registro_aluno(con, identificador)


def alterar_cadastro(db, dados, excluir=False):
    identificador = dados.get('id')
    if not isinstance(identificador, str):
        raise ErroCadastro('Identificação do aluno inválida.')
    with closing(sqlite3.connect(db, timeout=10)) as con, con:
        con.execute('PRAGMA secure_delete=ON')
        con.execute('BEGIN IMMEDIATE')
        aluno = registro_aluno(con, identificador)
        if type(dados.get('versao')) is not int or dados['versao'] != aluno['versao']:
            raise ErroCadastro('Este cadastro foi alterado. Atualize a lista e tente novamente.', 409)
        if excluir:
            if dados.get('confirmacao') != aluno['nome']:
                raise ErroCadastro('Digite o nome do aluno para confirmar a exclusão definitiva.')
            con.execute('DELETE FROM fotos_alunos WHERE aluno_id=?', (identificador,))
            if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='comunicadores'").fetchone():
                con.execute('UPDATE comunicadores SET aluno_id=NULL,atualizado=?,versao=versao+1 WHERE aluno_id=?',
                            (datetime.now(timezone.utc).isoformat(),identificador))
            colunas_pedidos = {row[1] for row in con.execute('PRAGMA table_info(pedidos)')}
            if {'aluno_id','aluno_nome'} <= colunas_pedidos:
                # Retirada da autorização remove a identificação sem apagar chamados pendentes.
                con.execute('UPDATE pedidos SET aluno_id=NULL,aluno_nome=NULL WHERE aluno_id=?', (identificador,))
            con.execute('DELETE FROM alunos WHERE id=?', (identificador,))
            return {'ok':True}
        if type(dados.get('ativo')) is not bool:
            raise ErroCadastro('Informe se o cadastro deve ficar ativo.')
        if dados.get('confirmado') is not True:
            raise ErroCadastro('Confirme a alteração da situação do aluno.')
        con.execute('UPDATE alunos SET ativo=?,atualizado=?,versao=versao+1 WHERE id=?',
                    (int(dados['ativo']),datetime.now(timezone.utc).isoformat(),identificador))
        return registro_aluno(con, identificador)


def ler_foto(db, token):
    if not re.fullmatch(r'[a-f0-9]{32}', token):
        return None
    with closing(sqlite3.connect(db, timeout=10)) as con:
        row = con.execute('SELECT conteudo FROM fotos_alunos WHERE token=?', (token,)).fetchone()
        return row[0] if row else None
